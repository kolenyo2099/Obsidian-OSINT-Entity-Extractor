To make this an **Obsidian plugin**, you’re essentially going to **port the workflow from Python to TypeScript/JavaScript** (the language Obsidian plugins run in), then wrap it in an Obsidian command + settings UI.

Below is the practical path that maps 1:1 to what your script does today.

---

## 1) Decide your architecture (2 realistic options)

### Option A (recommended): **Pure Obsidian plugin (TypeScript)**

Re-implement these pieces in TS inside the plugin:

* fetch HTML
* extract readable article text
* call OpenAI
* write a new `.md` file into your vault

This is the “normal” way to ship an Obsidian plugin. Obsidian’s official “Build a plugin” guide starts you from the sample plugin scaffold. ([Developer Documentation][1])

### Option B: Plugin as a **thin wrapper around your existing Python**

Plugin calls a local Python executable / local server (e.g., `localhost:8765/format`) and then writes output into the vault.

* Pro: keeps your Python code
* Con: packaging is a pain (per-OS, mobile won’t work, users must install Python + deps)

If you want this to be “click a command, paste URL, done” for normal users, Option A wins.

---

## 2) What your plugin will look like in Obsidian (UX)

Minimum “v1” UX:

* Command: **“Import article from URL (OpenAI → Obsidian note)”**
* Modal input: URL
* Settings tab:

  * OpenAI API key
  * Model (default `gpt-5.2`)
  * Output folder (e.g. `vault/articles`)
  * Optional: default tags, prompt template override
* On run:

  1. download page HTML
  2. extract readable text + metadata
  3. send to OpenAI (Responses API)
  4. validate frontmatter exists
  5. save note as `{sanitized title}.md` (avoid overwrites like you do now)
  6. optionally open the created note

---

## 3) Development setup (Obsidian plugin basics)

1. Install prerequisites: Node.js + npm.
2. Clone the Obsidian sample plugin and rename it. The official docs walk through build + loading it into Obsidian. ([Developer Documentation][1])
3. During development you’ll copy your built plugin to:

   * `<vault>/.obsidian/plugins/<your-plugin>/`
     containing:
   * `manifest.json`
   * `main.js`
   * (optional) `styles.css`

Release structure (still true): plugins ship as `main.js` + `manifest.json` and are usually attached to GitHub releases for distribution. ([Medium][2])

---

## 4) Map your Python code to Obsidian APIs

### A) Fetching the article HTML (CORS-safe)

In Obsidian plugins, **don’t rely on `fetch()`** for arbitrary sites; you can hit CORS issues.
Use Obsidian’s request helper instead (`requestUrl` / `request`) which is specifically used to bypass CORS restrictions. ([Obsidian Forum][3])

Conceptually:

```ts
import { requestUrl } from "obsidian";

const resp = await requestUrl({ url });
const html = resp.text;
```

### B) Extracting “readable” article text

You used `newspaper3k`. In TS, the closest equivalent is:

* parse DOM (often `jsdom`)
* run **Mozilla Readability** (`@mozilla/readability`)
* (optional) convert the cleaned HTML to Markdown (e.g., `turndown`)

**Important gotcha:** Obsidian **mobile** can be fussier about Node-style dependencies; test early if you care about mobile. Obsidian has specific mobile dev guidance. ([Developer Documentation][4])
(If mobile matters, you may want a simpler fallback extractor: strip scripts/styles + take `<article>` / `<main>` text.)

### C) Calling OpenAI (Responses API)

Your Python uses `client.responses.create(...)`. You can do the same with the **OpenAI JavaScript SDK**.
OpenAI’s current “quickstart” shows the `responses.create` pattern, and the Responses API reference documents it. ([OpenAI Platform][5])

Conceptually:

```ts
import OpenAI from "openai";

const client = new OpenAI({ apiKey });
const response = await client.responses.create({
  model: "gpt-5.2",
  input: prompt
});
const note = response.output_text?.trim() ?? "";
```

### D) Storing the API key safely

Don’t store secrets in plain plugin settings if you can avoid it.

Obsidian now has a **SecretStorage API** in the official TypeScript API docs, and Obsidian 1.11.4 introduced it as an opt-in way for plugins to save keys. ([Developer Documentation][6])

So you’d typically:

