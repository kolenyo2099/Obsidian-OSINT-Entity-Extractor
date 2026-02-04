import OpenAI from "openai";
import type { ExtractedArticle, ExtractedContent, ExtractedPdf } from "./types";
import { PROMPT_TEMPLATE } from "./prompt";
import { arrayBufferToBase64, isVisionModel } from "./pdf";

export function buildPrompt(
  url: string,
  meta: ExtractedArticle | ExtractedPdf | ExtractedContent,
  defaultTags?: string | string[],
  promptTemplate: string = PROMPT_TEMPLATE
): string {
  const articleText = meta.text.trim() || "_NO ARTICLE TEXT EXTRACTED_";

  const base = promptTemplate
    .replace("{url}", url)
    .replace("{title}", meta.title || "")
    .replace("{authors}", meta.authors.join(", "))
    .replace("{published}", meta.published || "")
    .replace("{source}", meta.sourceGuess || "")
    .replace("{article_text}", articleText);

  const tagsArray = Array.isArray(defaultTags)
    ? defaultTags
    : defaultTags
    ? defaultTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  if (tagsArray.length) {
    const tagsBlock = tagsArray.map((t) => `- ${t}`).join("\n");
    return `${base}\n\nDEFAULT TAGS TO INCLUDE IN YAML (if appropriate):\n${tagsBlock}`;
  }
  return base;
}

export async function formatWithModel(
  apiKey: string,
  model: string,
  url: string,
  meta: ExtractedArticle | ExtractedPdf | ExtractedContent,
  defaultTags?: string | string[],
  promptTemplate?: string,
  provider: "openai" | "lmstudio" = "openai",
  apiBaseUrl?: string
): Promise<string> {
  const client = getOpenAIClient(apiKey, apiBaseUrl);
  const prompt = buildPrompt(url, meta, defaultTags, promptTemplate || PROMPT_TEMPLATE);

  if (provider === "lmstudio") {
    const resp = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }]
    });
    const output = resp.choices?.[0]?.message?.content ?? "";
    return output.trim();
  }

  const resp = await client.responses.create({
    model,
    input: prompt
  });

  const output = resp.output_text ?? "";
  return output.trim();
}

/**
 * Format a PDF using native vision input (OpenAI only)
 * This sends the PDF directly to the model for visual analysis
 */
export async function formatPdfWithVision(
  apiKey: string,
  model: string,
  url: string,
  meta: ExtractedPdf,
  defaultTags?: string | string[],
  promptTemplate?: string
): Promise<string> {
  if (!isVisionModel(model)) {
    throw new Error(`Model ${model} does not support native PDF input. Use text extraction mode instead.`);
  }

  if (!meta.pdfBuffer) {
    throw new Error("PDF buffer not available for native vision processing");
  }

  const client = getOpenAIClient(apiKey);
  const prompt = buildPrompt(url, meta, defaultTags, promptTemplate || PROMPT_TEMPLATE);

  // Convert PDF to base64
  const base64Pdf = arrayBufferToBase64(meta.pdfBuffer);

  // Use chat completions API with vision/file input
  // The content parts need to be cast to handle the file type which may not be in older type definitions
  const fileContent = {
    type: "file",
    file: {
      filename: "document.pdf",
      file_data: `data:application/pdf;base64,${base64Pdf}`
    }
  };
  const textContent = {
    type: "text",
    text: prompt
  };
  const resp = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "user",
        content: [fileContent, textContent] as OpenAI.Chat.Completions.ChatCompletionContentPart[]
      }
    ],
    max_tokens: 4096
  });

  const output = resp.choices?.[0]?.message?.content ?? "";
  return output.trim();
}

let cachedClient: { key: string; baseUrl?: string; client: OpenAI } | null = null;

export function getOpenAIClient(apiKey: string, baseUrl?: string): OpenAI {
  if (cachedClient?.key === apiKey && cachedClient.baseUrl === baseUrl) return cachedClient.client;
  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl || undefined,
    // Obsidian plugins run in an Electron renderer; allow browser usage explicitly.
    ...(typeof window !== "undefined" ? { dangerouslyAllowBrowser: true } : {})
  });
  cachedClient = { key: apiKey, baseUrl, client };
  return client;
}
