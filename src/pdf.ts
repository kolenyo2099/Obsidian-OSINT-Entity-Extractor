import { requestUrl } from "obsidian";
import { extractText, getDocumentProxy, getMeta } from "unpdf";
import type { ExtractedPdf } from "./types";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Check if a URL likely points to a PDF based on extension or query params
 */
export function isPdfUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    // Check extension
    if (pathname.endsWith(".pdf")) return true;
    // Check common query params
    const format = urlObj.searchParams.get("format")?.toLowerCase();
    if (format === "pdf") return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if a Content-Type header indicates PDF
 */
export function isPdfContentType(contentType: string): boolean {
  return contentType.toLowerCase().includes("application/pdf");
}

/**
 * Detect content type by making a HEAD request first, then falling back to URL inspection
 */
export async function detectContentType(url: string): Promise<{ isPdf: boolean; contentType: string }> {
  // First check URL pattern
  if (isPdfUrl(url)) {
    return { isPdf: true, contentType: "application/pdf" };
  }

  // Try HEAD request to check Content-Type
  try {
    const resp = await requestUrl({
      url,
      method: "HEAD",
      headers: { "User-Agent": USER_AGENT }
    });
    const contentType = resp.headers["content-type"] || "";
    return {
      isPdf: isPdfContentType(contentType),
      contentType
    };
  } catch {
    // HEAD failed, assume HTML (will be detected properly during fetch)
    return { isPdf: false, contentType: "text/html" };
  }
}

/**
 * Fetch a PDF from URL and return as ArrayBuffer
 */
export async function fetchPdfAsArrayBuffer(url: string): Promise<ArrayBuffer> {
  const resp = await requestUrl({
    url,
    headers: { "User-Agent": USER_AGENT }
  });

  if (resp.status >= 400) {
    throw new Error(`HTTP ${resp.status} when fetching PDF`);
  }

  const buffer = resp.arrayBuffer;

  // Verify magic bytes %PDF-
  const header = new Uint8Array(buffer, 0, 5);
  const headerStr = String.fromCharCode(...header);
  if (!headerStr.startsWith("%PDF-")) {
    const preview = String.fromCharCode(...new Uint8Array(buffer, 0, 100));
    throw new Error(`Invalid PDF file. Content does not start with %PDF-. Preview: "${preview.slice(0, 50)}..."`);
  }

  return buffer;
}

/**
 * Guess source domain from URL
 */
function guessSource(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return hostname;
  } catch {
    return "";
  }
}

/**
 * Guess filename/title from URL
 */
function guessTitleFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split("/").pop() || "";
    // Remove .pdf extension and decode
    const decoded = decodeURIComponent(filename.replace(/\.pdf$/i, ""));
    // Convert underscores/hyphens to spaces and clean up
    return decoded.replace(/[_-]+/g, " ").trim();
  } catch {
    return "";
  }
}

/**
 * Trim text to maxChars with truncation indicator
 */
function trimText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n[truncated]";
}

/**
 * Extract text and metadata from a PDF buffer
 */
export async function extractPdfContent(
  buffer: ArrayBuffer,
  url: string,
  maxChars: number,
  maxPages?: number
): Promise<ExtractedPdf> {
  const uint8Array = new Uint8Array(buffer);
  const pdf = await getDocumentProxy(uint8Array);

  // Get metadata
  let meta: Awaited<ReturnType<typeof getMeta>> | null = null;
  try {
    meta = await getMeta(pdf);
  } catch {
    // Metadata extraction can fail on some PDFs
  }

  // Extract text
  const totalPages = pdf.numPages;
  const pagesToExtract = maxPages ? Math.min(totalPages, maxPages) : totalPages;

  let fullText = "";
  try {
    // Extract text from specified number of pages
    const result = await extractText(pdf, { mergePages: true });
    fullText = result.text;

    // If we're limiting pages and have more, add truncation note
    if (maxPages && totalPages > maxPages) {
      fullText += `\n\n[Note: Only first ${maxPages} of ${totalPages} pages extracted]`;
    }
  } catch (err) {
    console.warn("PDF text extraction failed:", err);
    fullText = "";
  }

  // Parse authors from metadata
  const authors: string[] = [];
  if (meta?.info?.Author) {
    const authorStr = String(meta.info.Author);
    // Split on common separators
    authors.push(
      ...authorStr
        .split(/[,;&]|\s+and\s+/i)
        .map((a) => a.trim())
        .filter(Boolean)
    );
  }

  // Parse date from metadata
  let published = "";
  if (meta?.info?.CreationDate) {
    try {
      // PDF dates are often in format D:YYYYMMDDHHmmss
      const dateStr = String(meta.info.CreationDate);
      const match = dateStr.match(/D:(\d{4})(\d{2})(\d{2})/);
      if (match) {
        published = `${match[1]}-${match[2]}-${match[3]}`;
      }
    } catch {
      // Ignore date parsing errors
    }
  }

  // Get title from metadata or URL
  const title = meta?.info?.Title ? String(meta.info.Title) : guessTitleFromUrl(url);

  return {
    title,
    authors,
    published,
    text: trimText(fullText, maxChars),
    sourceGuess: guessSource(url),
    links: [], // PDF link extraction is complex; skip for now
    images: [], // PDF image extraction requires additional processing
    contentType: "pdf",
    pageCount: totalPages,
    pdfBuffer: buffer
  };
}

/**
 * Main function to fetch and extract PDF content
 */
export async function fetchAndExtractPdf(
  url: string,
  maxChars: number,
  maxPages?: number
): Promise<ExtractedPdf> {
  const buffer = await fetchPdfAsArrayBuffer(url);
  return extractPdfContent(buffer, url, maxChars, maxPages);
}

/**
 * Convert ArrayBuffer to base64 string for API usage
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Check if a model supports native PDF/vision input
 */
export function isVisionModel(model: string): boolean {
  const visionModels = [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-4.1",
    "o3",
    "o3-mini",
    "o1",
    "o1-mini"
  ];
  const modelLower = model.toLowerCase();
  return visionModels.some((vm) => modelLower.includes(vm.toLowerCase()));
}
