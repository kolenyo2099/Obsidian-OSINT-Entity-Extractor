import os
import re
import sys
from datetime import datetime
from dateutil import tz

from newspaper import Article
from openai import OpenAI


OBSIDIAN_FORMATTER_PROMPT = """
You are an analyst assistant. Convert the provided article into a single Obsidian note written in Obsidian-flavoured Markdown.

STRICT OUTPUT RULES
- Return ONLY the final markdown note. No commentary, no code fences.
- The note MUST start with YAML frontmatter and end that block with a second line containing only '---'.
- After YAML, write the note body with the headings below.
- Wrap key named entities in [[double square brackets]] throughout the BODY only: people, organizations, countries, cities/places, weapon systems/munitions, events/operations, platforms/programs. Do NOT link generic nouns.

FRONTMATTER (STRICT YAML, OBSIDIAN PROPERTIES)
1) Valid YAML the parser can read:
   - snake_case keys only; spaces, not tabs; no duplicate keys.
   - omit unknown or uncertain fields (never output blanks or placeholders like "unknown").
2) Allowed keys and types:
   REQUIRED
   - title: quoted string (headline)
   - source: quoted string (may contain [[wikilink]] but keep inside quotes)
   - url: quoted string
   - published: ISO-8601 date or datetime (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS) with no surrounding quotes
   - type: "news_article"
   - tags: block list of lowercase slug tags (unquoted items)
   OPTIONAL (only when present)
   - author: single quoted string (use ONLY when exactly one author)
   - authors: block list of quoted strings (use when multiple authors; never include both author and authors)
   - section: quoted string
   - language: quoted string (e.g. "en")
   - location: quoted string (may contain [[wikilink]])
   - article_id: integer (no quotes)
   - topics: block list of quoted strings (may contain [[wikilinks]]; keep consistent)
3) Quoting policy:
   - Quote ALL string values with double quotes, except items under tags which must be unquoted simple slugs.
   - Always quote values containing ':', '#', '@', '[', ']', '{{', '}}', ',', or leading/trailing spaces.
4) Lists:
   - Use block lists only (no inline lists). Each item on its own line, two spaces indent under the key.
5) Self-check before output:
   - YAML starts with '---' on its own line and ends with '---'.
   - Every key has exactly one value; lists are indented consistently; no blank/placeholder values; YAML would parse.

CANONICAL YAML EXAMPLE
---
title: "Example headline"
source: "Example Source"
url: "https://example.com/news/example-article"
published: 2026-01-23
type: "news_article"
author: "Jane Doe"
tags:
  - news
  - drones
topics:
  - "Air Defence"
---

NOTE BODY STRUCTURE (REQUIRED HEADINGS)
## Summary
- 3-7 bullets capturing the key claims (with linked entities in the text).

## Key details
- Expand key facts: timeline, quantities, specs, locations, named suppliers/manufacturers, etc.

## Claims & attribution
- Separate what is claimed vs who claims it.
- Mark uncertainty clearly (unconfirmed / not independently verified in the provided text).

## Entities
Group key entities with Obsidian links:
- People
- Organisations
- Systems / equipment
- Locations
- (Optional) Platforms / sanctions / programs

## Analyst notes (optional but encouraged)
- 5-10 bullets: verification hooks, OSINT checks, notable gaps.

NOW CONVERT THIS ARTICLE
URL: {url}

METADATA (as extracted)
title: {title}
authors: {authors}
published: {published}
source: {source}

ARTICLE TEXT
{article_text}
""".strip()


def load_env_file(env_path: str) -> bool:
    """
    Load key/value pairs from a simple .env file without overriding
    variables that are already present in the environment.
    """
    if not os.path.isfile(env_path):
        return False

    loaded = False
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("\"'").strip()
            if key and key not in os.environ:
                os.environ[key] = value
                loaded = True
    return loaded


