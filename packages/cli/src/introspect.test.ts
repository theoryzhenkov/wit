import { describe, expect, it } from "bun:test";
import { extractManifests } from "./introspect";

// spec: docs/platform/L1-platform#sync-map-source — extraction covers
// exactly the mapped components, with checker-derived schemas.

const CWD = import.meta.dir;

describe("extractManifests", () => {
  const { manifests, errors } = extractManifests(
    { hero: "./fixtures/Hero.ts", callout: "./fixtures/Callout.ts" },
    CWD,
  );

  it("extracts one manifest per mapped component, no sweep", () => {
    expect(errors).toEqual([]);
    expect(manifests.map((m) => m.name).sort()).toEqual(["callout", "hero"]);
  });

  it("derives names, types, optionality, and JSDoc from the checker", () => {
    const hero = manifests.find((m) => m.name === "hero")!;
    expect(hero.description).toBe("A full-width hero image.");
    expect(hero.props["src"]).toMatchObject({
      type: "string",
      required: true,
      description: "Image source path.",
    });
    expect(hero.props["width"]).toMatchObject({ type: "number" });
    expect(hero.props["width"]!.required).toBeUndefined();
    expect(hero.props["featured"]).toMatchObject({ type: "boolean" });
  });

  it("turns literal unions into selects", () => {
    const hero = manifests.find((m) => m.name === "hero")!;
    expect(hero.props["tone"]!.options).toEqual(["warm", "cool", "mono"]);
  });

  it("reads @default tags", () => {
    const hero = manifests.find((m) => m.name === "hero")!;
    expect(hero.props["alt"]!.default).toBe("");
  });

  it("degrades un-formable types to flagged raw fields", () => {
    const hero = manifests.find((m) => m.name === "hero")!;
    expect(hero.props["meta"]!.raw).toBe(true);
  });

  it("detects slots via children and keeps children out of props", () => {
    const callout = manifests.find((m) => m.name === "callout")!;
    expect(callout.slots).toEqual({ markdown: true });
    expect(callout.props["children"]).toBeUndefined();
    expect(callout.props["tone"]).toMatchObject({ required: true, options: ["info", "warning"] });
  });

  it("reports unmapped or Props-less files as errors", () => {
    const bad = extractManifests({ ghost: "./fixtures/Missing.ts" }, CWD);
    expect(bad.errors).toHaveLength(1);
    expect(bad.manifests).toHaveLength(0);
  });
});
