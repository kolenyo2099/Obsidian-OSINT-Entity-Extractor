import { App, PluginSettingTab, Setting, debounce, TextAreaComponent } from "obsidian";
import type UrlToVaultPlugin from "./main";
import { PROMPT_TEMPLATE } from "./prompt";

export class UrlToVaultSettingTab extends PluginSettingTab {
  plugin: UrlToVaultPlugin;
  private saveSettingsDebounced = debounce(() => this.plugin.saveSettings(), 500, true);

  constructor(app: App, plugin: UrlToVaultPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "URL to Vault" });

    new Setting(containerEl)
      .setName("OpenAI API key")
      .setDesc("Stored via Obsidian SecretStorage when available; otherwise saved in plugin data.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.placeholder = "sk-...";
        this.plugin.getApiKey().then((key) => {
          if (key) text.setValue(key);
        });
        text.onChange(async (value) => {
          await this.plugin.setApiKey(value.trim());
        });
      });

    new Setting(containerEl)
      .setName("Model")
      .setDesc("OpenAI model used for formatting (Responses API).")
      .addText((text) =>
        text
          .setPlaceholder("gpt-5-mini")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim() || "gpt-5-mini";
            this.saveSettingsDebounced();
          })
      );

    new Setting(containerEl)
      .setName("Output folder")
      .setDesc("Relative to your vault. Will be created if it doesn't exist.")
      .addText((text) =>
        text
          .setPlaceholder("articles")
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async (value) => {
            this.plugin.settings.outputFolder = value.trim();
            this.saveSettingsDebounced();
          })
      );

    new Setting(containerEl)
      .setName("Default tags")
      .setDesc("Comma-separated tags to inject into the YAML tags list.")
      .addText((text) =>
        text
          .setPlaceholder("news,reading")
          .setValue(this.plugin.settings.defaultTags)
          .onChange(async (value) => {
            this.plugin.settings.defaultTags = value.trim();
            this.saveSettingsDebounced();
          })
      );

    new Setting(containerEl)
      .setName("Trim article text at")
      .setDesc("Maximum number of characters sent to OpenAI (to avoid token blowups).")
      .addText((text) =>
        text
          .setPlaceholder("12000")
          .setValue(String(this.plugin.settings.maxChars))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (!Number.isNaN(parsed) && parsed > 0) {
              this.plugin.settings.maxChars = parsed;
              this.saveSettingsDebounced();
            }
          })
      );

    new Setting(containerEl)
      .setName("Open created note")
      .setDesc("Open the note after creation.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openAfterCreate)
          .onChange(async (value) => {
            this.plugin.settings.openAfterCreate = value;
            this.saveSettingsDebounced();
          })
      );

    containerEl.createEl("h3", { text: "Prompt (advanced)" });

    new Setting(containerEl)
      .setName("Use custom prompt")
      .setDesc("When on, the prompt below overrides the built-in prompt.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useCustomPrompt)
          .onChange(async (value) => {
            this.plugin.settings.useCustomPrompt = value;
            this.saveSettingsDebounced();
          })
      );

    let promptArea: TextAreaComponent | null = null;

    const promptSetting = new Setting(containerEl)
      .setName("Custom prompt")
      .setDesc(
        "Leave blank to keep using the built-in prompt. Insert the default to edit a copy, or clear to start fresh."
      )
      .addButton((btn) =>
        btn
          .setButtonText("Insert default prompt")
          .setTooltip("Copy the shipped prompt into the box so you can edit it.")
          .onClick(() => {
            this.plugin.settings.customPrompt = PROMPT_TEMPLATE;
            if (promptArea) promptArea.setValue(PROMPT_TEMPLATE);
            this.saveSettingsDebounced();
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Clear")
          .setTooltip("Empty the custom prompt box.")
          .onClick(() => {
            this.plugin.settings.customPrompt = "";
            if (promptArea) promptArea.setValue("");
            this.saveSettingsDebounced();
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Revert to default")
          .setTooltip("Stop using a custom prompt and discard it.")
          .onClick(() => {
            const confirmed = window.confirm("Revert to the built-in prompt and discard the custom one?");
            if (!confirmed) return;
            this.plugin.settings.useCustomPrompt = false;
            this.plugin.settings.customPrompt = "";
            if (promptArea) promptArea.setValue("");
            this.saveSettingsDebounced();
            // Also refresh the toggle state visually
            this.display();
          })
      );

    promptArea = promptSetting.addTextArea((text) =>
      text
        .setPlaceholder("Custom prompt (optional)")
        .setValue(this.plugin.settings.customPrompt)
        .onChange(async (value) => {
          this.plugin.settings.customPrompt = value;
          this.saveSettingsDebounced();
        })
    );
    promptArea.inputEl.rows = 14;
    promptArea.inputEl.addClass("url-to-vault-prompt-area");
  }
}
