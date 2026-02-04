export function normalizeTags(input: string): string[] {
  if (!input) return [];

  const slugs = input
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => {
      let slug = tag.replace(/^#/, "").toLowerCase();
      slug = slug.replace(/[\s_]+/g, "-");
      slug = slug.replace(/[^a-z0-9-]/g, "-");
      slug = slug.replace(/-+/g, "-");
      slug = slug.replace(/^-+|-+$/g, "");
      return slug;
    })
    .filter(Boolean);

  // De-duplicate while preserving order
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const s of slugs) {
    if (!seen.has(s)) {
      seen.add(s);
      unique.push(s);
    }
  }
  return unique;
}
