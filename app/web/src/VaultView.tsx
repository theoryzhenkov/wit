import { useCallback, useEffect, useState } from "react";
import { api, type Collection, type DocSummary, type Vault } from "./api";
import type { Route } from "./App";
import { CollectionView } from "./CollectionView";
import { Editor } from "./Editor";

export function VaultView({ vault, route }: { vault: Vault; route: Route }) {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<DocSummary[] | null>(null);

  const refreshDocs = useCallback(async () => {
    setDocs(await api.docs.list(vault.id));
  }, [vault.id]);
  const refreshCollections = useCallback(async () => {
    setCollections(await api.collections.list(vault.id));
  }, [vault.id]);

  useEffect(() => {
    void refreshDocs();
    void refreshCollections();
  }, [refreshDocs, refreshCollections]);

  // Live search through the grammar's fts operator.
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      void api.docs.search(vault.id, q).then(setResults);
    }, 200);
    return () => clearTimeout(t);
  }, [search, vault.id]);

  const shown = results ?? [...docs].reverse();
  const activeDoc = route.docId ? docs.find((d) => d.id === route.docId) ?? null : null;
  const activeCollection = route.collectionSlug
    ? collections.find((c) => c.slug === route.collectionSlug) ?? null
    : null;

  return (
    <div className="shell">
      <nav className="sidebar">
        <header>
          <a href="#/" className="wordmark" style={{ textDecoration: "none", fontSize: 17 }}>
            wit
          </a>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>{vault.name}</span>
          <button
            className="ghost"
            title="new doc"
            onClick={async () => {
              const created = await api.docs.create(vault.id, { title: "untitled" });
              await refreshDocs();
              window.location.hash = `#/vault/${vault.id}/doc/${created.id}`;
            }}
          >
            + doc
          </button>
        </header>
        <div className="search">
          <input
            placeholder="search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="section">
          <span>{results ? "results" : "docs"}</span>
        </div>
        <ul>
          {shown.map((d) => (
            <li key={d.id}>
              <a
                href={`#/vault/${vault.id}/doc/${d.id}`}
                className={route.docId === d.id ? "active" : ""}
              >
                <span
                  className={`vis-dot vis-${d.visibility}`}
                  title={d.visibility}
                  style={{ marginTop: 7 }}
                />
                <span style={{ flex: 1 }}>{d.title || d.slug}</span>
                <span className="slug">{d.slug}</span>
              </a>
            </li>
          ))}
        </ul>
        <div className="section">
          <span>collections</span>
          <button
            className="ghost"
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
          </button>
        </div>
        <ul>
          {collections.map((c) => (
            <li key={c.id}>
              <a
                href={`#/vault/${vault.id}/collection/${encodeURIComponent(c.slug)}`}
                className={route.collectionSlug === c.slug ? "active" : ""}
              >
                <span style={{ flex: 1 }}>{c.name || c.slug}</span>
                <span className="slug">{c.rule ? "rule" : "pins"}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <main className="main">
        {activeDoc ? (
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
          <p className="empty">Pick a doc, or create one.</p>
        )}
      </main>
    </div>
  );
}
