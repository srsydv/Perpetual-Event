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

  // 1. BinaryMarket implementation (no constructor args)
  await hre.run("verify:verify", {
    address: addrs.binaryMarketImplementation,
    contract: "src/binary/BinaryMarket.sol:BinaryMarket",
    constructorArguments: [],
  }).catch((e) => console.log("BinaryMarket impl:", e.message));

  // 2. UpgradeableBeacon (implementation, owner)
  await hre.run("verify:verify", {
    address: addrs.marketBeacon,
    contract: "node_modules/@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol:UpgradeableBeacon",
    constructorArguments: [addrs.binaryMarketImplementation, admin],
  }).catch((e) => console.log("UpgradeableBeacon:", e.message));

  // 3. BinaryMarketFactory implementation (no constructor args)
  await hre.run("verify:verify", {
    address: addrs.binaryMarketFactoryImplementation,
    contract: "src/binary/BinaryMarketFactory.sol:BinaryMarketFactory",
    constructorArguments: [],
  }).catch((e) => console.log("BinaryMarketFactory impl:", e.message));

  // 4. Factory proxy: ERC1967Proxy(implementation, initializeCalldata)
  const BinaryMarketFactory = await hre.ethers.getContractFactory("BinaryMarketFactory");
  const initializeCalldata = BinaryMarketFactory.interface.encodeFunctionData("initialize", [
    admin,
    addrs.marketBeacon,
  ]);
  await hre.run("verify:verify", {
    address: addrs.binaryMarketFactoryProxy,
    contract: "node_modules/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy",
    constructorArguments: [addrs.binaryMarketFactoryImplementation, initializeCalldata],
  }).catch((e) => console.log("ERC1967Proxy (factory):", e.message));

  console.log("\nDone. Use binaryMarketFactoryProxy (or binaryMarketFactory) as the factory address.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
