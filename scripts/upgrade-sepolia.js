/**
 * Upgrade factory and market implementations at existing proxy/beacon addresses.
 * Uses deploy-addresses.sepolia.json. Run: npx hardhat run scripts/upgrade-sepolia.js --network sepolia
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const ADDRESSES_PATH = path.join(__dirname, "..", "deploy-addresses.sepolia.json");

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();

  if (!fs.existsSync(ADDRESSES_PATH)) {
    throw new Error("deploy-addresses.sepolia.json not found. Deploy first with scripts/deploy-upgradeable.js");
  }
  const addresses = JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf8"));
  const { eventFactoryProxy, marketBeacon } = addresses;

  console.log("Upgrading at existing addresses:", { eventFactoryProxy, marketBeacon });
  console.log("Deployer (must be admin):", deployer.address);

  // 1. Deploy new EventMarket implementation
  const EventMarketUpgradeable = await ethers.getContractFactory("EventMarketUpgradeable");
  const newMarketImpl = await EventMarketUpgradeable.deploy();
  await newMarketImpl.waitForDeployment();
  const newMarketImplAddress = await newMarketImpl.getAddress();
  console.log("New EventMarketUpgradeable impl:", newMarketImplAddress);

  // 2. Deploy new EventFactory implementation
  const EventFactoryUpgradeable = await ethers.getContractFactory("EventFactoryUpgradeable");
  const newFactoryImpl = await EventFactoryUpgradeable.deploy();
  await newFactoryImpl.waitForDeployment();
  const newFactoryImplAddress = await newFactoryImpl.getAddress();
  console.log("New EventFactoryUpgradeable impl:", newFactoryImplAddress);

  // 3. Upgrade beacon (owner = admin/deployer)
  const UpgradeableBeacon = await ethers.getContractFactory("UpgradeableBeacon");
  const beacon = UpgradeableBeacon.attach(marketBeacon);
  const txBeacon = await beacon.upgradeTo(newMarketImplAddress);
  await txBeacon.wait();
  console.log("Beacon upgraded to new market impl");

  // 4. Upgrade factory proxy (call upgradeTo on proxy; onlyAdmin)
  const factoryProxy = EventFactoryUpgradeable.attach(eventFactoryProxy);
  const txFactory = await factoryProxy.upgradeToAndCall(newFactoryImplAddress, "0x");
  await txFactory.wait();
  console.log("Factory proxy upgraded to new factory impl");

  // Update deploy-addresses with new implementation addresses (proxy/beacon unchanged)
  addresses.eventMarketImplementation = newMarketImplAddress;
  addresses.eventFactoryImplementation = newFactoryImplAddress;
  fs.writeFileSync(ADDRESSES_PATH, JSON.stringify(addresses, null, 2));
  console.log("Updated", ADDRESSES_PATH);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
