"""Fetch a job posting from a URL and extract its readable text.

The URL is user-supplied, so this is an SSRF surface. Defences:
  * only http/https, no credentials in the URL, standard ports only
  * every hostname is resolved and rejected if ANY address is private, loopback, link-local,
    multicast, reserved or unspecified (blocks 127.0.0.1, 10/8, 169.254.169.254 cloud metadata, ...)
  * redirects are followed manually (max 3) and each hop is re-validated
  * short timeouts, a hard response-size cap, HTML/plain-text content types only
Known limit: DNS is resolved separately from the connection (a rebinding race is theoretical).
Production should fetch through an egress proxy or pin the validated IP.
"""
import ipaddress
import socket
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

import httpx
import trafilatura

MAX_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 3
MIN_TEXT_CHARS = 200
ALLOWED_PORTS = {None, 80, 443}
ALLOWED_TYPES = ("text/html", "application/xhtml+xml", "text/plain")
USER_AGENT = "CareerIntelligenceBot/1.0 (+job posting import)"


class FetchError(ValueError):
    """Raised with a user-presentable message when a URL cannot be imported."""


@dataclass(frozen=True)
class FetchedPage:
    url: str
    title: str
    text: str


Resolver = Callable[[str, int | None], list]


def _default_resolver(host: str, port: int | None) -> list:
    return socket.getaddrinfo(host, port or 443, proto=socket.IPPROTO_TCP)


def validate_url(url: str, resolver: Resolver = _default_resolver) -> str:
    parts = urlsplit(url.strip())
    if parts.scheme not in {"http", "https"}:
        raise FetchError("Only http and https links are supported.")
    if not parts.hostname:
        raise FetchError("That does not look like a valid link.")
    if parts.username or parts.password:
        raise FetchError("Links containing credentials are not allowed.")
    try:
        port = parts.port
    except ValueError as exc:
        raise FetchError("That does not look like a valid link.") from exc
    if port not in ALLOWED_PORTS:
        raise FetchError("Only standard web ports (80/443) are allowed.")
    try:
        infos = resolver(parts.hostname, port)
    except OSError as exc:
        raise FetchError("Could not find that website (DNS lookup failed).") from exc
    if not infos:
        raise FetchError("Could not find that website (DNS lookup failed).")
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if not address.is_global:  # private, loopback, link-local, reserved, multicast, ...
            raise FetchError("That address is not allowed (it points to a private network).")
    return parts.geturl()


def extract_text(html: str) -> tuple[str, str]:
    """Return (title, text) from an HTML page. Text keeps headings as `## Heading` and bullets
    as `- item`, which the section-aware chunker understands."""
    text = trafilatura.extract(html, output_format="markdown", include_tables=True,
                               favor_recall=True, include_comments=False) or ""
    meta = trafilatura.extract_metadata(html)
    title = (meta.title if meta and meta.title else "").strip()
    return title, text.strip()


def fetch_page(url: str, *, transport: httpx.BaseTransport | None = None,
               resolver: Resolver = _default_resolver) -> FetchedPage:
    current = validate_url(url, resolver)
    with httpx.Client(transport=transport, timeout=httpx.Timeout(10, connect=5),
                      headers={"User-Agent": USER_AGENT}, follow_redirects=False) as client:
        for _ in range(MAX_REDIRECTS + 1):
            try:
                with client.stream("GET", current) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise FetchError("The site redirected without a destination.")
                        current = validate_url(urljoin(current, location), resolver)
                        continue
                    if response.status_code in (401, 403, 429):
                        raise FetchError("The site blocked automated access. Paste the job description text instead.")
                    if response.status_code >= 400:
                        raise FetchError(f"The site returned an error ({response.status_code}).")
                    ctype = response.headers.get("content-type", "").split(";")[0].strip().lower()
                    if ctype not in ALLOWED_TYPES:
                        raise FetchError("That link is not a web page (unsupported content type).")
                    body = bytearray()
                    for chunk in response.iter_bytes():
                        body += chunk
                        if len(body) > MAX_BYTES:
                            raise FetchError("That page is too large to import.")
                    encoding = response.encoding or "utf-8"
                    break
            except httpx.TimeoutException as exc:
                raise FetchError("The site took too long to respond.") from exc
            except httpx.HTTPError as exc:
                raise FetchError("Could not reach that website.") from exc
        else:
            raise FetchError("Too many redirects.")

    html = bytes(body).decode(encoding, errors="replace")
    title, text = (("", html.strip()) if ctype == "text/plain" else extract_text(html))
    if len(text) < MIN_TEXT_CHARS:
        raise FetchError(
            "Couldn't read enough text from that page (it may need JavaScript or a login). "
            "Paste the job description text instead.")
    return FetchedPage(url=current, title=title or urlsplit(current).hostname or "Job posting", text=text)
