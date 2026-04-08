#!/usr/bin/env node

// src/cli/index.ts
import fs from "fs";
import path from "path";
import { tsImport } from "tsx/esm/api";
function loadEnvFromProjectRoot(rootDir) {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("export ")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== void 0) continue;
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
async function run() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command !== "push") {
    console.log("Usage: npx kadak push");
    process.exit(1);
  }
  const configPath = path.join(process.cwd(), "kadak.config.ts");
  loadEnvFromProjectRoot(process.cwd());
  let config;
  try {
    config = await tsImport(configPath, { parentURL: import.meta.url });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`\u274C Kadak Error: Could not load 'kadak.config.ts' from your project root. ${message}`);
    process.exit(1);
  }
  const dbClient = config.default;
  if (!dbClient || typeof dbClient !== "object") {
    console.error("Kadak Error: invalid dbClient export");
    process.exit(1);
  }
  try {
    if (typeof dbClient.push !== "function") {
      console.error("Kadak Error: invalid dbClient export");
      process.exit(1);
    }
    if (!dbClient.schema || typeof dbClient.schema !== "object") {
      console.error("Kadak Error: schema not found on dbClient");
      process.exit(1);
    }
    console.log("\u{1F680} Kadak: Syncing schema with PostgreSQL...");
    await dbClient.push();
    console.log("\u2728 Kadak: Done.");
  } catch (e) {
    console.error(`\u274C Kadak Error: Push failed - ${e.message}`);
    process.exit(1);
  } finally {
    if (typeof dbClient.close === "function") {
      await dbClient.close().catch(() => {
      });
    }
  }
}
run();
