import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

// Styled markdown source (iA Writer lineage): formatting is visible in
// place, syntax marks recede. Not WYSIWYG — the text is the text.

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.6em", fontWeight: "650" },
  { tag: tags.heading2, fontSize: "1.3em", fontWeight: "650" },
  { tag: tags.heading3, fontSize: "1.15em", fontWeight: "600" },
  { tag: tags.heading4, fontWeight: "600" },
  { tag: tags.strong, fontWeight: "650" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--accent-text)" },
  { tag: tags.url, color: "var(--accent-text)" },
  { tag: tags.quote, color: "var(--muted)" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)", fontSize: "0.9em" },
  // Syntax marks (#, *, >, ```), recede.
  { tag: tags.processingInstruction, color: "var(--faint)" },
  { tag: tags.meta, color: "var(--faint)" },
  { tag: tags.contentSeparator, color: "var(--faint)" },
]);

// Wikilinks and directives aren't markdown nodes — decorate by pattern.
const wikilinkDeco = new MatchDecorator({
  regexp: /\[\[[^\]]+\]\]/g,
  decoration: Decoration.mark({ class: "cm-wikilink" }),
});
const directiveDeco = new MatchDecorator({
  regexp: /^:{2,3}[a-z][a-z0-9-]*(\{[^}]*\})?/g,
  decoration: Decoration.mark({ class: "cm-directive" }),
});

const patternPlugin = (decorator: MatchDecorator) =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorator.createDeco(view);
      }
      update(update: ViewUpdate) {
        this.decorations = decorator.updateDeco(update, this.decorations);
      }
    },
    { decorations: (v) => v.decorations },
  );

// The frontmatter block (--- fenced, at the top) recedes to faint mono.
const frontmatterPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
    }
    build(view: EditorView): DecorationSet {
      const doc = view.state.doc;
      if (doc.lines < 2 || doc.line(1).text !== "---") return Decoration.none;
      let end = 0;
      for (let n = 2; n <= Math.min(doc.lines, 50); n++) {
        if (doc.line(n).text === "---") {
          end = n;
          break;
        }
      }
      if (!end) return Decoration.none;
      const marks = [];
      for (let n = 1; n <= end; n++) {
        marks.push(Decoration.line({ class: "cm-frontmatter" }).range(doc.line(n).from));
      }
      return Decoration.set(marks);
    }
  },
  { decorations: (v) => v.decorations },
);

export const markdownStyling = [
  syntaxHighlighting(markdownHighlight),
  patternPlugin(wikilinkDeco),
  patternPlugin(directiveDeco),
  frontmatterPlugin,
];
