/**
 * Upgrade binary factory and market implementations at existing proxy/beacon addresses.
 * Uses deploy-addresses-binary.json. Run: npx hardhat run scripts/upgrade-binary-sepolia.js --network sepolia
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const ADDRESSES_PATH = path.join(__dirname, "..", "deploy-addresses-binary.json");

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();

  if (!fs.existsSync(ADDRESSES_PATH)) {
    throw new Error("deploy-addresses-binary.json not found. Deploy first with scripts/deploy-binary.js");
  }
  const addresses = JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf8"));
  const { binaryMarketFactoryProxy, marketBeacon } = addresses;

  console.log("Upgrading binary at existing addresses:", { binaryMarketFactoryProxy, marketBeacon });
  console.log("Deployer (must be admin):", deployer.address);

  const BinaryMarket = await ethers.getContractFactory("BinaryMarket");
  const newMarketImpl = await BinaryMarket.deploy();
  await newMarketImpl.waitForDeployment();
  const newMarketImplAddress = await newMarketImpl.getAddress();
  console.log("New BinaryMarket impl:", newMarketImplAddress);

  const BinaryMarketFactory = await ethers.getContractFactory("BinaryMarketFactory");
  const newFactoryImpl = await BinaryMarketFactory.deploy();
  await newFactoryImpl.waitForDeployment();
  const newFactoryImplAddress = await newFactoryImpl.getAddress();
  console.log("New BinaryMarketFactory impl:", newFactoryImplAddress);

  const UpgradeableBeacon = await ethers.getContractFactory("UpgradeableBeacon");
  const beacon = UpgradeableBeacon.attach(marketBeacon);
  const txBeacon = await beacon.upgradeTo(newMarketImplAddress);
  await txBeacon.wait();
  console.log("Market beacon upgraded to new BinaryMarket impl");

  const factoryProxy = BinaryMarketFactory.attach(binaryMarketFactoryProxy);
  const txFactory = await factoryProxy.upgradeToAndCall(newFactoryImplAddress, "0x");
  await txFactory.wait();
  console.log("Factory proxy upgraded to new BinaryMarketFactory impl");

  addresses.binaryMarketImplementation = newMarketImplAddress;
  addresses.binaryMarketFactoryImplementation = newFactoryImplAddress;
  fs.writeFileSync(ADDRESSES_PATH, JSON.stringify(addresses, null, 2));
  console.log("Updated", ADDRESSES_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
