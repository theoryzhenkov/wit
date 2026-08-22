import { useCallback, useEffect, useState } from "react";
import { api, type SessionUser, type Vault } from "./api";
import { SignIn } from "./SignIn";
import { VaultView } from "./VaultView";

// Hash routes: #/vault/<id> and #/vault/<id>/doc/<docId> — enough for a
// single-pane editor, no router dependency.

export interface Route {
  vaultId: string | null;
  docId: string | null;
  collectionSlug: string | null;
  settings: boolean;
}

function parseHash(): Route {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/");
  const route: Route = { vaultId: null, docId: null, collectionSlug: null, settings: false };
  if (parts[0] === "vault" && parts[1]) {
    route.vaultId = parts[1];
    if (parts[2] === "doc" && parts[3]) route.docId = parts[3];
    if (parts[2] === "collection" && parts[3]) route.collectionSlug = decodeURIComponent(parts[3]);
    if (parts[2] === "settings") route.settings = true;
  }
  return route;
}

export function App() {
  const [user, setUser] = useState<SessionUser | null | "loading">("loading");
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [route, setRoute] = useState<Route>(parseHash());
  const [newVaultName, setNewVaultName] = useState("");

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const refreshVaults = useCallback(async () => {
    const list = await api.vaults.list();
    setVaults(list);
    return list;
  }, []);

  useEffect(() => {
    void (async () => {
      const session = await api.session();
      setUser(session);
      if (session) {
        const list = await refreshVaults();
        if (!parseHash().vaultId && list[0]) {
          window.location.hash = `#/vault/${list[0].id}`;
        }
      }
    })();
  }, [refreshVaults]);

  if (user === "loading") return null;
  if (!user) return <SignIn />;

  const vault = vaults.find((v) => v.id === route.vaultId) ?? null;

  if (!vault) {
    return (
      <div className="center-card">
        <div className="card">
          <h1>
            <span className="wordmark">wit</span> — your vaults
          </h1>
          {vaults.map((v) => (
            <button key={v.id} onClick={() => (window.location.hash = `#/vault/${v.id}`)}>
              {v.name}
            </button>
          ))}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newVaultName.trim()) return;
              const created = await api.vaults.create(newVaultName.trim());
              setNewVaultName("");
              await refreshVaults();
              window.location.hash = `#/vault/${created.id}`;
            }}
          >
            <input
              placeholder="new vault name"
              value={newVaultName}
              onChange={(e) => setNewVaultName(e.target.value)}
            />
            <button className="primary" style={{ marginLeft: 8 }}>
              create
            </button>
          </form>
          <button
            className="ghost"
            onClick={async () => {
              await api.signOut();
              setUser(null);
            }}
          >
            sign out
          </button>
        </div>
      </div>
    );
  }

  return <VaultView key={vault.id} vault={vault} route={route} />;
}
