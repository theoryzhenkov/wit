import { useCallback, useEffect, useState } from "react";
import { api, type Collection, type MemberEntry } from "./api";

// Collection editing: rule (tag filter + sort), pins with explicit order,
// excludes. Membership preview is the algebra's real output.
// spec: docs/model/L1-model#collection-algebra

export function CollectionView({
  vaultId,
  collection,
  onChanged,
}: {
  vaultId: string;
  collection: Collection;
  onChanged: () => Promise<void> | void;
}) {
  const [members, setMembers] = useState<MemberEntry[]>([]);
  const [name, setName] = useState(collection.name);
  const firstTagFilter = collection.rule?.filters.find((f) => f.on === "tags");
  const [ruleTag, setRuleTag] = useState(
    typeof firstTagFilter?.value === "string" ? firstTagFilter.value : "",
  );
  const [sortKey, setSortKey] = useState(collection.sortKey ?? "updated.desc");

  const refresh = useCallback(async () => {
    setMembers(await api.collections.membership(vaultId, collection.slug));
  }, [vaultId, collection.slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveSettings = async () => {
    await api.collections.update(vaultId, collection.id, {
      name,
      rule: ruleTag.trim()
        ? { filters: [{ on: "tags", op: "contains", value: ruleTag.trim() }] }
        : null,
      sortKey,
    });
    await onChanged();
    await refresh();
  };

  const pins = members.filter((m) => m.kind === "pin");

  const movePin = async (index: number, delta: number) => {
    const other = index + delta;
    if (other < 0 || other >= pins.length) return;
    // Renumber positions 0..n with the two entries swapped.
    const order = [...pins];
    [order[index], order[other]] = [order[other]!, order[index]!];
    for (let i = 0; i < order.length; i++) {
      await api.collections.setItem(vaultId, collection.id, order[i]!.docId, "pin", i);
    }
    await refresh();
  };

  return (
    <div className="collection-view">
      <h2>{collection.name || collection.slug}</h2>
      <div className="rule-row">
        <label>
          name{" "}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={collection.slug} />
        </label>
        <label>
          rule: tag{" "}
          <input
            value={ruleTag}
            onChange={(e) => setRuleTag(e.target.value)}
            placeholder="e.g. essay (empty = pins only)"
          />
        </label>
        <label>
          sort{" "}
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
            {["updated.desc", "updated.asc", "created.desc", "created.asc", "slug.asc", "title.asc"].map(
              (k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ),
            )}
          </select>
        </label>
        <button className="primary" onClick={() => void saveSettings()}>
          save
        </button>
        <button
          className="danger ghost"
          onClick={async () => {
            if (!confirm(`Delete collection "${collection.slug}"? Docs are untouched.`)) return;
            await api.collections.remove(vaultId, collection.id);
            await onChanged();
            window.location.hash = `#/vault/${vaultId}`;
          }}
        >
          delete collection
        </button>
      </div>

      <ul className="member-list">
        {members.length === 0 && <li style={{ color: "var(--muted)" }}>no members yet</li>}
        {members.map((m) => {
          const pinIndex = pins.findIndex((p) => p.docId === m.docId);
          return (
            <li key={m.docId}>
              <span className={`vis-dot vis-${m.visibility}`} title={m.visibility} />
              <a className="title" href={`#/vault/${vaultId}/doc/${m.docId}`}>
                {m.title || m.slug}
              </a>
              <span className="kind">{m.kind}</span>
              <span className="row-actions">
                {m.kind === "pin" ? (
                  <>
                    <button onClick={() => void movePin(pinIndex, -1)} title="move up">
                      ↑
                    </button>
                    <button onClick={() => void movePin(pinIndex, 1)} title="move down">
                      ↓
                    </button>
                    <button
                      onClick={async () => {
                        await api.collections.removeItem(vaultId, collection.id, m.docId);
                        await refresh();
                      }}
                    >
                      unpin
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={async () => {
                        await api.collections.setItem(
                          vaultId,
                          collection.id,
                          m.docId,
                          "pin",
                          pins.length,
                        );
                        await refresh();
                      }}
                    >
                      pin
                    </button>
                    <button
                      onClick={async () => {
                        await api.collections.setItem(vaultId, collection.id, m.docId, "exclude");
                        await refresh();
                      }}
                    >
                      exclude
                    </button>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="hint" style={{ color: "var(--muted)", fontSize: 13 }}>
        Rule matches update live as docs change; pins hold explicit order ahead of them.
        Excluded docs stay excluded even when the rule matches.
      </p>
    </div>
  );
}
