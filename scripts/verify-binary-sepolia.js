/**
 * Verify binary (Polymarket-style) contracts on Sepolia Etherscan.
 * Run after deploy-binary.js. Uses deploy-addresses-binary.json.
 *
 * npx hardhat run scripts/verify-binary-sepolia.js --network sepolia
 */

const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const path = "deploy-addresses-binary.json";
  if (!fs.existsSync(path)) {
    throw new Error(`Run deploy-binary first. Missing ${path}`);
  }
  const addrs = JSON.parse(fs.readFileSync(path, "utf8"));

  const admin = process.env.ADMIN || "0xf69F75EB0c72171AfF58D79973819B6A3038f39f";

  console.log("Verifying binary contracts on Sepolia...\n");

  // 1. BinaryMarketFactory (constructor: admin)
  await hre.run("verify:verify", {
    address: addrs.binaryMarketFactory,
    contract: "src/binary/BinaryMarketFactory.sol:BinaryMarketFactory",
    constructorArguments: [admin],
  }).catch((e) => console.log("BinaryMarketFactory:", e.message));

  // 2. BinaryMarket (no constructor args)
  const marketAddr = addrs.markets["0"];
  if (marketAddr) {
    await hre.run("verify:verify", {
      address: marketAddr,
      contract: "src/binary/BinaryMarket.sol:BinaryMarket",
      constructorArguments: [],
    }).catch((e) => console.log("BinaryMarket:", e.message));
  }

  console.log("\nDone. If any failed, run the verify command manually with the same constructor args.");
}

main().catch((e) => { console.error(e); process.exit(1); });
