import httpx
import pytest

from app.ingest.fetch import FetchError, extract_text, fetch_page, validate_url

PUBLIC = [(2, 1, 6, "", ("93.184.216.34", 443))]


def resolver_for(ip):
    return lambda host, port: [(2, 1, 6, "", (ip, port or 443))]


GOOD_HTML = (
    "<html><head><title>Backend Engineer - Acme</title></head><body><main>"
    "<h1>Backend Engineer</h1><p>" + "Acme builds payment tools for small shops. " * 6 + "</p>"
    "<h2>Requirements</h2><ul><li>5+ years of Python</li><li>Strong SQL</li></ul>"
    "<h2>Nice to have</h2><ul><li>Terraform</li></ul></main></body></html>"
)


def transport(handler):
    return httpx.MockTransport(handler)


def html_response(body=GOOD_HTML, status=200, ctype="text/html; charset=utf-8", headers=None):
    return httpx.Response(status, content=body.encode(), headers={"content-type": ctype, **(headers or {})})


@pytest.mark.parametrize("url", [
    "ftp://example.com/job", "file:///etc/passwd", "javascript:alert(1)", "not a url",
    "https://user:pass@example.com/job", "http://example.com:8080/job",
])
def test_rejects_bad_schemes_credentials_and_ports(url):
    with pytest.raises(FetchError):
        validate_url(url, resolver_for("93.184.216.34"))


@pytest.mark.parametrize("ip", [
    "127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.0.9", "169.254.169.254", "0.0.0.0", "::1", "fd00::1",
])
def test_blocks_private_loopback_and_metadata_addresses(ip):
    with pytest.raises(FetchError, match="private network"):
        validate_url("https://jobs.example.com/x", resolver_for(ip))


def test_blocks_host_if_any_resolved_address_is_private():
    mixed = lambda host, port: [(2, 1, 6, "", ("93.184.216.34", 443)), (2, 1, 6, "", ("10.0.0.1", 443))]
    with pytest.raises(FetchError):
        validate_url("https://jobs.example.com/x", mixed)


def test_dns_failure_is_reported():
    def boom(host, port):
        raise OSError("nope")
    with pytest.raises(FetchError, match="DNS"):
        validate_url("https://nonexistent.invalid/x", boom)


def test_fetch_extracts_title_and_structured_text():
    page = fetch_page("https://jobs.example.com/1", transport=transport(lambda r: html_response()),
                      resolver=resolver_for("93.184.216.34"))
    assert page.title == "Backend Engineer"  # trafilatura prefers the page h1
    assert "## Requirements" in page.text and "- 5+ years of Python" in page.text


def test_redirect_to_private_address_is_blocked():
    def handler(request):
        return httpx.Response(302, headers={"location": "http://internal.example/admin"})

    def resolver(host, port):
        ip = "10.0.0.5" if host == "internal.example" else "93.184.216.34"
        return [(2, 1, 6, "", (ip, port or 80))]

    with pytest.raises(FetchError, match="private network"):
        fetch_page("https://jobs.example.com/1", transport=transport(handler), resolver=resolver)


def test_follows_safe_redirect_but_caps_redirect_loops():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if str(request.url).endswith("/final"):
            return html_response()
        return httpx.Response(301, headers={"location": "/final"})

    page = fetch_page("https://jobs.example.com/old", transport=transport(handler),
                      resolver=resolver_for("93.184.216.34"))
    assert page.url.endswith("/final") and calls["n"] == 2

    loop = lambda request: httpx.Response(302, headers={"location": "/again"})
    with pytest.raises(FetchError, match="redirects"):
        fetch_page("https://jobs.example.com/x", transport=transport(loop), resolver=resolver_for("93.184.216.34"))


@pytest.mark.parametrize("status,match", [(403, "blocked"), (429, "blocked"), (404, "404"), (500, "500")])
def test_http_errors_become_friendly_messages(status, match):
    with pytest.raises(FetchError, match=match):
        fetch_page("https://jobs.example.com/1", transport=transport(lambda r: httpx.Response(status)),
                   resolver=resolver_for("93.184.216.34"))


def test_rejects_non_html_content_types():
    pdf = lambda r: html_response(ctype="application/pdf")
    with pytest.raises(FetchError, match="content type"):
        fetch_page("https://jobs.example.com/1", transport=transport(pdf), resolver=resolver_for("93.184.216.34"))


def test_rejects_oversized_pages():
    huge = lambda r: html_response(body="<p>" + "x" * (2 * 1024 * 1024 + 10) + "</p>")
    with pytest.raises(FetchError, match="too large"):
        fetch_page("https://jobs.example.com/1", transport=transport(huge), resolver=resolver_for("93.184.216.34"))


def test_js_only_or_empty_pages_suggest_pasting():
    shell = lambda r: html_response(body="<html><body><div id=root></div><script>app()</script></body></html>")
    with pytest.raises(FetchError, match="Paste the job description"):
        fetch_page("https://jobs.example.com/1", transport=transport(shell), resolver=resolver_for("93.184.216.34"))


def test_timeout_is_reported():
    def slow(request):
        raise httpx.ReadTimeout("slow", request=request)
    with pytest.raises(FetchError, match="too long"):
        fetch_page("https://jobs.example.com/1", transport=transport(slow), resolver=resolver_for("93.184.216.34"))


def test_plain_text_pages_are_accepted():
    body = "Platform Engineer\n\nREQUIREMENTS\n- Terraform\n" + "More detail about the role. " * 12
    page = fetch_page("https://jobs.example.com/job.txt",
                      transport=transport(lambda r: html_response(body=body, ctype="text/plain")),
                      resolver=resolver_for("93.184.216.34"))
    assert "REQUIREMENTS" in page.text


def test_extract_text_returns_title_and_text():
    title, text = extract_text(GOOD_HTML)
    assert title == "Backend Engineer" and "Terraform" in text
