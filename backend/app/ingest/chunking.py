"""Section-aware chunking.

Resumes and job descriptions are structured by headings (Experience, Requirements, ...).
We split on those first so a chunk never mixes e.g. "Requirements" with "Benefits", and
keep the section name as metadata for filtering and citations. Oversized sections are
split on paragraph/bullet boundaries, never mid-sentence by a fixed window.
"""
import re
from dataclasses import dataclass

MAX_CHARS = 1200

KNOWN_HEADINGS = {
    "summary", "profile", "objective", "about", "about us", "about the role", "experience",
    "work experience", "professional experience", "employment", "education", "skills",
    "technical skills", "projects", "certifications", "awards", "publications", "languages",
    "requirements", "qualifications", "responsibilities", "what you'll do", "what you will do",
    "nice to have", "preferred qualifications", "preferred", "benefits", "perks", "who you are",
    "minimum qualifications", "basic qualifications", "key responsibilities",
}


@dataclass(frozen=True)
class Chunk:
    index: int
    section: str
    text: str


def is_heading(line: str) -> bool:
    stripped = line.strip().rstrip(":").strip()
    if not stripped or len(stripped) > 40:
        return False
    if stripped.lower() in KNOWN_HEADINGS:
        return True
    letters = [c for c in stripped if c.isalpha()]
    # ALL-CAPS short lines ("TECHNICAL SKILLS") are headings; a lone name line is not,
    # so require at least two letters and no sentence punctuation.
    return len(letters) >= 3 and stripped.isupper() and not re.search(r"[.@,]", stripped)


def split_sections(text: str) -> list[tuple[str, str]]:
    sections: list[tuple[str, list[str]]] = [("header", [])]
    for line in text.split("\n"):
        if is_heading(line):
            sections.append((line.strip().rstrip(":").strip().lower(), []))
        else:
            sections[-1][1].append(line)
    result = [(name, "\n".join(lines).strip()) for name, lines in sections]
    return [(name, body) for name, body in result if body]


def _split_long(body: str, max_chars: int) -> list[str]:
    """Pack paragraphs/bullets greedily up to max_chars; hard-split only a single huge block."""
    blocks = [b.strip() for b in re.split(r"\n\s*\n|\n(?=[-•*▪●] )", body) if b.strip()]
    pieces: list[str] = []
    current = ""
    for block in blocks:
        while len(block) > max_chars:
            cut = block.rfind(" ", 0, max_chars)
            cut = cut if cut > 0 else max_chars
            if current:
                pieces.append(current)
                current = ""
            pieces.append(block[:cut].strip())
            block = block[cut:].strip()
        if current and len(current) + len(block) + 1 > max_chars:
            pieces.append(current)
            current = block
        else:
            current = f"{current}\n{block}" if current else block
    if current:
        pieces.append(current)
    return pieces


def chunk_text(text: str, max_chars: int = MAX_CHARS) -> list[Chunk]:
    chunks: list[Chunk] = []
    for section, body in split_sections(text):
        for piece in _split_long(body, max_chars):
            chunks.append(Chunk(index=len(chunks), section=section, text=piece))
    return chunks


def embedding_text(title: str, chunk: Chunk) -> str:
    """Text we embed for a chunk. The document title is included so a chunk like a bare
    "REQUIREMENTS" list still carries *which* document/company it belongs to."""
    return f"{title} | {chunk.section}\n{chunk.text}"
