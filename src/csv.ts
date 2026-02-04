import Papa from "papaparse";
import type { CsvUrlEntry, ParsedCsv } from "./types";

/**
 * Common URL column names to look for in CSV headers
 */
const URL_COLUMN_PATTERNS = ["url", "link", "href", "source", "uri", "address"];

/**
 * Common label/title column names to look for in CSV headers
 */
const LABEL_COLUMN_PATTERNS = ["label", "title", "name", "description", "desc"];

/**
 * Check if a string looks like a valid URL
 */
export function isValidUrl(str: string): boolean {
  if (!str || typeof str !== "string") return false;
  const trimmed = str.trim();
  if (!trimmed) return false;

  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Detect which column contains URLs based on header names
 */
export function detectUrlColumn(headers: string[]): string | null {
  if (!headers || headers.length === 0) return null;

  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());

  // First try exact matches
  for (const pattern of URL_COLUMN_PATTERNS) {
    const index = lowerHeaders.indexOf(pattern);
    if (index !== -1) return headers[index];
  }

  // Then try partial matches
  for (const pattern of URL_COLUMN_PATTERNS) {
    const index = lowerHeaders.findIndex((h) => h.includes(pattern));
    if (index !== -1) return headers[index];
  }

  // Fall back to first column
  return headers[0];
}

/**
 * Detect which column contains labels/titles based on header names
 */
export function detectLabelColumn(headers: string[]): string | null {
  if (!headers || headers.length === 0) return null;

  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());

  // Try exact matches
  for (const pattern of LABEL_COLUMN_PATTERNS) {
    const index = lowerHeaders.indexOf(pattern);
    if (index !== -1) return headers[index];
  }

  // Then try partial matches
  for (const pattern of LABEL_COLUMN_PATTERNS) {
    const index = lowerHeaders.findIndex((h) => h.includes(pattern));
    if (index !== -1) return headers[index];
  }

  return null;
}

/**
 * Normalize a URL string (add https if missing)
 */
function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Parse CSV content and extract URL entries
 */
export function parseCsvContent(csvText: string): ParsedCsv {
  const errors: string[] = [];

  if (!csvText || !csvText.trim()) {
    return { entries: [], errors: ["CSV content is empty"] };
  }

  // Parse CSV with PapaParse
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim()
  });

  // Collect parse errors
  if (result.errors && result.errors.length > 0) {
    for (const err of result.errors) {
      errors.push(`Row ${err.row ?? "?"}: ${err.message}`);
    }
  }

  // Get headers
  const headers = result.meta.fields || [];
  if (headers.length === 0) {
    return { entries: [], errors: ["No headers found in CSV"] };
  }

  // Detect URL and label columns
  const urlColumn = detectUrlColumn(headers);
  const labelColumn = detectLabelColumn(headers);

  if (!urlColumn) {
    return { entries: [], errors: ["Could not detect URL column in CSV"] };
  }

  // Extract entries
  const entries: CsvUrlEntry[] = [];
  const seenUrls = new Set<string>();

  for (let i = 0; i < result.data.length; i++) {
    const row = result.data[i];
    const rawUrl = row[urlColumn];

    if (!rawUrl || typeof rawUrl !== "string") {
      continue;
    }

    const url = normalizeUrl(rawUrl);

    if (!isValidUrl(url)) {
      errors.push(`Row ${i + 2}: Invalid URL "${rawUrl}"`);
      continue;
    }

    // Skip duplicates
    if (seenUrls.has(url)) {
      continue;
    }
    seenUrls.add(url);

    const entry: CsvUrlEntry = { url };

    // Add label if available
    if (labelColumn && row[labelColumn]) {
      entry.label = row[labelColumn].trim();
    }

    entries.push(entry);
  }

  return { entries, errors };
}

/**
 * Parse a simple list of URLs (one per line, no headers)
 */
export function parseUrlList(text: string): ParsedCsv {
  const errors: string[] = [];
  const entries: CsvUrlEntry[] = [];
  const seenUrls = new Set<string>();

  const lines = text.split(/\r?\n/).filter((line) => line.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue; // Skip comments

    // ALWAYS split on first comma - treat as "URL, Label" format
    // If user has URLs with commas, they should use proper CSV with headers and quoting
    const commaIndex = line.indexOf(",");
    let urlPart = line;
    let labelPart = "";

    if (commaIndex !== -1) {
      urlPart = line.substring(0, commaIndex).trim();
      labelPart = line.substring(commaIndex + 1).trim();
      console.debug(`[CSV] Split line: URL="${urlPart}", Label="${labelPart}"`);
    }

    const url = normalizeUrl(urlPart);
    if (!isValidUrl(url)) {
      // One last check: maybe the original line was the URL and isValidUrl is flaky?
      // No, if isValidUrl(url) is false, we can't save it anyway.
      errors.push(`Line ${i + 1}: Invalid URL "${urlPart}"`);
      continue;
    }

    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    const entry: CsvUrlEntry = { url };
    if (labelPart) {
      entry.label = labelPart;
    }

    entries.push(entry);
  }

  return { entries, errors };
}

/**
 * Auto-detect format and parse (CSV with headers vs simple URL list)
 */
export function parseUrlInput(text: string): ParsedCsv {
  const trimmed = text.trim();
  if (!trimmed) {
    return { entries: [], errors: ["Input is empty"] };
  }

  // Check if it looks like CSV with headers
  const firstLine = trimmed.split(/\r?\n/)[0].toLowerCase();
  const hasCommas = firstLine.includes(",");

  // Explicitly check for common header patterns - don't rely on isValidUrl which is too permissive
  const headerPatterns = ["url", "link", "href", "source", "uri", "label", "title", "name"];
  const looksLikeHeader = hasCommas && headerPatterns.some(pattern => firstLine.includes(pattern));

  if (looksLikeHeader) {
    console.debug("[CSV] Detected header row, using PapaParse");
    return parseCsvContent(trimmed);
  }

  // Otherwise treat as simple URL list
  console.debug("[CSV] No header detected, using URL list parser");
  return parseUrlList(trimmed);
}

/**
 * Generate a sample CSV template
 */
export function getSampleCsvTemplate(): string {
  return `url,label
https://example.com/article1,First Article
https://example.com/document.pdf,PDF Document
https://example.com/article2,Second Article`;
}
