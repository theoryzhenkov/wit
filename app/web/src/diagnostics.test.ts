import { describe, expect, it } from "bun:test";
import { analyzeDirectives } from "./diagnostics";
import type { Manifest } from "./api";

// spec: docs/model/L1-model#directive-diagnostics — advisory only:
// unknown directives and missing required props warn, never fail.

const manifests: Manifest[] = [
  {
    name: "hero",
    description: "",
    props: {
      src: { type: "string", required: true },
      alt: { type: "string" },
    },
    slots: null,
  },
  {
    name: "callout",
    description: "",
    props: { tone: { type: "string", required: true, default: "info" } },
    slots: null,
  },
];

describe("analyzeDirectives", () => {
  it("flags unknown directives once", () => {
    const out = analyzeDirectives("::mystery\n\n::mystery\n", manifests);
    expect(out).toHaveLength(1);
    expect(out[0]!.message).toContain("unknown component ::mystery");
  });

  it("flags missing required props without defaults", () => {
    const out = analyzeDirectives('::hero{alt="x"}', manifests);
    expect(out).toHaveLength(1);
    expect(out[0]!.message).toContain('missing required prop "src"');
  });

  it("accepts satisfied and defaulted props", () => {
    expect(analyzeDirectives('::hero{src="/x.png"}', manifests)).toHaveLength(0);
    expect(analyzeDirectives(":::callout\nslot\n:::", manifests)).toHaveLength(0);
  });

  it("sees inline directives", () => {
    const out = analyzeDirectives("text :zap[bang]{x=1} more", manifests);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("zap");
  });

  it("never throws on directive-free or odd text", () => {
    expect(analyzeDirectives("", manifests)).toEqual([]);
    expect(analyzeDirectives("plain **markdown** [[link]]", manifests)).toEqual([]);
  });
});