* store non-sensitive config in `this.saveData()`
* store the OpenAI key in `this.app.secretStorage.setSecret(...)`

### E) Writing the markdown file into the vault

Use Obsidian’s vault adapter:

* `this.app.vault.create(path, content)`
* ensure folder exists (`vault.createFolder(...)` if needed)
* implement your filename sanitization + “(2)” counter logic exactly like your Python

---

## 5) Implement your current logic as plugin modules

A clean way to structure it:

**`main.ts`**

* registers command(s)
* opens modal
* orchestrates pipeline
* writes note
* shows Notices / progress

**`settings.ts`**

* settings interface
* settings tab UI
* SecretStorage handling for API key

**`extract.ts`**

* `fetchHtml(url): Promise<string>`
* `extractReadable(html, url): { title, byline/authors, published?, text, siteName? }`

**`openai.ts`**

* builds your `OBSIDIAN_FORMATTER_PROMPT`
* calls Responses API

**`note.ts`**

* frontmatter validation (your `ensure_frontmatter_present`)
* sanitize filename
* avoid overwrite

---

## 6) Key pitfalls you’ll want to handle up front

### Token limits / huge articles

Your Python sends full text. In a plugin you should:

* cap extracted text length (e.g., first N chars) and/or
* do a 2-step: compress → format (optional)

### Paywalls / blocked pages

Same issue as now. Preserve your “don’t invent” instruction and add a visible warning in Obsidian (Notice) when extracted text is short.

### YAML correctness

Keep your validation step. You can tighten it by:

* checking the note starts with `---\n`
* ensuring a second `\n---\n` exists
* optionally parse YAML with a library (but your string checks are usually enough)

### Privacy

Be explicit in your README: the plugin sends article text to OpenAI.

### Mobile compatibility

If you want it on mobile:

* avoid native Node dependencies
* test with Obsidian’s mobile emulation + real device testing guidance ([Developer Documentation][4])
* consider a fallback extractor when Readability/JSDOM isn’t available

---

## 7) The shortest “build order” that gets you to a working v1

1. Scaffold from sample plugin ([Developer Documentation][1])
2. Add a command + URL modal
3. Implement `requestUrl` fetch (desktop first) ([Obsidian Forum][7])
4. Implement basic extraction (even naive: strip tags → text)
5. Add OpenAI SDK call (`responses.create`) ([OpenAI Platform][5])
6. Save file into a chosen folder
7. Add settings + SecretStorage for API key ([Developer Documentation][6])
8. Improve extraction (Readability + markdown conversion)
9. Add polish: progress notices, open created note, error handling

---

## If you want, I can write the actual plugin skeleton

If you say “yes”, I’ll generate:

* `manifest.json`
* `main.ts` (command + modal + pipeline)
* `settings.ts` (SecretStorage-backed API key)
* `extract.ts` (requestUrl + Readability)
* `openai.ts` (your exact prompt template)
* `note.ts` (filename + overwrite avoidance + frontmatter check)

…and it’ll be ready to `npm run build` and drop into `.obsidian/plugins/<name>/`.

[1]: https://docs.obsidian.md/Plugins/Getting%2Bstarted/Build%2Ba%2Bplugin?utm_source=chatgpt.com "Build a plugin - Developer Documentation"
[2]: https://medium.com/%40lukasbach/a-more-streamlined-development-workflow-for-obsidian-plugins-2a74b0c57c0f?utm_source=chatgpt.com "A more streamlined development workflow for Obsidian ..."
[3]: https://forum.obsidian.md/t/make-http-requests-from-plugins/15461?utm_source=chatgpt.com "Make HTTP requests from plugins - Developers: Plugin & API"
[4]: https://docs.obsidian.md/Plugins/Getting%2Bstarted/Mobile%2Bdevelopment?utm_source=chatgpt.com "Mobile development - Developer Documentation"
[5]: https://platform.openai.com/docs/quickstart?utm_source=chatgpt.com "Developer quickstart | OpenAI API"
[6]: https://docs.obsidian.md/Reference/TypeScript%2BAPI/SecretStorage?utm_source=chatgpt.com "SecretStorage - Developer Documentation"
[7]: https://forum.obsidian.md/t/support-streaming-the-request-and-requesturl-response-body/87381?utm_source=chatgpt.com "Support streaming the request() and requestUrl() response ..."
