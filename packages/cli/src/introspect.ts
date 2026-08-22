import ts from "typescript";
import { resolve } from "node:path";

// TS Props introspection for `wit components sync`. Extracts manifests
// only for components listed in the adapter map — opt-in by construction.
// spec: docs/platform/L1-platform#sync-map-source
//
// Contract: a mapped module exposes its props as an exported `Props`
// interface/type. A `children` member marks a slot and is not a prop.
// Names, primitive types, optionality, and JSDoc come from the checker;
// literal unions become selects; anything else degrades to a flagged
// raw field. `@default` JSDoc tags become defaults.

export interface PropSpec {
  type: string;
  required?: boolean;
  description?: string;
  default?: unknown;
  options?: string[];
  /** True when the TS type could not be turned into a form field. */
  raw?: boolean;
}

export interface ExtractedManifest {
  name: string;
  description: string;
  props: Record<string, PropSpec>;
  slots: { markdown: boolean } | null;
}

export interface ComponentMap {
  [directiveName: string]: string; // implementation path
}

function propSpecFromType(checker: ts.TypeChecker, type: ts.Type): Omit<PropSpec, "required"> {
  const flags = type.getFlags();
  if (flags & ts.TypeFlags.String) return { type: "string" };
  if (flags & ts.TypeFlags.Number) return { type: "number" };
  if (flags & ts.TypeFlags.Boolean || flags & ts.TypeFlags.BooleanLiteral) {
    return { type: "boolean" };
  }
  if (type.isUnion()) {
    const parts = type.types.filter(
      (t) => !(t.getFlags() & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)),
    );
    if (parts.length > 0 && parts.every((t) => t.isStringLiteral())) {
      return { type: "string", options: parts.map((t) => (t as ts.StringLiteralType).value) };
    }
    if (parts.length === 1) return propSpecFromType(checker, parts[0]!);
    if (parts.every((t) => t.getFlags() & (ts.TypeFlags.BooleanLiteral | ts.TypeFlags.Boolean))) {
      return { type: "boolean" };
    }
  }
  // Un-formable: degrade to a flagged raw field rather than lie.
  return { type: checker.typeToString(type), raw: true };
}

function parseDefault(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw.replace(/^["']|["']$/g, "");
  }
}

export function extractManifests(
  map: ComponentMap,
  cwd: string = process.cwd(),
): { manifests: ExtractedManifest[]; errors: string[] } {
  const entries = Object.entries(map);
  const files = entries.map(([, p]) => resolve(cwd, p));
  const program = ts.createProgram(files, {
    strict: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ESNext,
    noEmit: true,
  });
  const checker = program.getTypeChecker();

  const manifests: ExtractedManifest[] = [];
  const errors: string[] = [];

  for (const [name, relPath] of entries) {
    const source = program.getSourceFile(resolve(cwd, relPath));
    if (!source) {
      errors.push(`${name}: cannot read ${relPath}`);
      continue;
    }
    const moduleSymbol = checker.getSymbolAtLocation(source);
    const propsSymbol = moduleSymbol
      ? checker.getExportsOfModule(moduleSymbol).find((s) => s.name === "Props")
      : undefined;
    if (!propsSymbol) {
      errors.push(`${name}: ${relPath} exports no Props type`);
      continue;
    }

    const declaration = propsSymbol.declarations?.[0];
    const propsType = checker.getDeclaredTypeOfSymbol(propsSymbol);
    const componentDocs = ts.displayPartsToString(
      propsSymbol.getDocumentationComment(checker),
    );

    const props: Record<string, PropSpec> = {};
    let hasSlot = false;

    for (const member of propsType.getProperties()) {
      const memberType = checker.getTypeOfSymbolAtLocation(
        member,
        declaration ?? source,
      );
      if (member.name === "children") {
        hasSlot = true;
        continue;
      }
      const optional = (member.getFlags() & ts.SymbolFlags.Optional) !== 0;
      const spec: PropSpec = {
        ...propSpecFromType(checker, checker.getNonNullableType(memberType)),
      };
      if (!optional) spec.required = true;
      const docs = ts.displayPartsToString(member.getDocumentationComment(checker));
      if (docs) spec.description = docs;
      const defaultTag = member
        .getJsDocTags(checker)
        .find((t) => t.name === "default");
      if (defaultTag?.text) spec.default = parseDefault(ts.displayPartsToString(defaultTag.text));
      props[member.name] = spec;
    }

    manifests.push({
      name,
      description: componentDocs,
      props,
      slots: hasSlot ? { markdown: true } : null,
    });
  }

  return { manifests, errors };
}
