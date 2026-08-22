import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsUpDown, Plus, Settings } from "lucide-react";
import { api, type Collection, type DocSummary, type MemberEntry, type Vault } from "./api";
import type { Route } from "./App";
import { CollectionView } from "./CollectionView";
import { Editor } from "./Editor";
import { SettingsView } from "./SettingsView";
import { Button, CommandPalette, Input, Kbd, ListRow, ToastProvider, useToast, type Command } from "./kit";

// The shell, per the Screens sketches: dimmed 240px collapsible sidebar
// (⌘\) — recent docs, collections as expandable groups, all docs — with
// an Obsidian-style footer (vault switcher + settings). ⌘K is the
// primary way to move and act.

function VaultSwitcher({ current }: { current: Vault }) {
  const [open, setOpen] = useState(false);
  const [vaults, setVaults] = useState<Vault[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    void api.vaults.list().then(setVaults);
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);

  return (
    <div ref={ref} style={{ flex: 1, position: "relative" }}>
      <span
        onClick={() => setOpen((o) => !o)}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: "var(--text-sm)", cursor: "pointer" }}
        title="switch vault"
      >
        <ChevronsUpDown size={12} style={{ color: "var(--faint)" }} /> {current.name}
      </span>
      {open && (
        <div className="k-menu" style={{ bottom: 28, left: 0, width: 200 }}>
          {vaults.map((v) => (
            <ListRow
              key={v.id}
              title={v.name}
              active={v.id === current.id}
              onClick={() => {
                setOpen(false);
                window.location.hash = `#/vault/${v.id}`;
              }}
            />
          ))}
          <div className="k-menu-sep" />
          <ListRow
            title={<span style={{ color: "var(--muted)" }}>+ new vault</span>}
            onClick={async () => {
              const name = prompt("vault name?");
              if (!name?.trim()) return;
              const created = await api.vaults.create(name.trim());
              window.location.hash = `#/vault/${created.id}`;
              window.location.reload();
            }}
          />
        </div>
      )}
    </div>
  );
}

