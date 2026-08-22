import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Input, Kbd, ListRow, CommandPalette } from "../kit";

// Whole-UI sketches: every screen as a mock composition. This is the
// design source of truth — screens get implemented to match these.

const meta: Meta = { title: "Screens", parameters: { layout: "fullscreen" } };
export default meta;

const DOCS = [
  { slug: "garden-hub", title: "The Garden", vis: "public", active: true },
  { slug: "agentic-coding", title: "Agentic coding", vis: "public" },
  { slug: "jmap", title: "JMAP", vis: "public" },
  { slug: "half-formed", title: "A half-formed thought", vis: "unlisted" },
  { slug: "draft-riff", title: "Draft riff on directives", vis: "private" },
];

const Sidebar = () => (
  <nav className="sidebar" style={{ height: "100%" }}>
    <header>
      <span className="wordmark" style={{ fontSize: 15 }}>wit</span>
      <div style={{ flex: 1 }} />
      <Button variant="ghost" size="sm" title="new doc">+</Button>
    </header>
    <div className="search"><Input placeholder="search…" style={{ width: "100%" }} /></div>
    <div className="section"><span>recent</span></div>
    <div style={{ padding: "0 var(--s2)" }}>
      {DOCS.slice(0, 3).map((d) => (
        <ListRow key={d.slug} active={d.active}
          leading={<span className={`vis-dot vis-${d.vis}`} />}
          title={d.title} />
      ))}
    </div>
    <div className="section"><span>collections</span><Button variant="ghost" size="sm">+</Button></div>
    <div style={{ padding: "0 var(--s2)" }}>
      <ListRow title="essays" meta="4" />
      <div style={{ paddingLeft: "var(--s4)" }}>
        <ListRow leading={<span className="vis-dot vis-public" />} title="The Garden" active />
        <ListRow leading={<span className="vis-dot vis-public" />} title="Agentic coding" />
        <ListRow leading={<span className="vis-dot vis-private" />} title="Draft riff on directives" />
      </div>
      <ListRow title="reading" meta="7" />
      <ListRow title="stubs" meta="12" />
    </div>
    <div style={{ padding: "0 var(--s2)", marginTop: "var(--s2)" }}>
      <ListRow title="All docs" meta="26" />
    </div>
    {/* Obsidian-style footer: vault switcher left, settings right. */}
    <div
      style={{
        marginTop: "auto",
        borderTop: "1px solid var(--line-soft)",
        padding: "var(--s2) var(--s3)",
        display: "flex",
        alignItems: "center",
        gap: "var(--s2)",
      }}
    >
      <span
        style={{ flex: 1, display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: "var(--text-sm)", cursor: "pointer" }}
        title="switch vault"
      >
        <span style={{ color: "var(--faint)" }}>⇅</span> theornet
      </span>
      <Button variant="ghost" size="sm" title="vault settings">⚙</Button>
    </div>
  </nav>
);

/* Target toolbar: nearly nothing. Breadcrumb left; visibility chip and
   overflow right. Rename/slug, component insert, delete live in ⋯ and
   in-editor triggers (/ and [[). Save state is silent — errors toast. */
const Toolbar = ({ vis = "public" }: { vis?: string }) => (
  <div className="doc-toolbar" style={{ flexWrap: "nowrap" }}>
    <span style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>
      essays <span style={{ color: "var(--faint)" }}>/</span> The Garden
    </span>
    <div className="spacer" />
    <Button size="sm" variant="ghost">
      <span className={`vis-dot vis-${vis}`} /> {vis} ▾
    </Button>
    <Button size="sm" variant="ghost">⋯</Button>
  </div>
);

