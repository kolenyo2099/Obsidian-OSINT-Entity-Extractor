import { requestUrl } from "obsidian";

import { Readability } from "@mozilla/readability";
import type { ExtractedArticle } from "./types";

const USER_AGENT = "OSINT-Entity-Extractor/0.1.1 (+https://github.com/thomasjjj/obsidian-osint-ner)";

function guessSource(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return hostname;
  } catch {
    return "";
  }
}

function trimText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n[truncated]";
}

function extractPublished(doc: Document): string {
  const selectors = [
    "meta[property='article:published_time']",
    "meta[name='article:published_time']",
    "meta[name='pubdate']",
    "meta[property='og:pubdate']",
    "meta[name='date']",
    "meta[property='article:modified_time']"
  ];

  for (const sel of selectors) {
    const meta = doc.querySelector(sel);
    const content = meta?.getAttribute("content")?.trim();
    if (content) return content;
  }
  return "";
}

function extractAuthors(byline?: string | null): string[] {
  if (!byline) return [];
  return byline
    .split(/,\s*|\s+and\s+|\s*&\s*|;\s*/i)
    .map((a) => a.trim())
    .filter(Boolean);
}

// DOMParser is available in Obsidian's environment (Electron renderer)
export async function fetchAndExtract(url: string, maxChars: number): Promise<ExtractedArticle> {
  const resp = await requestUrl({
    url,
    headers: {
      "User-Agent": USER_AGENT
    }
  });

  if (resp.status >= 400) {
    throw new Error(`HTTP ${resp.status} when fetching URL`);
  }

  const html = resp.text;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Fix relative links before passing to Readability or extracting
  const base = doc.createElement("base");
  base.href = url;
  if (doc.head) {
    doc.head.prepend(base);
  } else {
    // Fallback if no head, though Readability might not care
    const head = doc.createElement("head");
    head.prepend(base);
    doc.documentElement.prepend(head);
  }

  const reader = new Readability(doc);
  const article = reader.parse();

  const text =
    article?.textContent?.trim() ||
    doc.querySelector("article")?.textContent?.trim() ||
    doc.body?.textContent?.trim() ||
    "";

  const { links, images } = extractLinksAndImages(doc, url);

  const published = extractPublished(doc);
  const authors = extractAuthors(article?.byline);
  const sourceGuess = guessSource(url);

  return {
    title: article?.title?.trim() || "",
    authors,
    published,
    text: trimText(text, maxChars),
    sourceGuess,
    links,
    images
  };
}

function extractLinksAndImages(doc: Document, baseUrl: string) {
  const links = Array.from(doc.querySelectorAll("a"))
    .map((a) => {
      try {
        return {
          text: a.textContent?.trim() ?? "",
          href: new URL(a.getAttribute("href") || "", baseUrl).href
        };
      } catch {
        return null;
      }
    })
    .filter((l): l is { text: string; href: string } => !!l && !!l.href);

  const images = Array.from(doc.querySelectorAll("img"))
    .map((img) => {
      try {
        return {
          alt: img.getAttribute("alt")?.trim() ?? "",
          src: new URL(img.getAttribute("src") || "", baseUrl).href
        };
      } catch {
        return null;
      }
    })
    .filter((i): i is { alt: string; src: string } => !!i && !!i.src);

  return { links, images };
}
