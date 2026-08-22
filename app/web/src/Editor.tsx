import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { yCollab } from "y-codemirror.next";
import { api, type DocSummary, type Manifest } from "./api";
import { analyzeDirectives, type Diagnostic } from "./diagnostics";
import { ComponentMenu } from "./ComponentMenu";

// CodeMirror + Yjs over the relay: collaborative markdown, frontmatter as
// raw text in the document (comfortable tier).

export function Editor({
  vaultId,
  doc,
  onChanged,
  onDeleted,
}: {
  vaultId: string;
  doc: DocSummary;
  onChanged: () => Promise<void> | void;
  onDeleted: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [slug, setSlug] = useState(doc.slug);
  const [peers, setPeers] = useState(0);
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState("");

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
          EditorView.lineWrapping,
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

  const visibilityOptions = useMemo(() => ["private", "unlisted", "public"] as const, []);

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
        <input
          className="slug-input"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          onBlur={async () => {
            if (slug === doc.slug) return;
            try {
              setError("");
              const updated = await api.docs.patch(vaultId, doc.id, { slug });
              setSlug(updated.slug);
              await onChanged();
            } catch (e) {
              setError(e instanceof Error ? e.message : "rename failed");
              setSlug(doc.slug);
            }
          }}
          title="slug — renames leave a redirect"
        />
        <select
          value={doc.visibility}
          onChange={async (e) => {
            await api.docs.patch(vaultId, doc.id, { visibility: e.target.value });
            await onChanged();
          }}
          title="visibility"
        >
          {visibilityOptions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <div style={{ position: "relative" }}>
          <button onClick={() => setMenuOpen((o) => !o)} disabled={manifests.length === 0}
            title={manifests.length === 0 ? "no components synced to this vault" : "insert component"}>
            + component
          </button>
          {menuOpen && (
            <ComponentMenu
              manifests={manifests}
              onInsert={(text) => {
                insertAtCursor(text);
                setMenuOpen(false);
              }}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
        <div className="spacer" />
        {peers > 0 && <span className="peers">{peers} other editor{peers > 1 ? "s" : ""}</span>}
        {error && <span className="error-line">{error}</span>}
        <button
          className="danger ghost"
          onClick={async () => {
            if (!confirm(`Delete "${doc.title || doc.slug}"?`)) return;
            await api.docs.remove(vaultId, doc.id);
            onDeleted();
          }}
        >
          delete
        </button>
      </div>
      <div ref={host} style={{ flex: 1, minHeight: 0, overflow: "auto" }} />
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