const Prose = () => (
  <div style={{ maxWidth: "68ch", padding: 24, font: "400 var(--text-lg)/1.65 var(--font-ui)", color: "var(--ink)" }}>
    <div style={{ color: "var(--faint)", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", marginBottom: 16 }}>
      ---<br />tags: [garden]<br />up: "[[digital-gardens]]"<br />---
    </div>
    <h1 style={{ fontSize: 28, margin: "0 0 12px" }}>The Garden</h1>
    <p>A garden is a place where <span style={{ color: "var(--accent-text)" }}>[[ideas]]</span> get planted before they are ready, and that is the point.</p>
    <p style={{ background: "var(--accent-soft)", borderRadius: 4, padding: "2px 6px", display: "inline-block", fontFamily: "var(--font-mono)", fontSize: "var(--text-md)" }}>
      ::content-table{"{path=\"concepts/\"}"}
    </p>
    <p>Tending beats publishing. Publishing is one keystroke anyway.</p>
  </div>
);

export const AppShell: StoryObj = {
  render: () => (
    <div className="shell" style={{ height: "100vh" }}>
      <Sidebar />
      <main className="main">
        <Toolbar />
        <Prose />
      </main>
    </div>
  ),
};

export const EditorFocusMode: StoryObj = {
  render: () => (
    <div className="shell" data-collapsed="true" style={{ height: "100vh" }}>
      <main className="main">
        <Toolbar />
        <Prose />
        <div className="diagnostics"><span>⚠ ::hero is missing required prop "src"</span></div>
      </main>
    </div>
  ),
};

export const PaletteOverShell: StoryObj = {
  render: () => (
    <div className="shell" style={{ height: "100vh" }}>
      <Sidebar />
      <main className="main"><Toolbar /><Prose /></main>
      <CommandPalette open onClose={() => {}} commands={[
        { id: "new", title: "New doc", section: "actions", kbd: "⌘K N", run: () => {} },
        { id: "pub", title: "Publish doc", section: "actions", run: () => {} },
        { id: "d1", title: "The Garden", section: "docs", run: () => {} },
        { id: "d2", title: "Agentic coding", section: "docs", run: () => {} },
      ]} />
    </div>
  ),
};

export const CollectionScreen: StoryObj = {
  render: () => (
    <div className="shell" style={{ height: "100vh" }}>
      <Sidebar />
      <main className="main">
        <div style={{ padding: 24, maxWidth: 680 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: "var(--text-xl)" }}>essays</h2>
          <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginBottom: 16 }}>
            rule: tag <code>essay</code> · sort updated ↓ · 4 members
          </div>
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: 4 }}>
            <ListRow leading={<span className="vis-dot vis-public" />} title="The Garden" meta="pin · 0" />
            <ListRow leading={<span className="vis-dot vis-public" />} title="Agentic coding" meta="rule" />
            <ListRow leading={<span className="vis-dot vis-private" />} title="Draft riff on directives" meta="rule" />
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <Button size="sm">edit rule</Button>
            <Button size="sm" variant="danger">delete collection</Button>
          </div>
        </div>
      </main>
    </div>
  ),
};

export const SettingsScreen: StoryObj = {
  render: () => (
    <div className="shell" style={{ height: "100vh" }}>
      <Sidebar />
      <main className="main">
        <div style={{ padding: 24, maxWidth: 560, display: "grid", gap: 16 }}>
          <h2 style={{ margin: 0, fontSize: "var(--text-xl)" }}>settings — theornet</h2>
          <section>
            <div className="section" style={{ padding: "0 0 6px" }}><span>vault id</span></div>
            <div style={{ display: "flex", gap: 8 }}>
              <code style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>1ed481bb-b571-4d2d-…</code>
              <Button size="sm">copy</Button>
            </div>
          </section>
          <section>
            <div className="section" style={{ padding: "0 0 6px" }}><span>api keys</span></div>
            <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: 4 }}>
              <ListRow title="theor.net" meta="read · used today" />
              <ListRow title="components sync" meta="write · never used" />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Input placeholder="key name" /><Button variant="primary">mint read key</Button>
            </div>
          </section>
        </div>
      </main>
    </div>
  ),
};

export const SignIn: StoryObj = {
  render: () => (
    <div className="center-card" style={{ height: "100vh" }}>
      <div className="card">
        <h1><span className="wordmark">wit</span></h1>
        <p className="hint">A magic link signs you in — and signs you up if you're new here.</p>
        <Input placeholder="you@example.com" />
        <Button variant="primary">send magic link</Button>
      </div>
    </div>
  ),
};
