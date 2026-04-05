#!/usr/bin/env node
import path from "path";
import { pathToFileURL } from "url";
import { kadak } from "../index.js";

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

  const { url, schema } = config.default || config;

  if (!url) {
    console.error("❌ Kadak Error: 'url' property is missing in 'kadak.config.ts'");
    process.exit(1);
  }

  if (!schema) {
    console.error("❌ Kadak Error: 'schema' property is missing in 'kadak.config.ts'");
    process.exit(1);
  }

  try {
    const db = kadak({ url });
    db.define(schema);
    
    console.log("🚀 Kadak: Syncing schema with PostgreSQL...");
    await db.push();
    console.log("✨ Kadak: Done.");
    
    await db.close();
  } catch (e: any) {
    console.error(`❌ Kadak Error: Push failed - ${e.message}`);
    process.exit(1);
  }
}

run();
