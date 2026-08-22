import { describe, expect, it } from "bun:test";
import { parseDoc, slugify } from "./lib/parse";

describe("slugify", () => {
  // spec: docs/model/L1-model#slug-unique — normalized lowercase kebab
  it("normalizes to lowercase kebab", () => {
    expect(slugify("My Great Note")).toBe("my-great-note");
    expect(slugify("  Émigré Café!  ")).toBe("emigre-cafe");
    expect(slugify("a__b--c")).toBe("a-b-c");
    expect(slugify("...")).toBe("untitled");
    expect(slugify("")).toBe("untitled");
  });
});

describe("parseDoc", () => {
  const text = `---
title: The Garden
tags: [Practice, "#tools", practice]
up: "[[digital-gardens]]"
related:
  - "[[Note Taking]]"
  - "[[zettelkasten|the method]]"
draft: true
---

# Ignored Heading

A body link to [[My Great Note]] and one with a label
[[second-note|see here]] plus an anchor [[third#section]].

\`\`\`
[[not-a-link]] inside a code fence
\`\`\`

Inline \`[[also-not-a-link]]\` code.

Repeated [[my-great-note]] link dedupes.

::hero{src="/img/hero.png" alt="A hero"}

:::callout{tone="warm"}
Some **slot** content with [[fourth-note]].
:::

Inline :tag[label]{id="t1"} directive.
`;

  const parsed = parseDoc(text, "fallback");

  // spec: docs/model/L1-model#text-is-truth — frontmatter parsed into fields
  it("parses frontmatter into fields, title, and normalized tags", () => {
    expect(parsed.title).toBe("The Garden");
    expect(parsed.frontmatter["draft"]).toBe(true);
    expect(parsed.tags).toEqual(["practice", "tools"]);
  });

  it("extracts wikilinks from body text only, slugified and deduped", () => {
    expect(parsed.links).toEqual(["my-great-note", "second-note", "third", "fourth-note"]);
  });

  // spec: docs/model/L1-model#edge-typed
  it("extracts typed relations from wikilink-valued frontmatter", () => {
    expect(parsed.relations).toEqual([
      { rel: "up", targetSlug: "digital-gardens" },
      { rel: "related", targetSlug: "note-taking" },
      { rel: "related", targetSlug: "zettelkasten" },
    ]);
  });

  // spec: docs/model/L1-model#usage-index
  it("indexes directive usages with their props", () => {
    expect(parsed.usages).toEqual([
      { name: "hero", props: { src: "/img/hero.png", alt: "A hero" } },
      { name: "callout", props: { tone: "warm" } },
      { name: "tag", props: { id: "t1" } },
    ]);
  });

  // spec: docs/model/L1-model#content-is-data — a directive is data, not
  // code: nothing executable survives parsing, only name + props.
  it("keeps directive slot links as ordinary wikilinks", () => {
    expect(parsed.links).toContain("fourth-note");
  });

  it("falls back to first h1, then the caller's fallback title", () => {
    expect(parseDoc("# From Heading\n\nbody", "x").title).toBe("From Heading");
    expect(parseDoc("just text", "the-slug").title).toBe("the-slug");
  });
});
