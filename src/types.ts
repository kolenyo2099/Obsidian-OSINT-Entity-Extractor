export interface ExtractedArticle {
  title: string;
  authors: string[];
  published: string;
  text: string;
  sourceGuess: string;
  links: { text: string; href: string }[];
  images: { alt: string; src: string }[];
}

export interface PluginSettings {
  model: string;
  outputFolder: string;
  defaultTags: string;
  openAfterCreate: boolean;
  maxChars: number;
  useCustomPrompt: boolean;
  customPrompt: string;
  includeLinks: boolean;
  includeImages: boolean;
  maxRetries: number;
  verboseLogging: boolean;
  apiKey?: string; // fallback storage when SecretStorage is unavailable
}

export const DEFAULT_SETTINGS: PluginSettings = {
  model: "gpt-5-mini",
  outputFolder: "articles",
  defaultTags: "news",
  openAfterCreate: true,
  maxChars: 12000,
  useCustomPrompt: false,
  customPrompt: "",
  includeLinks: false,
  includeImages: false,
  maxRetries: 2,
  verboseLogging: false,
  apiKey: ""
};
