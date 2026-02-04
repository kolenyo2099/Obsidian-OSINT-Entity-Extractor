import { normalizePath, Vault, TFile, parseYaml } from "obsidian";

export function sanitizeFilename(name: string, maxLen = 120): string {
  let safe = name.trim();
  safe = safe.replace(/[<>:"/\\|?*]/g, "");
  safe = safe.replace(/\s+/g, " ").trim();
  safe = safe.replace(/[. ]+$/, "");
  if (!safe) safe = "untitled";
  if (safe.length > maxLen) safe = safe.slice(0, maxLen);
  return safe;
}

export function ensureFrontmatterPresent(note: string): string {
  if (!note.startsWith("---")) {
    throw new Error("Model output did not start with YAML frontmatter ('---').");
  }
  const second = note.indexOf("\n---", 3);
  if (second === -1) {
    throw new Error("Model output did not include a closing YAML frontmatter delimiter ('---').");
  }
  // Validate YAML parses to catch malformed frontmatter (bad indentation, scalars, etc.).
  try {
    const yamlBlock = note.slice(3, second).trim();
    const parsed = parseYaml(yamlBlock);
    if (parsed === null || typeof parsed !== "object") {
      throw new Error("Frontmatter YAML is not an object.");
    }
  } catch (err: unknown) {
    console.log("Frontmatter parse failed. Attempting strict sanitization...");
    // Attempt to fix common backslash issues (Windows paths) in the YAML block
    try {
      const yamlBlock = note.slice(3, second);

      // Strategy 1: Replace all backslashes with forward slashes (safe for paths)
      const sanitized = yamlBlock.replace(/\\/g, "/");

      try {
        const parsed = parseYaml(sanitized.trim());
        if (parsed && typeof parsed === "object") {
          console.log("YAML Strategy 1 (global /) succeeded.");
          return `---\n${sanitized.trim()}\n---${note.slice(second + 3)}`;
        }
      } catch (e1) {
        console.warn("YAML Strategy 1 failed:", e1);
      }

      // Strategy 2: Targeted title sanitization
      // This matches title: "..." and fixes backslashes only inside the quotes
      const sanitized2 = yamlBlock.replace(/title:\s*"(.*)"/g, (match, p1) => {
        return `title: "${p1.replace(/\\/g, "/")}"`;
      });

      try {
        const parsed2 = parseYaml(sanitized2.trim());
        if (parsed2 && typeof parsed2 === "object") {
          console.log("YAML Strategy 2 (targeted title) succeeded.");
          return `---\n${sanitized2.trim()}\n---${note.slice(second + 3)}`;
        }
      } catch (e2) {
        console.warn("YAML Strategy 2 failed:", e2);
      }

    } catch (fallbackErr) {
      console.error("All file sanitization strategies failed:", fallbackErr);
    }

    const msg = err instanceof Error ? err.message : "Invalid YAML frontmatter.";
    throw new Error(`Invalid YAML frontmatter: ${msg}`);
  }
  return note;
}

async function ensureFolderExists(vault: Vault, folder: string): Promise<string> {
  const normalized = folder ? normalizePath(folder) : "";
  if (!normalized) return "";

  const adapter = vault.adapter;
  if (!(await adapter.exists(normalized))) {
    await vault.createFolder(normalized);
  }
  return normalized;
}

async function nextAvailablePath(vault: Vault, basePath: string): Promise<string> {
  const adapter = vault.adapter;
  if (!(await adapter.exists(basePath))) return basePath;

  const extIndex = basePath.lastIndexOf(".");
  const base = extIndex === -1 ? basePath : basePath.slice(0, extIndex);
  const ext = extIndex === -1 ? "" : basePath.slice(extIndex);
  let counter = 2;
  let candidate = `${base} (${counter})${ext}`;
  while (await adapter.exists(candidate)) {
    counter += 1;
    candidate = `${base} (${counter})${ext}`;
  }
  return candidate;
}

export async function saveNoteToVault(vault: Vault, folder: string, title: string, content: string): Promise<TFile> {
  const normalizedFolder = await ensureFolderExists(vault, folder);
  const filename = sanitizeFilename(title || "article") + ".md";
  const fullPath = normalizedFolder ? `${normalizedFolder}/${filename}` : filename;
  const uniquePath = await nextAvailablePath(vault, fullPath);
  const normalizedContent = content.endsWith("\n") ? content : `${content}\n`;
  return vault.create(normalizePath(uniquePath), normalizedContent);
}
