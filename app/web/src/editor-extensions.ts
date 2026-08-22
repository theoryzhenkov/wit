import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import type { DocSummary, Manifest } from "./api";

// In-editor triggers, per the States sketches:
//  [[  → wikilink autocomplete over doc titles (dangling links are fine —
//        the save pipeline holds them by name and auto-resolves).
//  /   → slash-menu at line start: registry components, then blocks.

export function witCompletions(
  getDocs: () => DocSummary[],
  getManifests: () => Manifest[],
): ReturnType<typeof autocompletion> {
  const wikilink = (ctx: CompletionContext): CompletionResult | null => {
    const match = ctx.matchBefore(/\[\[[^\]]*/);
    if (!match) return null;
    const query = match.text.slice(2).toLowerCase();
    const docs = getDocs();
    const options = docs
      .filter((d) => !query || d.title.toLowerCase().includes(query) || d.slug.includes(query))
      .slice(0, 12)
      .map((d) => ({
        label: d.title || d.slug,
        detail: d.slug,
        apply: `[[${d.slug}]]`,
        type: "text",
      }));
    if (query && !docs.some((d) => d.slug === query)) {
      options.push({
        label: `Create "${query}"`,
        detail: "dangling link",
        apply: `[[${query}]]`,
        type: "keyword",
      });
    }
    return { from: match.from, options, filter: false };
  };

  const slash = (ctx: CompletionContext): CompletionResult | null => {
    const match = ctx.matchBefore(/\/[\w-]*/);
    if (!match) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    if (line.from !== match.from) return null; // line start only
    const query = match.text.slice(1).toLowerCase();
    const components = getManifests()
      .filter((m) => !query || m.name.includes(query))
      .map((m) => ({
        label: m.name,
        detail: m.description || "component",
        apply:
          m.slots != null
            ? `:::${m.name}\n\n:::\n`
            : `::${m.name}${requiredAttrs(m)}\n`,
        type: "class",
      }));
    const blocks = [
      { label: "callout", detail: "block", apply: "> [!note]\n> ", type: "keyword" },
      { label: "code", detail: "block", apply: "```\n\n```\n", type: "keyword" },
    ].filter((b) => !query || b.label.includes(query));
    return { from: match.from, options: [...components, ...blocks], filter: false };
  };

  return autocompletion({ override: [wikilink, slash], icons: false });
}

/** Pre-fill required props so the inserted directive is immediately
 *  diagnostics-clean to edit: ::hero{src=""}. */
function requiredAttrs(m: Manifest): string {
  const required = Object.entries(m.props ?? {}).filter(
    ([, spec]) => spec.required && spec.default === undefined,
  );
  if (required.length === 0) return "";
  return `{${required.map(([k]) => `${k}=""`).join(" ")}}`;
}
