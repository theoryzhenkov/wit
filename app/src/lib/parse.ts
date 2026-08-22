import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkDirective from "remark-directive";
import { toString as mdastToString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";
import YAML from "yaml";
import type { Heading, Root } from "mdast";

// Pure text → derived-facts parsing for the save pipeline. Text is truth:
// everything returned here is recomputed from the doc text on every save
// and never edited directly. spec: docs/model/L1-model#text-is-truth

export interface ParsedDoc {
  title: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  /** Body wikilink targets, slug-normalized, deduped, in order. */
  links: string[];
  /** Typed frontmatter relations. spec: docs/model/L1-model#edge-typed */
  relations: { rel: string; targetSlug: string }[];
  /** Directive invocations. spec: docs/model/L1-model#usage-index */
  usages: { name: string; props: Record<string, string> }[];
}

/** Lowercase-kebab slug normalization. spec: docs/model/L1-model#slug-unique */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkDirective);

// [[target]], [[target|label]], [[target#heading]] — target only.
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
// A frontmatter value that is exactly one wikilink.
const RELATION_RE = /^\s*\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]\s*$/;

/** Frontmatter keys that are structural, never relations. */
const NON_RELATION_KEYS = new Set(["title", "tags"]);

function parseTags(value: unknown): string[] {
  const raw = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const tags = raw
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().replace(/^#/, "").toLowerCase())
    .filter((t) => t.length > 0);
  return [...new Set(tags)];
}

export function parseDoc(text: string, fallbackTitle: string): ParsedDoc {
  const tree = processor.parse(text) as Root;

  // Frontmatter block → fields object. A parse failure or non-object
  // yields {} — the text stays truthful, the index just goes shallow.
  let frontmatter: Record<string, unknown> = {};
  const yamlNode = tree.children.find((n) => n.type === "yaml");
  if (yamlNode && "value" in yamlNode) {
    try {
      const parsed: unknown = YAML.parse(yamlNode.value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        frontmatter = parsed as Record<string, unknown>;
      }
    } catch {
      frontmatter = {};
    }
  }

  const tags = parseTags(frontmatter["tags"]);

  // Title: frontmatter title, else first h1, else the caller's fallback.
  let title = typeof frontmatter["title"] === "string" ? frontmatter["title"].trim() : "";
  if (!title) {
    const h1 = tree.children.find((n): n is Heading => n.type === "heading" && n.depth === 1);
    if (h1) title = mdastToString(h1).trim();
  }
  if (!title) title = fallbackTitle;

  // Body wikilinks: text nodes only, so fenced/inline code never links.
  const links: string[] = [];
  const seen = new Set<string>();
  visit(tree, "text", (node) => {
    for (const match of node.value.matchAll(WIKILINK_RE)) {
      const slug = slugify(match[1]!);
      if (!seen.has(slug)) {
        seen.add(slug);
        links.push(slug);
      }
    }
  });

  // Typed relations: any frontmatter entry whose value is a wikilink (or
  // a list of them) — `up: "[[parent]]"` → rel "up".
  const relations: { rel: string; targetSlug: string }[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (NON_RELATION_KEYS.has(key)) continue;
    const candidates = Array.isArray(value) ? value : [value];
    for (const item of candidates) {
      if (typeof item !== "string") continue;
      const match = item.match(RELATION_RE);
      if (match) relations.push({ rel: key, targetSlug: slugify(match[1]!) });
    }
  }

  // Directive invocations (::name{...}, :::name, :name[...]{...}).
  const usages: { name: string; props: Record<string, string> }[] = [];
  visit(tree, (node) => {
    if (
      node.type === "containerDirective" ||
      node.type === "leafDirective" ||
      node.type === "textDirective"
    ) {
      const props: Record<string, string> = {};
      for (const [k, v] of Object.entries(node.attributes ?? {})) {
        if (typeof v === "string") props[k] = v;
      }
      usages.push({ name: node.name, props });
    }
  });

  return { title, frontmatter, tags, links, relations, usages };
}
