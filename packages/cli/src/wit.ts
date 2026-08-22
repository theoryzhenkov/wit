#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { extractManifests, type ComponentMap } from "./introspect";

// `wit components sync` — the registry's only writer. Reads the adapter's
// component map, introspects mapped components, pushes manifests.
// Strictly one-directional: code → data by extraction; this tool never
// writes to wit.config or any site source.
// spec: docs/platform/L1-platform#sync-one-way / #sync-map-source

interface WitConfig {
  url: string;
  vaultId: string;
  /** Name of the env var holding the write key (default WIT_WRITE_KEY). */
  keyEnv?: string;
  components: ComponentMap;
}

function usage(): never {
  console.error(`usage: wit components sync [--config wit.config.json] [--dry-run]`);
  process.exit(2);
}

function loadConfig(path: string): WitConfig {
  const raw = JSON.parse(readFileSync(path, "utf8")) as WitConfig;
  if (!raw.url || !raw.vaultId || typeof raw.components !== "object") {
    console.error(`${path}: needs url, vaultId, and a components map`);
    process.exit(1);
  }
  return raw;
}

async function sync(configPath: string, dryRun: boolean): Promise<void> {
  const config = loadConfig(configPath);
  const configDir = dirname(resolve(configPath));

  const { manifests, errors } = extractManifests(config.components, configDir);
  for (const error of errors) console.error(`✗ ${error}`);
  if (errors.length > 0) process.exit(1);

  console.log(`extracted ${manifests.length} manifest(s): ${manifests.map((m) => m.name).join(", ")}`);
  if (dryRun) {
    console.log(JSON.stringify(manifests, null, 2));
    return;
  }

  const keyEnv = config.keyEnv ?? "WIT_WRITE_KEY";
  const key = process.env[keyEnv];
  if (!key) {
    console.error(`missing write key: set ${keyEnv}`);
    process.exit(1);
  }

  const res = await fetch(`${config.url}/api/vaults/${config.vaultId}/registry`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(manifests),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    console.error(`push failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const result = (await res.json()) as {
    added: string[];
    updated: string[];
    pruned: string[];
    warnings: { name: string; reason: string; usageCount: number; docSlugs: string[] }[];
  };
  if (result.added.length) console.log(`+ added: ${result.added.join(", ")}`);
  if (result.updated.length) console.log(`~ updated: ${result.updated.join(", ")}`);
  if (result.pruned.length) console.log(`- pruned: ${result.pruned.join(", ")}`);
  // spec: docs/platform/L1-platform#sync-drift-warn
  for (const w of result.warnings) {
    console.warn(
      `⚠ ${w.name} (${w.reason}) still has ${w.usageCount} usage(s) in: ${w.docSlugs.join(", ")}`,
    );
  }
  if (!result.added.length && !result.updated.length && !result.pruned.length) {
    console.log("registry already in sync");
  }
}

const args = process.argv.slice(2);
if (args[0] !== "components" || args[1] !== "sync") usage();
let configPath = "wit.config.json";
let dryRun = false;
for (let i = 2; i < args.length; i++) {
  if (args[i] === "--config" && args[i + 1]) configPath = args[++i]!;
  else if (args[i] === "--dry-run") dryRun = true;
  else usage();
}
await sync(configPath, dryRun);
