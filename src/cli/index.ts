#!/usr/bin/env node
/// <reference types="node" />
import path from "path";
import { pathToFileURL } from "url";

async function run() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command !== "push") {
    console.log("Usage: npx kadak push");
    process.exit(1);
  }

  const configPath = path.join(process.cwd(), "kadak.config.ts");
  const configUrl = pathToFileURL(configPath).href;

  let config;
  try {
    config = await import(configUrl);
  } catch (e) {
    console.error(`❌ Kadak Error: Could not find 'kadak.config.ts' in your project root.`);
    process.exit(1);
  }

  const dbClient = config.default;
  if (!dbClient || typeof dbClient !== "object") {
    console.error("❌ Kadak Error: 'kadak.config.ts' must default-export an initialized dbClient instance.");
    process.exit(1);
  }

  try {
    if (typeof dbClient.push !== "function") {
      console.error("❌ Kadak Error: Default export is not a valid dbClient instance. Missing push().");
      process.exit(1);
    }

    if (!dbClient.schema || typeof dbClient.schema !== "object") {
      console.error("❌ Kadak Error: Default export dbClient is missing schema metadata.");
      process.exit(1);
    }

    console.log("🚀 Kadak: Syncing schema with PostgreSQL...");
    await dbClient.push();
    console.log("✨ Kadak: Done.");
  } catch (e: any) {
    console.error(`❌ Kadak Error: Push failed - ${e.message}`);
    process.exit(1);
  } finally {
    if (typeof dbClient.close === "function") {
      await dbClient.close().catch(() => {});
    }
  }
}

run();
