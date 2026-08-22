import { useEffect, useRef, useState } from "react";
import type { Manifest, PropSpec } from "./api";

// Schema-driven component insertion: forms generated from the synced
// manifests — nobody hand-types directives unless they want to.
// spec: docs/model/L1-model#registry-manifests (read-only consumer)

function fieldFor(name: string, spec: PropSpec, value: string, set: (v: string) => void) {
  if (spec.options && spec.options.length > 0) {
    return (
      <select value={value} onChange={(e) => set(e.target.value)}>
        <option value="">—</option>
        {spec.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (spec.type === "boolean") {
    return (
      <select value={value} onChange={(e) => set(e.target.value)}>
        <option value="">—</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  return (
    <input
      value={value}
      placeholder={spec.default !== undefined ? String(spec.default) : spec.type ?? "value"}
      onChange={(e) => set(e.target.value)}
    />
  );
}

/** A directive is data: name + attrs (+ a markdown slot for containers). */
function directiveText(manifest: Manifest, values: Record<string, string>): string {
  const attrs = Object.entries(values)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(" ");
  const attrBlock = attrs ? `{${attrs}}` : "";
  const hasSlot = manifest.slots !== null && manifest.slots !== undefined;
  return hasSlot
    ? `:::${manifest.name}${attrBlock}\n\n:::\n`
    : `::${manifest.name}${attrBlock}\n`;
}

export function ComponentMenu({
  manifests,
  onInsert,
  onClose,
}: {
  manifests: Manifest[];
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Manifest | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  if (!selected) {
    return (
      <div className="popover" ref={ref}>
        <h3>insert component</h3>
        {manifests.map((m) => (
          <button
            key={m.name}
            onClick={() => {
              setSelected(m);
              setValues({});
            }}
            title={m.description}
          >
            ::{m.name}
            {m.description ? ` — ${m.description}` : ""}
          </button>
        ))}
      </div>
    );
  }

  const missingRequired = Object.entries(selected.props ?? {}).some(
    ([k, spec]) => spec.required && spec.default === undefined && !(values[k] ?? "").trim(),
  );

  return (
    <div className="popover" ref={ref}>
      <h3>::{selected.name}</h3>
      {Object.entries(selected.props ?? {}).map(([k, spec]) => (
        <label key={k}>
          <span>
            {k}
            {spec.required && <span className="req"> *</span>}
            {spec.description ? ` — ${spec.description}` : ""}
          </span>
          {fieldFor(k, spec, values[k] ?? "", (v) => setValues((old) => ({ ...old, [k]: v })))}
        </label>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="ghost" onClick={() => setSelected(null)}>
          back
        </button>
        <button
          className="primary"
          disabled={missingRequired}
          onClick={() => onInsert(directiveText(selected, values))}
        >
          insert
        </button>
      </div>
    </div>
  );
}
