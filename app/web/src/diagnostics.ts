import type { Manifest } from "./api";

// Advisory directive diagnostics: unknown names and missing required
// props. Never blocks a save — the doc text is always valid text.
// spec: docs/model/L1-model#directive-diagnostics

export interface Diagnostic {
  name: string;
  message: string;
}

// ::name{...} / :::name{...} at line starts; :name[..]{..} inline.
const BLOCK_DIRECTIVE_RE = /^:{2,3}([a-z][a-z0-9-]*)(\{[^}]*\})?/gm;
const INLINE_DIRECTIVE_RE = /(?<![:\w]):([a-z][a-z0-9-]*)\[[^\]]*\](\{[^}]*\})?/g;

function parseAttrs(raw: string | undefined): Set<string> {
  const keys = new Set<string>();
  if (!raw) return keys;
  for (const m of raw.matchAll(/([a-zA-Z_][\w-]*)\s*=/g)) keys.add(m[1]!);
  return keys;
}

export function analyzeDirectives(text: string, manifests: Manifest[]): Diagnostic[] {
  const byName = new Map(manifests.map((m) => [m.name, m]));
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();

  const visit = (name: string, attrsRaw: string | undefined) => {
    const manifest = byName.get(name);
    if (!manifest) {
      const key = `unknown:${name}`;
      if (!seen.has(key)) {
        seen.add(key);
        diagnostics.push({ name, message: `unknown component ::${name}` });
      }
      return;
    }
    const given = parseAttrs(attrsRaw);
    for (const [prop, spec] of Object.entries(manifest.props ?? {})) {
      if (spec.required && spec.default === undefined && !given.has(prop)) {
        const key = `missing:${name}.${prop}`;
        if (!seen.has(key)) {
          seen.add(key);
          diagnostics.push({ name, message: `::${name} is missing required prop "${prop}"` });
        }
      }
    }
  };

  for (const m of text.matchAll(BLOCK_DIRECTIVE_RE)) visit(m[1]!, m[2]);
  for (const m of text.matchAll(INLINE_DIRECTIVE_RE)) visit(m[1]!, m[2]);
  return diagnostics;
}
