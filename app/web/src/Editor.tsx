import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { yCollab } from "y-codemirror.next";
import { api, type Collection, type DocSummary, type Manifest } from "./api";
import { analyzeDirectives, type Diagnostic } from "./diagnostics";
import { witCompletions } from "./editor-extensions";
import { markdownStyling } from "./editor-style";
import { ChevronDown, Ellipsis } from "lucide-react";
import { Button, ListRow, Menu, useToast } from "./kit";

// CodeMirror + Yjs over the relay: collaborative markdown, frontmatter as
// raw text in the document (comfortable tier).

export function Editor({
  vaultId,
  doc,
  collections = [],
  onChanged,
  onDeleted,
}: {
  vaultId: string;
  doc: DocSummary;
  collections?: Collection[];
  onChanged: () => Promise<void> | void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [peers, setPeers] = useState(0);
  const [visMenu, setVisMenu] = useState<{ x: number; y: number } | null>(null);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [allDocs, setAllDocs] = useState<DocSummary[]>([]);
  const [backlinks, setBacklinks] = useState<{ source: string; kind: string; rel: string | null }[]>([]);

  useEffect(() => {
    void api.docs.list(vaultId).then(setAllDocs);
    void api.edges.backlinks(vaultId, doc.id).then(setBacklinks).catch(() => {});
  }, [vaultId, doc.id]);
  const allDocsRef = useRef(allDocs);
  allDocsRef.current = allDocs;

  // The registry feeds the insert menu; the UI never writes it.
  // spec: docs/model/L1-model#registry-manifests
  useEffect(() => {
    void api.components.list(vaultId).then(setManifests);
  }, [vaultId]);

  const manifestsRef = useRef(manifests);
  manifestsRef.current = manifests;

  useEffect(() => {
    const ydoc = new Y.Doc();
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const provider = new WebsocketProvider(
      `${proto}//${window.location.host}/api/vaults/${vaultId}/docs`,
      `${doc.id}/ws`,
      ydoc,
      { disableBc: true },
    );
    const ytext = ydoc.getText("content");

    provider.awareness.on("change", () => {
      setPeers(Math.max(0, provider.awareness.getStates().size - 1));
    });

    let diagTimer: ReturnType<typeof setTimeout> | null = null;
    const runDiagnostics = () => {
      if (diagTimer) clearTimeout(diagTimer);
      diagTimer = setTimeout(() => {
        setDiagnostics(analyzeDirectives(ytext.toString(), manifestsRef.current));
      }, 400);
    };
    ytext.observe(runDiagnostics);

    const view = new EditorView({
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown(),
          ...markdownStyling,
          EditorView.lineWrapping,
          placeholder("Write — [[ links, / components, frontmatter up top…"),
          witCompletions(() => allDocsRef.current, () => manifestsRef.current),
          yCollab(ytext, provider.awareness),
        ],
      }),
      parent: host.current!,
    });
    viewRef.current = view;
    runDiagnostics();

    return () => {
      if (diagTimer) clearTimeout(diagTimer);
      ytext.unobserve(runDiagnostics);
      view.destroy();
      provider.destroy();
      ydoc.destroy();
    };
  }, [vaultId, doc.id]);

  const insertAtCursor = (text: string) => {
    const view = viewRef.current;
    if (!view) return;
    const pos = view.state.selection.main.head;
    view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
    view.focus();
  };

  const uploadFiles = async (files: FileList) => {
    for (const file of files) {
      const safe = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
      const path = `uploads/${Date.now()}-${safe}`;
      try {
        const saved = await api.assets.upload(vaultId, path, file);
        const isImage = file.type.startsWith("image/");
        const url = `/api/content/${vaultId}/assets/raw/${saved.path}`;
        insertAtCursor(isImage ? `![${file.name}](${url})\n` : `[${file.name}](${url})\n`);
      } catch (e) {
        setError(`upload failed: ${e instanceof Error ? e.message : "unknown"}`);
      }
    }
  };

  return (
    <div
      className="editor-wrap"
      style={{ position: "relative" }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files);
      }}
    >
      <div className="doc-toolbar">
        <span style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>
          {collections[0] ? (
            <>
              <a href={`#/vault/${vaultId}/collection/${encodeURIComponent(collections[0].slug)}`} style={{ color: "inherit", textDecoration: "none" }}>
                {collections[0].name || collections[0].slug}
              </a>{" "}
              <span style={{ color: "var(--faint)" }}>/</span>{" "}
            </>
          ) : null}
          <span style={{ color: "var(--ink)" }}>{doc.title || doc.slug}</span>
          {peers > 0 && <span style={{ color: "var(--faint)" }}> · {peers} here</span>}
        </span>
        <div className="spacer" />
        {error && <span className="error-line">{error}</span>}
        <Button size="sm" variant="ghost" onClick={(e) => setVisMenu({ x: e.clientX - 80, y: 44 })}>
          <span className={`vis-dot vis-${doc.visibility}`} /> {doc.visibility} <ChevronDown size={12} style={{ color: "var(--faint)" }} />
        </Button>
        <Button size="sm" variant="ghost" title="doc actions" onClick={(e) => setMoreMenu({ x: e.clientX - 140, y: 44 })}>
          <Ellipsis size={14} />
        </Button>
        {visMenu && (
          <Menu
            at={visMenu}
            onClose={() => setVisMenu(null)}
            items={(["private", "unlisted", "public"] as const).map((v) => ({
              label: (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span className={`vis-dot vis-${v}`} /> {v}
                </span>
              ),
              onSelect: async () => {
                await api.docs.patch(vaultId, doc.id, { visibility: v });
                await onChanged();
                if (v === "public") toast("Published — live in about a second");
              },
            }))}
          />
        )}
        {moreMenu && (
          <Menu
            at={moreMenu}
            onClose={() => setMoreMenu(null)}
            items={[
              {
                label: `slug: ${doc.slug}`,
                onSelect: async () => {
                  const next = prompt("slug (renames leave a redirect):", doc.slug);
                  if (!next || next === doc.slug) return;
                  try {
                    await api.docs.patch(vaultId, doc.id, { slug: next });
                    await onChanged();
                    toast(`Renamed — /${next}`);
                  } catch (e) {
                    toast(e instanceof Error ? e.message : "rename failed", "danger");
                  }
                },
              },
              "sep",
              {
                label: "Delete doc",
                danger: true,
                onSelect: async () => {
                  if (!confirm(`Delete "${doc.title || doc.slug}"?`)) return;
                  await api.docs.remove(vaultId, doc.id);
                  onDeleted();
                },
              },
            ]}
          />
        )}
      </div>
      {/* Clicks on the empty pane focus the editor: the whole pane IS
          the input, not just the rendered first line. */}
      <div
        ref={host}
        className="editor-host"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && viewRef.current) {
            e.preventDefault();
            const view = viewRef.current;
            view.dispatch({ selection: { anchor: view.state.doc.length } });
            view.focus();
          }
        }}
      />
      {backlinks.length > 0 && (
        <div style={{ borderTop: "1px solid var(--line-soft)", padding: "var(--s2) var(--s4) var(--s3)", background: "var(--panel)" }}>
          <div style={{ font: "600 var(--text-xs) var(--font-ui)", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", margin: "4px 0" }}>
            {backlinks.length} backlink{backlinks.length > 1 ? "s" : ""}
          </div>
          {backlinks.map((b, i) => {
            const source = allDocs.find((d) => d.id === b.source);
            return (
              <ListRow
                key={i}
                href={`#/vault/${vaultId}/doc/${b.source}`}
                title={source?.title || source?.slug || b.source}
                meta={b.rel ?? b.kind}
              />
            );
          })}
        </div>
      )}
      {diagnostics.length > 0 && (
        <div className="diagnostics">
          {diagnostics.map((d, i) => (
            <span key={i}>⚠ {d.message}</span>
          ))}
        </div>
      )}
      {dragging && <div className="drop-hint">drop to upload</div>}
    </div>
  );
}
