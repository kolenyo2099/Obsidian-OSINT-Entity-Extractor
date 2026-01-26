You can test an Obsidian plugin **locally, instantly**, without publishing anything. The usual workflow is: build → drop into a “dev vault” → reload Obsidian → run your command → iterate.

## 1) Use a dedicated “Dev Vault”

1. Create a new folder somewhere (e.g. `D:\ObsidianDevVault`).
2. Open Obsidian → **Open folder as vault** → pick that folder.
3. In that vault, go to **Settings → Community plugins** and turn on **Restricted mode OFF** (enables community plugins).

This keeps your real vault safe while you’re debugging.

---

## 2) Install your plugin into the dev vault (manual symlink or copy)

### Best option: symlink/junction (so rebuilds update instantly)

On Windows, use a directory junction from the vault’s plugins folder to your plugin’s repo folder.

**Your vault plugin folder will be:**
`D:\ObsidianDevVault\.obsidian\plugins\your-plugin-id\`

If your plugin repo is:
`D:\code\obsidian-article-importer\`

Run (in **Command Prompt as normal user**):

```bat
mkdir "D:\ObsidianDevVault\.obsidian\plugins"
mklink /J "D:\ObsidianDevVault\.obsidian\plugins\your-plugin-id" "D:\code\obsidian-article-importer"
```

Now Obsidian reads the plugin straight from your repo.

**What must exist in that folder for Obsidian to load it:**

* `manifest.json`
* `main.js`
* (optional) `styles.css`

If your build outputs `dist/main.js`, either:

* configure your build to output `main.js` at repo root, **or**
* copy `dist/main.js` to `main.js` after build (many plugins do this in the build script).

---

## 3) Fast iteration loop (the core “test cycle”)

1. In your plugin repo:

   ```bat
   npm install
   npm run dev
   ```

   (`dev` usually runs a watcher that rebuilds on file changes)

2. In Obsidian:

   * **Settings → Community plugins**
   * Find your plugin in the list
   * Toggle it **ON**
   * Whenever you rebuild: click **Reload plugins** (or restart Obsidian)

**Tip:** in many setups, you can use **Ctrl+R** to reload Obsidian (works on desktop) and that reloads plugins too.

---

## 4) Debugging properly (logs + breakpoints)

### A) View logs inside Obsidian

Obsidian has a developer console:

* **Ctrl+Shift+I** → Console tab

Use `console.log()` in your code. Errors thrown will show there too.

### B) Debug with breakpoints

Once the dev tools are open:

* Sources tab → find your bundled JS → set breakpoints
* Trigger your command again in Obsidian

If source maps are enabled, you can debug TypeScript directly (ideal). Make sure your bundler emits sourcemaps in dev mode.

---

## 5) Test your command the way users will run it

Obsidian runs plugin commands via the Command Palette:

* **Ctrl+P** → type your command name → run

This is the fastest way to verify the whole pipeline.

---

## 6) Test real-world failure cases early

For your URL → extract → OpenAI → write flow, deliberately test:

* a normal accessible article
* a paywalled site (short extraction)
* a site with heavy JS (may return minimal HTML)
* a 404
* a slow response / timeout
* missing OpenAI key
* invalid output folder path
* very long article (token/length issues)

You want friendly Obsidian notices for each failure, not silent errors.

---

## 7) Optional but very useful: add a “Dry run” mode in settings

Add a setting like:

* ✅ “Dry run (don’t call OpenAI; just save extracted text)”

That lets you test extraction + file creation without spending tokens.

---

## 8) When you’re ready to “deploy” (still not publishing)

For personal use across your real vault:

* Repeat the same junction approach but point it at your real vault.
* Or copy only the release files (`manifest.json`, `main.js`, `styles.css`) into:
  `<your-real-vault>/.obsidian/plugins/your-plugin-id/`

Publishing to the community directory is a separate step (GitHub releases + submission), and you don’t need it to run your plugin.

---

If you tell me:

* your plugin repo path, and
* your dev vault path,
  I can give you the exact `mklink /J` command and a recommended `package.json` build script so `main.js` ends up where Obsidian expects it.
