#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/cli/index.ts
var import_fs = __toESM(require("fs"), 1);
var import_path = __toESM(require("path"), 1);
var import_api = require("tsx/esm/api");
var import_meta = {};
function loadEnvFromProjectRoot(rootDir) {
  const envPath = import_path.default.join(rootDir, ".env");
  if (!import_fs.default.existsSync(envPath)) return;
  const content = import_fs.default.readFileSync(envPath, "utf8");
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
  const configPath = import_path.default.join(process.cwd(), "kadak.config.ts");
  loadEnvFromProjectRoot(process.cwd());
  let config;
  try {
    config = await (0, import_api.tsImport)(configPath, { parentURL: import_meta.url });
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
