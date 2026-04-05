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
    // Dynamic import works with tsx during dev and potentially after build if handled
    config = await import(configUrl);
  } catch (e) {
    console.error(`❌ Error: Could not find kadak.config.ts in root directory.`);
    process.exit(1);
  }

  const { url, schema } = config.default || config;

  if (!url) {
    console.error("❌ Error: 'url' missing in kadak.config.ts");
    process.exit(1);
  }

  if (!schema) {
    console.error("❌ Error: 'schema' missing in kadak.config.ts");
    process.exit(1);
  }

  try {
    const db = kadak({ url });
    const k = db.define(schema);
    
    console.log("🚀 Kadak CLI: Starting push...");
    await k.push();
    console.log("✨ Kadak CLI: Push successful!");
    
    await db.close();
  } catch (e: any) {
    console.error(`❌ Kadak CLI: Push failed - ${e.message}`);
    process.exit(1);
  }
}

run();
