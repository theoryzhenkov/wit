import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Collection, type DocSummary, type Vault } from "./api";
import type { Route } from "./App";
import { CollectionView } from "./CollectionView";
import { Editor } from "./Editor";
import { SettingsView } from "./SettingsView";
import { Button, CommandPalette, Input, Kbd, ListRow, ToastProvider, useToast, type Command } from "./kit";

// The shell: dimmed 240px collapsible sidebar (⌘\), content leads, and
// the ⌘K palette as the primary way to move and act.

function VaultShell({ vault, route }: { vault: Vault; route: Route }) {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<DocSummary[] | null>(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("wit:sidebar") === "0");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const toast = useToast();

  const refreshDocs = useCallback(async () => setDocs(await api.docs.list(vault.id)), [vault.id]);
  const refreshCollections = useCallback(
    async () => setCollections(await api.collections.list(vault.id)),
    [vault.id],
  );

  useEffect(() => {
    void refreshDocs();
    void refreshCollections();
  }, [refreshDocs, refreshCollections]);

  useEffect(() => {
    const q = search.trim();
    if (!q) return setResults(null);
    const t = setTimeout(() => void api.docs.search(vault.id, q).then(setResults), 200);
    return () => clearTimeout(t);
  }, [search, vault.id]);

  const activeDoc = route.docId ? docs.find((d) => d.id === route.docId) ?? null : null;
  const activeCollection = route.collectionSlug
    ? collections.find((c) => c.slug === route.collectionSlug) ?? null
    : null;

  const newDoc = useCallback(async () => {
    const created = await api.docs.create(vault.id, { title: "untitled" });
    await refreshDocs();
    window.location.hash = `#/vault/${vault.id}/doc/${created.id}`;
  }, [vault.id, refreshDocs]);

  const setVisibility = useCallback(
    async (visibility: "private" | "unlisted" | "public") => {
      if (!activeDoc) return;
      await api.docs.patch(vault.id, activeDoc.id, { visibility });
      await refreshDocs();
      toast(visibility === "public" ? "Published — live in about a second" : `Now ${visibility}`);
    },
    [vault.id, activeDoc, refreshDocs, toast],
  );

  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      localStorage.setItem("wit:sidebar", c ? "1" : "0");
      return !c;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  const commands = useMemo<Command[]>(() => {
    const go = (hash: string) => () => void (window.location.hash = hash);
    const actions: Command[] = [
      { id: "new", title: "New doc", section: "actions", kbd: "⌘K N", keywords: "create", run: () => void newDoc() },
      ...(activeDoc
        ? [
            { id: "pub", title: "Publish doc", section: "actions", keywords: "public visibility", run: () => void setVisibility("public") },
            { id: "unl", title: "Make doc unlisted", section: "actions", run: () => void setVisibility("unlisted") },
            { id: "priv", title: "Make doc private", section: "actions", keywords: "draft", run: () => void setVisibility("private") },
          ]
        : []),
      { id: "side", title: collapsed ? "Show sidebar" : "Hide sidebar", section: "actions", kbd: "⌘\\", run: toggleSidebar },
      { id: "settings", title: "Vault settings & API keys", section: "actions", run: go(`#/vault/${vault.id}/settings`) },
    ];
    const docCmds = docs.map((d) => ({
      id: `d:${d.id}`,
      title: d.title || d.slug,
      section: "docs",
      keywords: d.slug,
      run: go(`#/vault/${vault.id}/doc/${d.id}`),
    }));
    const colCmds = collections.map((c) => ({
      id: `c:${c.id}`,
      title: c.name || c.slug,
      section: "collections",
      keywords: c.slug,
      run: go(`#/vault/${vault.id}/collection/${encodeURIComponent(c.slug)}`),
    }));
    return [...actions, ...docCmds, ...colCmds];
  }, [docs, collections, vault.id, activeDoc, collapsed, newDoc, setVisibility, toggleSidebar]);

  const shown = results ?? [...docs].reverse();

  return (
    <div className="shell" data-collapsed={collapsed}>
      {!collapsed && (
        <nav className="sidebar">
          <header>
            <a href="#/" className="wordmark" style={{ textDecoration: "none", fontSize: 15 }}>
              wit
            </a>
            <a
              href={`#/vault/${vault.id}/settings`}
              style={{ color: "var(--muted)", fontSize: "var(--text-sm)", textDecoration: "none" }}
              title="vault settings — API keys, vault id"
            >
              {vault.name} ⚙
            </a>
            <Button variant="ghost" size="sm" title="new doc" onClick={() => void newDoc()}>
              +
            </Button>
          </header>
          <div className="search">
            <Input
              placeholder="search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
          <div className="section">
            <span>{results ? "results" : "docs"}</span>
          </div>
          <div style={{ padding: "0 var(--s2)" }}>
            {shown.map((d) => (
              <ListRow
                key={d.id}
                href={`#/vault/${vault.id}/doc/${d.id}`}
                active={route.docId === d.id}
                leading={<span className={`vis-dot vis-${d.visibility}`} title={d.visibility} />}
                title={d.title || d.slug}
                meta={d.slug}
              />
            ))}
          </div>
          <div className="section">
            <span>collections</span>
            <Button
              variant="ghost"
              size="sm"
              title="new collection"
              onClick={async () => {
                const slug = prompt("collection slug?");
                if (!slug) return;
                await api.collections.create(vault.id, { slug });
                await refreshCollections();
                window.location.hash = `#/vault/${vault.id}/collection/${encodeURIComponent(slug)}`;
              }}
            >
              +
            </Button>
          </div>
          <div style={{ padding: "0 var(--s2) var(--s3)" }}>
            {collections.map((c) => (
              <ListRow
                key={c.id}
                href={`#/vault/${vault.id}/collection/${encodeURIComponent(c.slug)}`}
                active={route.collectionSlug === c.slug}
                title={c.name || c.slug}
                meta={c.rule ? "rule" : "pins"}
              />
            ))}
          </div>
          <div style={{ marginTop: "auto", padding: "var(--s2) var(--s3)", color: "var(--faint)", fontSize: "var(--text-xs)", display: "flex", gap: 6, alignItems: "center" }}>
            <Kbd>⌘K</Kbd> commands · <Kbd>⌘\</Kbd> sidebar
          </div>
        </nav>
      )}
      <main className="main">
        {route.settings ? (
          <SettingsView vault={vault} />
        ) : activeDoc ? (
          <Editor
            key={activeDoc.id}
            vaultId={vault.id}
            doc={activeDoc}
            onChanged={refreshDocs}
            onDeleted={() => {
              window.location.hash = `#/vault/${vault.id}`;
              void refreshDocs();
            }}
          />
        ) : activeCollection ? (
          <CollectionView
            key={activeCollection.id}
            vaultId={vault.id}
            collection={activeCollection}
            onChanged={refreshCollections}
          />
        ) : (
          <p className="empty">
            <Kbd>⌘K</Kbd>&nbsp; to jump anywhere, or create a doc.
          </p>
        )}
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  );
}

export function VaultView(props: { vault: Vault; route: Route }) {
  return (
    <ToastProvider>
      <VaultShell {...props} />
    </ToastProvider>
  );
}
