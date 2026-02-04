import { App, Modal, Notice, Plugin, PluginManifest, Setting, TFile } from "obsidian";
import { UrlToVaultSettingTab } from "./settings";
import { DEFAULT_SETTINGS, PluginSettings, BatchResult } from "./types";
import { fetchAndExtractContent } from "./extract";
import { formatWithModel, formatPdfWithVision, getOpenAIClient } from "./openai";
import { ensureFrontmatterPresent, saveNoteToVault } from "./note";
import type { ExtractedContent, ExtractedPdf } from "./types";
import { normalizeTags } from "./tags";
import { parseUrlInput, getSampleCsvTemplate } from "./csv";
import { isVisionModel } from "./pdf";

const SECRET_KEY_ID = "osint-ner-openai-key";

function ensureHttpScheme(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function renderTwoStepProgress(step: 1 | 2, label: string): string {
  // ASCII-safe progress indicator to avoid mojibake on some platforms.
  const bar = step === 1 ? "[# ]" : "[##]";
  return `Progress ${bar} (${step}/2) ${label}`;
}

class UrlInputModal extends Modal {
  onSubmit: (url: string) => void;
  value = "";

  constructor(app: App, onSubmit: (url: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Import article from URL" });

    const urlSetting = new Setting(contentEl).setName("Article URL");
    urlSetting.addText((text) => {
      text.inputEl.placeholder = "https://example.com/article";
      text.onChange((value) => (this.value = value.trim()));
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.close();
          this.onSubmit(this.value);
        }
      });
      text.inputEl.addEventListener("focus", () => text.inputEl.select());
      text.inputEl.focus();
    });
    urlSetting.addButton((btn) =>
      btn
        .setButtonText("Paste")
        .setTooltip("Paste URL from clipboard")
        .onClick(() => {
          void (async () => {
            try {
              const readText = navigator.clipboard?.readText;
              if (!readText) {
                new Notice("Clipboard unavailable in this context.");
                return;
              }
              const clip = await readText.call(navigator.clipboard);
              if (!clip) {
                new Notice("Clipboard is empty.");
                return;
              }
              this.value = clip.trim();
              const input = urlSetting.controlEl.querySelector("input");
              if (input) {
                input.value = this.value;
                input.focus();
                input.select();
              }
            } catch (err) {
              console.warn("Clipboard read failed", err);
              new Notice("Couldn't read clipboard in this context.");
            }
          })();
        })
    );

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Import")
        .setCta()
        .onClick(() => {
          this.close();
          void this.onSubmit(this.value);
        })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

class BatchImportModal extends Modal {
  onSubmit: (csvContent: string) => void;
  textArea: HTMLTextAreaElement | null = null;

  constructor(app: App, onSubmit: (csvContent: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Batch import from CSV" });

    contentEl.createEl("p", {
      text: "Paste a CSV with URLs or a simple list of URLs (one per line).",
      cls: "setting-item-description"
    });

    // Text area for CSV/URL list
    const textAreaContainer = contentEl.createDiv({ cls: "batch-import-textarea-container" });
    this.textArea = textAreaContainer.createEl("textarea", {
      attr: {
        rows: "12",
        placeholder: getSampleCsvTemplate()
      }
    });
    this.textArea.style.width = "100%";
    this.textArea.style.fontFamily = "monospace";
    this.textArea.style.fontSize = "12px";

    // Paste button
    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Paste from clipboard")
          .onClick(() => {
            void (async () => {
              try {
                const readText = navigator.clipboard?.readText;
                if (!readText) {
                  new Notice("Clipboard unavailable in this context.");
                  return;
                }
                const clip = await readText.call(navigator.clipboard);
                if (this.textArea) {
                  this.textArea.value = clip;
                }
              } catch (err) {
                console.warn("Clipboard read failed", err);
                new Notice("Couldn't read clipboard in this context.");
              }
            })();
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Insert sample")
          .onClick(() => {
            if (this.textArea) {
              this.textArea.value = getSampleCsvTemplate();
            }
          })
      );

    // Import button
    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Start batch import")
        .setCta()
        .onClick(() => {
          const content = this.textArea?.value || "";
          if (!content.trim()) {
            new Notice("Please enter URLs to import.");
            return;
          }
          this.close();
          void this.onSubmit(content);
        })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ManualImportModal extends Modal {
  // Callback returns the file data as ArrayBuffer
  onSubmit: (buffer: ArrayBuffer) => void;
  url: string;

  constructor(app: App, url: string, onSubmit: (buffer: ArrayBuffer) => void) {
    super(app);
    this.url = url;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Manual Import Required" });

    contentEl.createEl("p", {
      text: "We couldn't download the PDF automatically (likely due to a CAPTCHA or age verification).",
      cls: "setting-item-description"
    });

    contentEl.createEl("p", {
      text: `1. Open this URL in your browser: ${this.url}`,
      cls: "setting-item-description"
    }).createEl("a", { text: "Open Link", href: this.url, cls: "external-link" });

    contentEl.createEl("p", {
      text: "2. Download the PDF to your computer.",
      cls: "setting-item-description"
    });

    contentEl.createEl("p", {
      text: "3. Upload the downloaded file below:",
      cls: "setting-item-description"
    });

    const fileInput = contentEl.createEl("input", {
      type: "file",
      attr: { accept: ".pdf" }
    });

    // Add some spacing
    fileInput.style.marginBottom = "20px";
    fileInput.style.display = "block";

    fileInput.addEventListener("change", async () => {
      if (fileInput.files?.length) {
        const file = fileInput.files[0];
        const buffer = await file.arrayBuffer();
        this.close();
        this.onSubmit(buffer);
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

export default class UrlToVaultPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
  }
  private logVerbose(...args: unknown[]) {
    if (this.settings.verboseLogging) {
      console.debug("[OSINT-Entity-Extractor]", ...args);
    }
  }

  async onload() {
    await this.loadSettings();

    const openImportModal = () => new UrlInputModal(this.app, (url) => void this.runImport(url)).open();

    this.addCommand({
      id: "import-article-from-url",
      name: "Import article from URL",
      callback: () => {
        openImportModal();
      }
    });

    this.addCommand({
      id: "batch-import-from-csv",
      name: "Batch import from CSV/URL list",
      callback: () => {
        new BatchImportModal(this.app, (csv) => void this.runBatchImport(csv)).open();
      }
    });

    this.addRibbonIcon("link", "Import article from URL", () => {
      openImportModal();
    });

    this.addSettingTab(new UrlToVaultSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    const saved = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async getApiKey(): Promise<string> {
    if (this.app.secretStorage?.getSecret) {
      try {
        const secret = await this.app.secretStorage.getSecret(SECRET_KEY_ID);
        if (secret) return secret;
      } catch (err) {
        console.warn("SecretStorage getSecret failed", err);
      }
    }
    if (this.settings.apiKey) return this.settings.apiKey;
    if (typeof process !== "undefined" && process.env.OPENAI_API_KEY) {
      return process.env.OPENAI_API_KEY;
    }
    return "";
  }

  async setApiKey(value: string): Promise<void> {
    if (this.app.secretStorage?.setSecret) {
      try {
        await this.app.secretStorage.setSecret(SECRET_KEY_ID, value);
      } catch (err) {
        console.warn("SecretStorage setSecret failed", err);
      }
    }
    this.settings.apiKey = value;
    await this.saveSettings();
  }

  async testApiKey(): Promise<void> {
    const apiKey = await this.getApiKey();
    if (this.settings.provider === "openai" && !apiKey) {
      throw new Error("No API key saved.");
    }
    try {
      const client = getOpenAIClient(this.getApiKeyForProvider(apiKey), this.getApiBaseUrl());
      if (this.settings.provider === "lmstudio") {
        await client.models.list();
        this.logVerbose("LM Studio connection test succeeded", { baseUrl: this.getApiBaseUrl() });
        return;
      }
      // Prefer a lightweight retrieve to avoid model-listing permission issues.
      const modelToCheck = this.settings.model || "gpt-5-mini";
      await client.models.retrieve(modelToCheck);
      this.logVerbose("OpenAI key test succeeded", { modelChecked: modelToCheck });
    } catch (err: unknown) {
      const status =
        (err as { status?: number })?.status ?? (err as { response?: { status?: number } })?.response?.status;
      if (status === 401) {
        throw new Error("OpenAI rejected the API key (401). Re-enter your key in settings.");
      }
      throw err;
    }
  }

  private getApiKeyForProvider(apiKey: string): string {
    if (this.settings.provider === "lmstudio") {
      return apiKey || "lm-studio";
    }
    return apiKey;
  }

  private getApiBaseUrl(): string | undefined {
    if (this.settings.provider === "lmstudio") {
      return this.settings.apiBaseUrl?.trim() || "http://localhost:1234/v1";
    }
    return undefined;
  }
  async runImport(url: string): Promise<TFile | null> {
    const normalizedUrl = ensureHttpScheme(url);
    if (!normalizedUrl) {
      new Notice("Please enter a URL.");
      return null;
    }
    try {
      new URL(normalizedUrl);
    } catch {
      new Notice("Please enter a valid URL.");
      return null;
    }

    const apiKey = await this.getApiKey();
    if (this.settings.provider === "openai" && !apiKey) {
      new Notice("Set your OpenAI API key in the plugin settings first.", 6000);
      return null;
    }

    const progress = new Notice(renderTwoStepProgress(1, "Fetching content..."), 0);

    try {
      // Use unified extraction that handles both HTML and PDF
      const meta = await fetchAndExtractContent(
        normalizedUrl,
        this.settings.maxChars,
        this.settings.pdfMaxPages
      );

      // ... continue with processing ...
      return await this.processExtractedContent(meta, apiKey, progress, normalizedUrl);

    } catch (err: unknown) {
      console.error(err);
      let message = err instanceof Error ? err.message : String(err);
      const isBlockage = message.includes("403") || message.includes("401") || message.includes("Invalid PDF");

      if (isBlockage) {
        progress.hide();
        new Notice("Automated download failed. Switching to manual import...");

        return new Promise((resolve) => {
          new ManualImportModal(this.app, normalizedUrl, async (buffer) => {
            try {
              // We have the buffer manually now.
              // Construct a "fake" ExtractedPdf object from the buffer
              const { extractPdfContent } = await import("./pdf");
              const meta = await extractPdfContent(buffer, normalizedUrl, this.settings.maxChars, this.settings.pdfMaxPages);

              // Resume processing
              const progress2 = new Notice(renderTwoStepProgress(1, "Processing manual file..."), 0);
              const file = await this.processExtractedContent(meta, apiKey, progress2, normalizedUrl);
              resolve(file);
            } catch (innerErr) {
              new Notice(`Manual import failed: ${innerErr}`, 8000);
              resolve(null);
            }
          }).open();
        });
      }

      if (message.includes("401")) {
        message += " (Check your API key or if the URL requires authentication)";
      }

      new Notice(`Import failed: ${message}`, 8000);
      return null;
    } finally {
      progress.hide();
    }
  }

  // Refactored common processing logic
  async processExtractedContent(meta: ExtractedContent, apiKey: string, progress: Notice, normalizedUrl: string): Promise<TFile> {
    const isPdf = meta.contentType === "pdf";
    this.logVerbose("Fetched metadata", { ...meta, pdfBuffer: isPdf ? "[ArrayBuffer]" : undefined });

    if (!meta.text) {
      const contentType = isPdf ? "PDF" : "article";
      new Notice(`No ${contentType} text extracted; sending minimal content to LLM.`, 6000);
    }

    if (isPdf) {
      const pdfMeta = meta as ExtractedPdf;
      this.logVerbose(`PDF detected: ${pdfMeta.pageCount} pages`);
    }

    const providerLabel = this.settings.provider === "lmstudio" ? "LM Studio" : "OpenAI";
    progress.setMessage(renderTwoStepProgress(2, `Formatting with ${providerLabel}...`));

    const promptTemplate =
      this.settings.useCustomPrompt && this.settings.customPrompt.trim()
        ? this.settings.customPrompt
        : undefined;
    if (this.settings.useCustomPrompt && !promptTemplate) {
      new Notice("Custom prompt is empty; using default prompt instead.", 5000);
    }

    const defaultTags = normalizeTags(this.settings.defaultTags);

    // Determine if we should use native PDF vision
    let note: string;
    const useNativeVision =
      isPdf &&
      this.settings.provider === "openai" &&
      this.settings.pdfHandling === "native-vision" &&
      isVisionModel(this.settings.model);

    if (useNativeVision && isPdf) {
      const pdfMeta = meta as ExtractedPdf;
      this.logVerbose("Using native PDF vision processing");
      note = await this.callPdfVisionWithRetries(apiKey, normalizedUrl, pdfMeta, promptTemplate, defaultTags);
    } else {
      // Text extraction path (works for both HTML and PDF)
      note = await this.callModelWithRetries(apiKey, normalizedUrl, meta, promptTemplate, defaultTags);
    }

    const validated = ensureFrontmatterPresent(note);
    const parts: string[] = [];
    parts.push(validated);

    if (this.settings.includeRaw) {
      const rawHeader = isPdf ? "## Extracted PDF text (plaintext)" : "## Extracted article (plaintext)";
      const rawBody = meta.text?.trim() ? meta.text.trim() : "_No text extracted._";
      parts.push("", rawHeader, "", rawBody);
    }

    if (this.settings.includeLinks && meta.links.length) {
      parts.push("", "## Extracted links");
      const linkLines = meta.links.map((l) => {
        const text = l.text || l.href;
        return `- [${text}](${l.href})`;
      });
      parts.push(...linkLines);
    }

    if (this.settings.includeImages && meta.images.length) {
      parts.push("", "## Extracted images");
      const imageLines = meta.images.map((img) => {
        const alt = img.alt || "image";
        return `- ![${alt}](${img.src})`;
      });
      parts.push(...imageLines);
    }

    const finalNote = parts.join("\n");

    const file = await saveNoteToVault(
      this.app.vault,
      this.settings.outputFolder,
      meta.title || (isPdf ? "document" : "article"),
      finalNote
    );

    if (this.settings.openAfterCreate) {
      await this.app.workspace.getLeaf(true).openFile(file);
    }

    progress.setMessage("Done");
    new Notice(`Saved: ${file.path}`);
    return file;
  }

  async runBatchImport(csvContent: string): Promise<void> {
    const { entries, errors } = parseUrlInput(csvContent);

    if (errors.length > 0) {
      this.logVerbose("CSV parsing errors:", errors);
      new Notice(`CSV parsing: ${errors.length} warning(s). Check console for details.`, 5000);
    }

    if (entries.length === 0) {
      new Notice("No valid URLs found in the input.");
      return;
    }

    const apiKey = await this.getApiKey();
    if (this.settings.provider === "openai" && !apiKey) {
      new Notice("Set your OpenAI API key in the plugin settings first.", 6000);
      return;
    }

    new Notice(`Starting batch import of ${entries.length} URL(s)...`);
    const progress = new Notice(`Batch: 0/${entries.length}`, 0);

    const results: BatchResult = {
      success: 0,
      failed: 0,
      errors: []
    };

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const label = entry.label || entry.url;
      progress.setMessage(`Batch: ${i + 1}/${entries.length} - ${label.slice(0, 40)}...`);

      try {
        const file = await this.runImportSilent(entry.url);
        if (file) {
          results.success++;
        } else {
          results.failed++;
          results.errors.push({ url: entry.url, message: "Import returned null" });
        }
      } catch (err: unknown) {
        results.failed++;
        const message = err instanceof Error ? err.message : String(err);
        results.errors.push({ url: entry.url, message });
        this.logVerbose(`Batch import error for ${entry.url}:`, err);

        if (!this.settings.batchContinueOnError) {
          progress.hide();
          new Notice(`Batch stopped due to error: ${message}`, 8000);
          break;
        }
      }

      // Rate limiting delay between requests
      if (i < entries.length - 1) {
        await this.sleep(this.settings.batchDelayMs);
      }
    }

    progress.hide();

    // Show results
    const resultMsg = `Batch complete: ${results.success} succeeded, ${results.failed} failed`;
    new Notice(resultMsg, 6000);

    // Create error report if enabled and there were errors
    if (this.settings.batchCreateReport && results.errors.length > 0) {
      await this.createBatchErrorReport(results);
    }
  }

  /**
   * Silent version of runImport that doesn't show per-item notices
   * Used by batch processing
   */
  private async runImportSilent(url: string): Promise<TFile | null> {
    const normalizedUrl = ensureHttpScheme(url);
    if (!normalizedUrl) {
      throw new Error("Empty URL");
    }
    try {
      new URL(normalizedUrl);
    } catch {
      throw new Error("Invalid URL");
    }

    const apiKey = await this.getApiKey();

    // Use unified extraction that handles both HTML and PDF
    const meta = await fetchAndExtractContent(
      normalizedUrl,
      this.settings.maxChars,
      this.settings.pdfMaxPages
    );

    const isPdf = meta.contentType === "pdf";
    this.logVerbose("Fetched metadata (batch)", { title: meta.title, isPdf });

    const promptTemplate =
      this.settings.useCustomPrompt && this.settings.customPrompt.trim()
        ? this.settings.customPrompt
        : undefined;

    const defaultTags = normalizeTags(this.settings.defaultTags);

    // Determine if we should use native PDF vision
    let note: string;
    const useNativeVision =
      isPdf &&
      this.settings.provider === "openai" &&
      this.settings.pdfHandling === "native-vision" &&
      isVisionModel(this.settings.model);

    if (useNativeVision && isPdf) {
      const pdfMeta = meta as ExtractedPdf;
      note = await this.callPdfVisionWithRetries(apiKey, normalizedUrl, pdfMeta, promptTemplate, defaultTags);
    } else {
      note = await this.callModelWithRetries(apiKey, normalizedUrl, meta, promptTemplate, defaultTags);
    }

    const validated = ensureFrontmatterPresent(note);
    const parts: string[] = [];
    parts.push(validated);

    if (this.settings.includeRaw) {
      const rawHeader = isPdf ? "## Extracted PDF text (plaintext)" : "## Extracted article (plaintext)";
      const rawBody = meta.text?.trim() ? meta.text.trim() : "_No text extracted._";
      parts.push("", rawHeader, "", rawBody);
    }

    if (this.settings.includeLinks && meta.links.length) {
      parts.push("", "## Extracted links");
      const linkLines = meta.links.map((l) => {
        const text = l.text || l.href;
        return `- [${text}](${l.href})`;
      });
      parts.push(...linkLines);
    }

    if (this.settings.includeImages && meta.images.length) {
      parts.push("", "## Extracted images");
      const imageLines = meta.images.map((img) => {
        const alt = img.alt || "image";
        return `- ![${alt}](${img.src})`;
      });
      parts.push(...imageLines);
    }

    const finalNote = parts.join("\n");

    return saveNoteToVault(
      this.app.vault,
      this.settings.outputFolder,
      meta.title || (isPdf ? "document" : "article"),
      finalNote
    );
  }

  private async createBatchErrorReport(results: BatchResult): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const lines = [
      "---",
      `title: "Batch Import Report ${timestamp}"`,
      "type: batch_report",
      `total_success: ${results.success}`,
      `total_failed: ${results.failed}`,
      "---",
      "",
      "## Batch Import Errors",
      ""
    ];

    for (const error of results.errors) {
      lines.push(`- **${error.url}**`);
      lines.push(`  - Error: ${error.message}`);
      lines.push("");
    }

    const content = lines.join("\n");
    const filename = `batch-report-${timestamp}`;

    try {
      const file = await saveNoteToVault(
        this.app.vault,
        this.settings.outputFolder,
        filename,
        content
      );
      this.logVerbose("Created batch error report:", file.path);
    } catch (err) {
      console.warn("Failed to create batch error report:", err);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async callModelWithRetries(
    apiKey: string,
    url: string,
    meta: ExtractedContent,
    promptTemplate?: string,
    defaultTags?: string[]
  ): Promise<string> {
    const maxRetries = this.settings.maxRetries ?? 0;
    let attempt = 0;
    let lastError: unknown;
    const provider = this.settings.provider;
    const providerLabel = provider === "lmstudio" ? "LM Studio" : "OpenAI";

    while (attempt <= maxRetries) {
      try {
        return await formatWithModel(
          this.getApiKeyForProvider(apiKey),
          this.settings.model,
          url,
          meta,
          defaultTags,
          promptTemplate,
          provider,
          this.getApiBaseUrl()
        );
      } catch (err: unknown) {
        lastError = err;
        const status =
          (err as { status?: number })?.status ?? (err as { response?: { status?: number } })?.response?.status;
        const code =
          (err as { code?: string })?.code ??
          (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code;
        const msg: string = err instanceof Error ? err.message : String(err);
        this.logVerbose(`${providerLabel} error`, { attempt, status, code, msg });

        // Non-retriable: bad key or quota
        if (status === 401 && provider === "openai") {
          throw new Error("OpenAI rejected the API key (401). Re-enter your key in settings.");
        }
        if (code === "insufficient_quota" && provider === "openai") {
          throw new Error("OpenAI quota exhausted. Check billing/usage.");
        }

        // Retriable: 429 (rate limit), 5xx
        const retriable = status === 429 || (status && status >= 500);
        if (!retriable || attempt === maxRetries) {
          break;
        }

        // Backoff: 0.5s, 2s, 4s...
        const delayMs = 500 * Math.pow(2, attempt);
        await new Promise((res) => setTimeout(res, delayMs));
        attempt += 1;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async callPdfVisionWithRetries(
    apiKey: string,
    url: string,
    meta: ExtractedPdf,
    promptTemplate?: string,
    defaultTags?: string[]
  ): Promise<string> {
    const maxRetries = this.settings.maxRetries ?? 0;
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= maxRetries) {
      try {
        return await formatPdfWithVision(
          apiKey,
          this.settings.model,
          url,
          meta,
          defaultTags,
          promptTemplate
        );
      } catch (err: unknown) {
        lastError = err;
        const status =
          (err as { status?: number })?.status ?? (err as { response?: { status?: number } })?.response?.status;
        const code =
          (err as { code?: string })?.code ??
          (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code;
        const msg: string = err instanceof Error ? err.message : String(err);
        this.logVerbose("OpenAI vision error", { attempt, status, code, msg });

        // Non-retriable: bad key or quota
        if (status === 401) {
          throw new Error("OpenAI rejected the API key (401). Re-enter your key in settings.");
        }
        if (code === "insufficient_quota") {
          throw new Error("OpenAI quota exhausted. Check billing/usage.");
        }

        // Retriable: 429 (rate limit), 5xx
        const retriable = status === 429 || (status && status >= 500);
        if (!retriable || attempt === maxRetries) {
          break;
        }

        // Backoff: 0.5s, 2s, 4s...
        const delayMs = 500 * Math.pow(2, attempt);
        await new Promise((res) => setTimeout(res, delayMs));
        attempt += 1;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

