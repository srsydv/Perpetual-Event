#!/usr/bin/env node
/**
 * Copy deploy-addresses-binary.json from repo root to frontend src/data so the app uses latest deployed addresses.
 * Run from frontend-binary: node scripts/sync-deploy.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const deployPath = path.join(root, "deploy-addresses-binary.json");
const outPath = path.join(__dirname, "../src/data/deploy-addresses-binary.json");
const publicPath = path.join(__dirname, "../public/deploy-addresses-binary.json");

if (!fs.existsSync(deployPath)) {
  console.warn("deploy-addresses-binary.json not found at", deployPath);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(deployPath, "utf8"));
const out = {
  chainId: data.chainId,
  collateral: data.collateral,
  binaryMarketFactory: data.binaryMarketFactory || data.binaryMarketFactoryProxy,
  markets: data.markets || {},
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log("Synced deploy addresses to", outPath);
fs.mkdirSync(path.dirname(publicPath), { recursive: true });
fs.writeFileSync(publicPath, JSON.stringify(out, null, 2));
console.log("Synced deploy addresses to", publicPath);
