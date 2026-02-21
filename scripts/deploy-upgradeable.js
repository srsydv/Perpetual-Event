const hre = require("hardhat");
const fs = require("fs");

const COLLATERAL_DEFAULT = "0x799a5570318c0C5Fcfd09b0f573335B5aa8d85Ff";

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  const collateral = process.env.COLLATERAL || process.env.COLLATERAL_TOKEN_ADDRESS || COLLATERAL_DEFAULT;
  const admin = process.env.ADMIN || deployer.address;

  console.log("Deploying with:", { collateral, admin, deployer: deployer.address });

  // 1. EventMarket implementation
  const EventMarketUpgradeable = await ethers.getContractFactory("EventMarketUpgradeable");
  const marketImpl = await EventMarketUpgradeable.deploy();
  await marketImpl.waitForDeployment();
  const marketImplAddress = await marketImpl.getAddress();
  console.log("EventMarketUpgradeable impl:", marketImplAddress);

  // 2. Beacon
  const UpgradeableBeacon = await ethers.getContractFactory("UpgradeableBeacon");
  const beacon = await UpgradeableBeacon.deploy(marketImplAddress, admin);
  await beacon.waitForDeployment();
  const beaconAddress = await beacon.getAddress();
  console.log("Market Beacon:", beaconAddress);

  // 3. EventFactory implementation
  const EventFactoryUpgradeable = await ethers.getContractFactory("EventFactoryUpgradeable");
  const factoryImpl = await EventFactoryUpgradeable.deploy();
  await factoryImpl.waitForDeployment();
  const factoryImplAddress = await factoryImpl.getAddress();
  console.log("EventFactoryUpgradeable impl:", factoryImplAddress);

  // 4. Factory proxy with initialize(collateral, admin, beacon)
  const ERC1967Proxy = await ethers.getContractFactory("ERC1967Proxy");
  const initData = EventFactoryUpgradeable.interface.encodeFunctionData("initialize", [
    collateral,
    admin,
    beaconAddress,
  ]);
  const proxy = await ERC1967Proxy.deploy(factoryImplAddress, initData);
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();
  console.log("EventFactory proxy (use this):", proxyAddress);

  const chainId = (await ethers.provider.getNetwork()).chainId;
  const out = {
    chainId: Number(chainId),
    collateral,
    eventMarketImplementation: marketImplAddress,
    marketBeacon: beaconAddress,
    eventFactoryImplementation: factoryImplAddress,
    eventFactoryProxy: proxyAddress,
  };

  const outPath = "deploy-addresses.sepolia.json";
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("Wrote", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
