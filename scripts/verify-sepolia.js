/**
 * Verify deployed contracts on Sepolia Etherscan.
 * Run after deploy-upgradeable.js. Set ETHERSCAN_API_KEY in .env.
 *
 * npx hardhat run scripts/verify-sepolia.js --network sepolia
 */

const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const path = "deploy-addresses.sepolia.json";
  if (!fs.existsSync(path)) {
    throw new Error(`Run deploy first. Missing ${path}`);
  }
  const addrs = JSON.parse(fs.readFileSync(path, "utf8"));

  console.log("Verifying implementation contracts...\n");

  // 1. EventMarketUpgradeable (implementation, no constructor args)
  await hre.run("verify:verify", {
    address: addrs.eventMarketImplementation,
    contract: "src/EventMarketUpgradeable.sol:EventMarketUpgradeable",
    constructorArguments: [],
  }).catch((e) => console.log("EventMarketUpgradeable:", e.message));

  // 2. UpgradeableBeacon (implementation, owner)
  const [deployer] = await hre.ethers.getSigners();
  const admin = process.env.ADMIN || deployer.address;
  await hre.run("verify:verify", {
    address: addrs.marketBeacon,
    contract: "node_modules/@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol:UpgradeableBeacon",
    constructorArguments: [addrs.eventMarketImplementation, admin],
  }).catch((e) => console.log("UpgradeableBeacon:", e.message));

  // 3. EventFactoryUpgradeable (implementation, no constructor args)
  await hre.run("verify:verify", {
    address: addrs.eventFactoryImplementation,
    contract: "src/EventFactoryUpgradeable.sol:EventFactoryUpgradeable",
    constructorArguments: [],
  }).catch((e) => console.log("EventFactoryUpgradeable:", e.message));

  // 4. Factory proxy: verify as proxy (implementation + init data)
  const initData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address"],
    [addrs.collateral, admin, addrs.marketBeacon]
  );
  const EventFactoryUpgradeable = await hre.ethers.getContractFactory("EventFactoryUpgradeable");
  const initializeCalldata = EventFactoryUpgradeable.interface.encodeFunctionData("initialize", [
    addrs.collateral,
    admin,
    addrs.marketBeacon,
  ]);
  await hre.run("verify:verify", {
    address: addrs.eventFactoryProxy,
    contract: "node_modules/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy",
    constructorArguments: [addrs.eventFactoryImplementation, initializeCalldata],
  }).catch((e) => console.log("ERC1967Proxy (factory):", e.message));

  console.log("\nDone. If any failed, run the verify command manually (see README).");
}

main().catch((e) => { console.error(e); process.exit(1); });
