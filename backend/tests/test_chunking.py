from app.ingest.chunking import chunk_text, is_heading, split_sections

RESUME = """Jane Doe
jane@example.com

SUMMARY
Backend engineer with 6 years of Python.

EXPERIENCE
Acme Corp - Senior Engineer
- Built ingestion pipelines on AWS
- Led a team of 4

Skills:
Python, FastAPI, PostgreSQL
"""


def test_headings_detected():
    assert is_heading("EXPERIENCE")
    assert is_heading("Skills:")
    assert is_heading("Nice to have")
    assert not is_heading("Built ingestion pipelines on AWS")
    assert not is_heading("jane@example.com")
    assert not is_heading("")


def test_sections_split_and_named():
    names = [n for n, _ in split_sections(RESUME)]
    assert names == ["header", "summary", "experience", "skills"]


def test_chunks_carry_section_and_sequential_index():
    chunks = chunk_text(RESUME)
    assert [c.index for c in chunks] == list(range(len(chunks)))
    assert {c.section for c in chunks} == {"header", "summary", "experience", "skills"}
    assert all("Skills" not in c.text for c in chunks)  # heading line is metadata, not content


def test_oversized_section_is_split_on_bullets_within_limit():
    body = "\n".join(f"- bullet number {i} " + "x" * 80 for i in range(60))
    chunks = chunk_text(f"EXPERIENCE\n{body}", max_chars=500)
    assert len(chunks) > 1
    assert all(len(c.text) <= 500 for c in chunks)
    assert all(c.section == "experience" for c in chunks)


def test_single_giant_block_is_hard_split():
    chunks = chunk_text("REQUIREMENTS\n" + ("word " * 1000), max_chars=300)
    assert len(chunks) > 1
    assert all(len(c.text) <= 300 for c in chunks)


def test_empty_text_gives_no_chunks():
    assert chunk_text("") == []


def test_markdown_headings_from_extracted_web_pages():
    page = "# Backend Engineer\n\nAcme builds tools.\n\n## Requirements\n\n- Python\n- SQL\n\n**Nice to have**\n\n- Terraform"
    names = [n for n, _ in split_sections(page)]
    assert names == ["header", "requirements", "nice to have"]
    assert is_heading("## Benefits") and is_heading("**Requirements**:")
    assert not is_heading("- **Python** experience")  # bullets are content, not headings
