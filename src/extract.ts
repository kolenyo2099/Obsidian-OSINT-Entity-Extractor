import { requestUrl } from "obsidian";
import { Readability } from "@mozilla/readability";
import type { ExtractedArticle, ExtractedContent } from "./types";
import { detectContentType, fetchAndExtractPdf } from "./pdf";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

function extractLinksAndImages(articleHtml: string, baseUrl: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(articleHtml || "<div></div>", "text/html");

  // Helper to resolve relative URLs
  const resolveUrl = (href: string) => {
    try {
      return new URL(href, baseUrl).href;
    } catch {
      return "";
    }
  };

  const links = Array.from(doc.querySelectorAll("a"))
    .map((a) => {
      const rawHref = a.getAttribute("href");
      if (!rawHref) return null;
      const href = resolveUrl(rawHref);
      return {
        text: a.textContent?.trim() ?? "",
        href
      };
    })
    .filter((l): l is { text: string; href: string } => !!l && !!l.href);

  const images = Array.from(doc.querySelectorAll("img"))
    .map((img) => {
      const rawSrc = img.getAttribute("src");
      if (!rawSrc) return null;
      const src = resolveUrl(rawSrc);
      return {
        alt: img.getAttribute("alt")?.trim() ?? "",
        src
      };
    })
    .filter((i): i is { alt: string; src: string } => !!i && !!i.src);

  return { links, images };
}

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

  // Fix relative links by setting a base element if one doesn't exist
  if (!doc.querySelector("base")) {
    const base = doc.createElement("base");
    base.href = url;
    doc.head.appendChild(base);
  }

  const reader = new Readability(doc);
  const article = reader.parse();

  const text =
    article?.textContent?.trim() ||
    doc.querySelector("article")?.textContent?.trim() ||
    doc.body?.textContent?.trim() ||
    "";

  const { links, images } = extractLinksAndImages(article?.content || "", url);

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
    images,
    contentType: "html" as const
  };
}

/**
 * Unified extraction function that handles both HTML and PDF content
 * Automatically detects content type and routes to appropriate extractor
 */
export async function fetchAndExtractContent(
  url: string,
  maxChars: number,
  pdfMaxPages?: number
): Promise<ExtractedContent> {
  // Detect content type
  const { isPdf } = await detectContentType(url);

  if (isPdf) {
    return fetchAndExtractPdf(url, maxChars, pdfMaxPages);
  }

  return fetchAndExtract(url, maxChars);
}
