import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Input, Kbd, ListRow } from "../kit";

// Interaction-state sketches: the in-editor triggers and secondary
// surfaces the screens need before implementation starts.

const meta: Meta = { title: "Screens/States", parameters: { layout: "centered" } };
export default meta;

/* Obsidian's `[[` gesture: autocomplete over doc titles; enter links,
   typing a new name offers creation (dangling link until it exists). */
export const WikilinkAutocomplete: StoryObj = {
  render: () => (
    <div style={{ width: 460, font: "400 var(--text-lg)/1.65 var(--font-ui)" }}>
      <p style={{ color: "var(--ink)" }}>
        Tending beats publishing, see [[gar<span style={{ borderLeft: "1.5px solid var(--ink)" }} />
      </p>
      <div style={{ background: "var(--raised)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", boxShadow: "var(--shadow-2)", padding: 4, width: 300 }}>
        <ListRow leading={<span className="vis-dot vis-public" />} title="The Garden" meta="garden-hub" focused />
        <ListRow leading={<span className="vis-dot vis-private" />} title="Garden tools" meta="garden-tools" />
        <ListRow title={<span style={{ color: "var(--muted)" }}>Create “gar…”</span>} meta={<Kbd>↵</Kbd>} />
      </div>
    </div>
  ),
};

/* The `/` slash-menu: components from the registry + block inserts.
   Replaces the old "+ component" toolbar button. */
export const SlashMenu: StoryObj = {
  render: () => (
    <div style={{ width: 460, font: "400 var(--text-lg)/1.65 var(--font-ui)" }}>
      <p style={{ color: "var(--ink)" }}>
        /<span style={{ borderLeft: "1.5px solid var(--ink)" }} />
      </p>
      <div style={{ background: "var(--raised)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", boxShadow: "var(--shadow-2)", padding: 4, width: 320 }}>
        <div style={{ font: "600 var(--text-xs) var(--font-ui)", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", padding: "6px 12px 2px" }}>components</div>
        <ListRow title="content-table" meta="pages under a path" focused />
        <ListRow title="link-cards" meta="project links" />
        <ListRow title="notes-feed" meta="reverse-chrono feed" />
        <div style={{ font: "600 var(--text-xs) var(--font-ui)", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", padding: "6px 12px 2px" }}>blocks</div>
        <ListRow title="Image…" meta="upload" />
        <ListRow title="Callout" />
      </div>
    </div>
  ),
};

/* Backlinks live at the bottom of the doc, Bear-simple: a quiet section,
   not a side panel. Sourced from the edges index. */
export const BacklinksFooter: StoryObj = {
  render: () => (
    <div style={{ width: 520, font: "400 var(--text-lg)/1.65 var(--font-ui)", color: "var(--ink)" }}>
      <p style={{ color: "var(--muted)" }}>…the end of the document.</p>
      <div style={{ borderTop: "1px solid var(--line-soft)", marginTop: 32, paddingTop: 12 }}>
        <div style={{ font: "600 var(--text-xs) var(--font-ui)", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>
          3 backlinks
        </div>
        <ListRow title="Agentic coding" meta="wikilink" />
        <ListRow title="Concepts" meta="part_of" />
        <ListRow title="A half-formed thought" meta="wikilink" />
      </div>
    </div>
  ),
};

/* The footer vault switcher's popover: vaults + create. */
export const VaultSwitcher: StoryObj = {
  render: () => (
    <div style={{ background: "var(--raised)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", boxShadow: "var(--shadow-2)", padding: 4, width: 220 }}>
      <ListRow title="theornet" meta="26 docs" active />
      <ListRow title="scratch" meta="3 docs" />
      <div style={{ height: 1, background: "var(--line-soft)", margin: "4px 0" }} />
      <ListRow title={<span style={{ color: "var(--muted)" }}>+ new vault</span>} />
    </div>
  ),
};

/* First-run: an empty vault teaches exactly one action. */
export const EmptyVault: StoryObj = {
  render: () => (
    <div style={{ display: "grid", placeItems: "center", gap: 12, width: 480, height: 240, color: "var(--muted)" }}>
      <div style={{ textAlign: "center", display: "grid", gap: 8 }}>
        <span style={{ fontSize: "var(--text-lg)", color: "var(--ink)" }}>Plant the first note</span>
        <span style={{ fontSize: "var(--text-sm)" }}>Everything starts private. Publish when it's ready.</span>
        <div><Button variant="primary">New doc</Button></div>
      </div>
    </div>
  ),
};
