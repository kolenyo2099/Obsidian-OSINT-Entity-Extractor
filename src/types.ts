export interface ExtractedArticle {
  title: string;
  authors: string[];
  published: string;
  text: string;
  sourceGuess: string;
  links: { text: string; href: string }[];
  images: { alt: string; src: string }[];
  contentType: "html";
}

export interface ExtractedPdf {
  title: string;
  authors: string[];
  published: string;
  text: string;
  sourceGuess: string;
  links: { text: string; href: string }[];
  images: { alt: string; src: string }[];
  contentType: "pdf";
  pageCount: number;
  pdfBuffer?: ArrayBuffer;
}

export type ExtractedContent = ExtractedArticle | ExtractedPdf;

export interface CsvUrlEntry {
  url: string;
  label?: string;
}

export interface ParsedCsv {
  entries: CsvUrlEntry[];
  errors: string[];
}

export interface BatchResult {
  success: number;
  failed: number;
  errors: { url: string; message: string }[];
}

export interface PluginSettings {
  provider: "openai" | "lmstudio";
  model: string;
  apiBaseUrl: string;
  outputFolder: string;
  defaultTags: string;
  openAfterCreate: boolean;
  maxChars: number;
  includeRaw: boolean;
  useCustomPrompt: boolean;
  customPrompt: string;
  includeLinks: boolean;
  includeImages: boolean;
  maxRetries: number;
  verboseLogging: boolean;
  apiKey?: string; // fallback storage when SecretStorage is unavailable
  // PDF settings
  pdfHandling: "text-extraction" | "native-vision";
  pdfMaxPages: number;
  // Batch processing settings
  batchDelayMs: number;
  batchContinueOnError: boolean;
  batchCreateReport: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  provider: "openai",
  model: "gpt-5-mini",
  apiBaseUrl: "http://localhost:1234/v1",
  outputFolder: "articles",
  defaultTags: "news",
  openAfterCreate: true,
  maxChars: 12000,
  includeRaw: true,
  useCustomPrompt: false,
  customPrompt: "",
  includeLinks: false,
  includeImages: false,
  maxRetries: 2,
  verboseLogging: false,
  apiKey: "",
  // PDF settings
  pdfHandling: "text-extraction",
  pdfMaxPages: 50,
  // Batch processing settings
  batchDelayMs: 1000,
  batchContinueOnError: true,
  batchCreateReport: true
};
