import { useCallback, useEffect, useState } from "react";
import { api, type Vault } from "./api";

// Vault settings: the connection surface for sites and tooling — the
// vault id and its API keys. Tokens appear exactly once, at creation.
// spec: docs/platform/L1-platform#api-key-scope

interface KeyRow {
  id: string;
  name: string;
  scope: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function SettingsView({ vault }: { vault: Vault }) {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("read");
  const [minted, setMinted] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState("");

  const refresh = useCallback(async () => {
    setKeys(await api.keys.list(vault.id));
  }, [vault.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const copy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
  };

  return (
    <div className="collection-view">
      <h2>settings — {vault.name}</h2>

      <h3>vault id</h3>
      <p className="hint" style={{ color: "var(--muted)", fontSize: 13 }}>
        Sites and tooling address this vault by id.
      </p>
      <div className="rule-row">
        <code style={{ userSelect: "all" }}>{vault.id}</code>
        <button onClick={() => void copy("id", vault.id)}>
          {copied === "id" ? "copied ✓" : "copy"}
        </button>
      </div>

      <h3>api keys</h3>
      <p className="hint" style={{ color: "var(--muted)", fontSize: 13 }}>
        <b>read</b> — site consumption: public docs, plus unlisted by direct slug.{" "}
        <b>write</b> — tooling (component sync, migration scripts): full vault content, no admin.
      </p>

      {minted && (
        <div className="rule-row" style={{ background: "var(--accent-soft)", padding: 12, borderRadius: 8 }}>
          <div style={{ flex: 1 }}>
            <b>{minted.name}</b> — copy this token now; it is never shown again:
            <br />
            <code style={{ userSelect: "all", wordBreak: "break-all" }}>{minted.token}</code>
          </div>
          <button className="primary" onClick={() => void copy("token", minted.token)}>
            {copied === "token" ? "copied ✓" : "copy token"}
          </button>
          <button className="ghost" onClick={() => setMinted(null)}>
            done
          </button>
        </div>
      )}

      <form
        className="rule-row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const created = await api.keys.create(vault.id, name.trim(), scope);
          setMinted({ name: name.trim(), token: created.token });
          setName("");
          await refresh();
        }}
      >
        <input
          placeholder="key name (e.g. theor.net)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select value={scope} onChange={(e) => setScope(e.target.value as "read" | "write")}>
          <option value="read">read</option>
          <option value="write">write</option>
        </select>
        <button className="primary">mint key</button>
      </form>

      <ul className="member-list">
        {keys.length === 0 && <li style={{ color: "var(--muted)" }}>no keys yet</li>}
        {keys.map((k) => (
          <li key={k.id}>
            <span className="title">{k.name || "(unnamed)"}</span>
            <span className="kind">{k.scope}</span>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : "never used"}
            </span>
            <span className="row-actions">
              <button
                className="danger"
                onClick={async () => {
                  if (!confirm(`Revoke "${k.name}"? Anything using it stops working.`)) return;
                  await api.keys.remove(vault.id, k.id);
                  await refresh();
                }}
              >
                revoke
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