def load_env() -> bool:
    """
    Try loading a .env file from the current working directory and,
    failing that, from the directory containing this script.
    """
    candidates = [
        os.path.join(os.getcwd(), ".env"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"),
    ]

    loaded_any = False
    seen = set()
    for path in candidates:
        path = os.path.abspath(path)
        if path in seen:
            continue
        seen.add(path)
        loaded_any = load_env_file(path) or loaded_any
    return loaded_any


def sanitize_filename(name: str, max_len: int = 120) -> str:
    """
    Make a safe filename for Windows/Obsidian.
    """
    name = name.strip()
    # Remove characters invalid on Windows
    name = re.sub(r'[<>:"/\\\\|?*]', "", name)
    # Collapse whitespace
    name = re.sub(r"\s+", " ", name)
    # Avoid trailing dots/spaces (Windows)
    name = name.strip(" .")
    if not name:
        name = "untitled"
    return name[:max_len]


def iso_date_or_none(dt) -> str:
    """
    Convert newspaper3k publish_date (datetime or None) to ISO format.
    Use date-only if time info is not reliable.
    """
    if not dt:
        return ""
    # If datetime has tzinfo, keep full ISO; else keep date
    try:
        if getattr(dt, "tzinfo", None) is not None:
            return dt.isoformat()
        return dt.date().isoformat()
    except Exception:
        return ""


def fetch_article_with_newspaper(url: str) -> dict:
    """
    Download + parse article using newspaper3k.
    Returns dict with title/authors/published/text/source_guess.
    """
    art = Article(url=url, language="en")
    art.download()
    art.parse()

    title = art.title or ""
    authors = art.authors or []
    published_iso = iso_date_or_none(art.publish_date)
    text = art.text or ""

    # crude source guess from domain
    source_guess = ""
    try:
        domain = re.sub(r"^www\.", "", re.split(r"/+", url.replace("https://", "").replace("http://", ""))[0])
        source_guess = domain
    except Exception:
        pass

    return {
        "title": title,
        "authors": authors,
        "published": published_iso,
        "text": text,
        "source_guess": source_guess,
    }


def format_with_openai(url: str, meta: dict) -> str:
    """
    Send the extracted content to OpenAI and get back an Obsidian note.
    """
    client = OpenAI()

    # If newspaper extraction is weak, warn the model (still no inventions)
    extraction_note = ""
    if len(meta.get("text", "")) < 500:
        extraction_note = (
            "\n\nNOTE: The extracted article text is short; the page may be paywalled or blocked. "
            "Do NOT invent missing details - format only what is provided.\n"
        )

    prompt = OBSIDIAN_FORMATTER_PROMPT.format(
        url=url,
        title=meta.get("title", "").strip(),
        authors=", ".join(meta.get("authors", [])) if meta.get("authors") else "",
        published=meta.get("published", ""),
        source=meta.get("source_guess", ""),
        article_text=(meta.get("text", "") + extraction_note).strip(),
    )

    # Responses API (recommended for new projects)
    # Minimal params for compatibility: model + input. :contentReference[oaicite:1]{index=1}
    resp = client.responses.create(
        model="gpt-5.2",
        input=prompt
    )

    return (resp.output_text or "").strip()


def ensure_frontmatter_present(note: str) -> str:
    """
    Basic sanity checks:
    - Must start with '---'
    - Must contain a closing '---' after the first line
    """
    if not note.startswith("---"):
        raise ValueError("Model output did not start with YAML frontmatter ('---').")

    # Find second '---' boundary
    # (first is at position 0; second must appear later on a new line)
    second = note.find("\n---", 3)
    if second == -1:
        # Some models output '---' on its own line; check that too
        second = note.find("\n---\n", 3)
    if second == -1:
        raise ValueError("Model output did not include a closing YAML frontmatter delimiter ('---').")

    return note


def main():
    load_env()
    if not os.getenv("OPENAI_API_KEY"):
        print("Missing OPENAI_API_KEY. Add it to a .env file or set it in the environment.")
        return

    url = input("Paste article URL (or 'q' to quit): ").strip()
    if not url or url.lower() == "q":
        print("Exiting.")
        return

    out_dir = r"D:\Traviata_Obsidian_Vault\SyncTraviata\vault\articles"
    if not out_dir:
        out_dir = os.getcwd()

    if not os.path.isdir(out_dir):
        print(f"Output folder does not exist: {out_dir}")
        return

    print("\n[1/3] Downloading + parsing article with newspaper3k...")
    try:
        meta = fetch_article_with_newspaper(url)
    except Exception as e:
        print("Failed to fetch/parse article with newspaper3k.")
        print(f"Error: {e}")
        return

    if not meta.get("text"):
        print("Warning: No article text extracted. The site may block scraping or be paywalled.")
        print("Continuing anyway (the model will be instructed not to invent missing content).")

    print("[2/3] Sending to OpenAI for Obsidian formatting...")
    try:
        note = format_with_openai(url, meta)
        note = ensure_frontmatter_present(note)
    except Exception as e:
        print("Failed during OpenAI formatting or validation.")
        print(f"Error: {e}")
        return

    # Choose filename from extracted title, else fallback
    title = meta.get("title", "") or "article"
    filename = sanitize_filename(title) + ".md"
    path = os.path.join(out_dir, filename)

    # Avoid overwriting by appending counter
    base, ext = os.path.splitext(path)
    i = 2
    while os.path.exists(path):
        path = f"{base} ({i}){ext}"
        i += 1

    print(f"[3/3] Saving note to: {path}")
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(note.rstrip() + "\n")
    except Exception as e:
        print("Failed to write output file.")
        print(f"Error: {e}")
        return

    print("Done.")


if __name__ == "__main__":
    main()