function VaultShell({ vault, route }: { vault: Vault; route: Route }) {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [members, setMembers] = useState<Record<string, MemberEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<DocSummary[] | null>(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("wit:sidebar") === "0");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const toast = useToast();

  const refreshDocs = useCallback(async () => setDocs(await api.docs.list(vault.id)), [vault.id]);
  const refreshCollections = useCallback(async () => {
    const list = await api.collections.list(vault.id);
    setCollections(list);
    const all = await Promise.all(
      list.map(async (c) => [c.slug, await api.collections.membership(vault.id, c.slug)] as const),
    );
    setMembers(Object.fromEntries(all));
  }, [vault.id]);

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
    return [
      { id: "new", title: "New doc", section: "actions", keywords: "create", run: () => void newDoc() },
      ...(activeDoc
        ? [
            { id: "pub", title: "Publish doc", section: "actions", keywords: "public visibility", run: () => void setVisibility("public") },
            { id: "unl", title: "Make doc unlisted", section: "actions", run: () => void setVisibility("unlisted") },
            { id: "priv", title: "Make doc private", section: "actions", keywords: "draft", run: () => void setVisibility("private") },
          ]
        : []),
      { id: "side", title: collapsed ? "Show sidebar" : "Hide sidebar", section: "actions", kbd: "⌘\\", run: toggleSidebar },
      { id: "settings", title: "Vault settings & API keys", section: "actions", run: go(`#/vault/${vault.id}/settings`) },
      ...docs.map((d) => ({
        id: `d:${d.id}`,
        title: d.title || d.slug,
        section: "docs",
        keywords: d.slug,
        run: go(`#/vault/${vault.id}/doc/${d.id}`),
      })),
      ...collections.map((c) => ({
        id: `c:${c.id}`,
        title: c.name || c.slug,
        section: "collections",
        keywords: c.slug,
        run: go(`#/vault/${vault.id}/collection/${encodeURIComponent(c.slug)}`),
      })),
    ];
  }, [docs, collections, vault.id, activeDoc, collapsed, newDoc, setVisibility, toggleSidebar]);

  const recent = useMemo(
    () =>
      [...docs]
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, 5),
    [docs],
  );

  const docRow = (d: { docId?: string; id?: string; slug: string; title: string; visibility: string }) => {
    const id = d.docId ?? d.id!;
    return (
      <ListRow
        key={id}
        href={`#/vault/${vault.id}/doc/${id}`}
        active={route.docId === id}
        leading={<span className={`vis-dot vis-${d.visibility}`} title={d.visibility} />}
        title={d.title || d.slug}
      />
    );
  };

  return (
    <div className="shell" data-collapsed={collapsed}>
      {!collapsed && (
        <nav className="sidebar">
          <header>
            <a href="#/" className="wordmark" style={{ textDecoration: "none", fontSize: 15 }}>
              wit
            </a>
            <div style={{ flex: 1 }} />
            <Button variant="ghost" size="sm" title="new doc" onClick={() => void newDoc()}>
              <Plus size={14} />
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

          {results ? (
            <>
              <div className="section"><span>results</span></div>
              <div style={{ padding: "0 var(--s2)" }}>{results.map((d) => docRow(d))}</div>
            </>
          ) : (
            <>
              <div className="section"><span>recent</span></div>
              <div style={{ padding: "0 var(--s2)" }}>{recent.map((d) => docRow(d))}</div>

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
                  }}
                >
                  <Plus size={13} />
                </Button>
              </div>
              <div style={{ padding: "0 var(--s2)" }}>
                {collections.map((c) => {
                  const isOpen = expanded.has(c.slug);
                  const entries = members[c.slug] ?? [];
                  return (
                    <div key={c.id}>
                      <ListRow
                        active={route.collectionSlug === c.slug}
                        leading={isOpen ? <ChevronDown size={11} style={{ color: "var(--faint)" }} /> : <ChevronRight size={11} style={{ color: "var(--faint)" }} />}
                        title={c.name || c.slug}
                        meta={String(entries.length)}
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(c.slug)) next.delete(c.slug);
                            else next.add(c.slug);
                            return next;
                          })
                        }
                      />
                      {isOpen && (
                        <div style={{ paddingLeft: "var(--s4)" }}>
                          {entries.map((m) => docRow(m))}
                          <ListRow
                            title={<span style={{ color: "var(--faint)", fontSize: "var(--text-sm)" }}>open collection…</span>}
                            href={`#/vault/${vault.id}/collection/${encodeURIComponent(c.slug)}`}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ padding: "0 var(--s2)", marginTop: "var(--s2)" }}>
                <ListRow
                  href={`#/vault/${vault.id}`}
                  title="All docs"
                  meta={String(docs.length)}
                  active={!route.docId && !route.collectionSlug && !route.settings}
                />
              </div>
            </>
          )}

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
            <VaultSwitcher current={vault} />
            <Button
              variant="ghost"
              size="sm"
              title="vault settings"
              onClick={() => (window.location.hash = `#/vault/${vault.id}/settings`)}
            >
              <Settings size={14} />
            </Button>
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
            collections={collections.filter((c) =>
              (members[c.slug] ?? []).some((m) => m.docId === activeDoc.id),
            )}
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
        ) : docs.length === 0 ? (
          <div className="empty" style={{ display: "grid", placeItems: "center", gap: 8, textAlign: "center" }}>
            <span style={{ fontSize: "var(--text-lg)", color: "var(--ink)" }}>Plant the first note</span>
            <span style={{ fontSize: "var(--text-sm)" }}>Everything starts private. Publish when it's ready.</span>
            <div><Button variant="primary" onClick={() => void newDoc()}>New doc</Button></div>
          </div>
        ) : (
          <p className="empty">
            <Kbd>⌘K</Kbd>&nbsp; to jump anywhere.
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
