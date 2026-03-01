/**
 * Deploy binary (Polymarket-style) contracts: upgradeable factory + beacon for markets.
 * Writes deploy-addresses-binary.json with proxy and implementation addresses.
 *
 * npx hardhat run scripts/deploy-binary.js --network sepolia
 */
const hre = require("hardhat");
const fs = require("fs");

const COLLATERAL_DEFAULT = "0x799a5570318c0C5Fcfd09b0f573335B5aa8d85Ff";

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  const collateral = process.env.COLLATERAL || process.env.COLLATERAL_TOKEN_ADDRESS || COLLATERAL_DEFAULT;
  const admin = process.env.ADMIN || deployer.address;

  console.log("Deploying Binary (Polymarket-style, upgradeable) with:", {
    collateral,
    admin,
    deployer: deployer.address,
  });

  // 1. BinaryMarket implementation
  const BinaryMarket = await ethers.getContractFactory("BinaryMarket");
  const marketImpl = await BinaryMarket.deploy();
  await marketImpl.waitForDeployment();
  const marketImplAddress = await marketImpl.getAddress();
  console.log("BinaryMarket implementation:", marketImplAddress);

  // 2. Beacon (owner = admin)
  const UpgradeableBeacon = await ethers.getContractFactory("UpgradeableBeacon");
  const beacon = await UpgradeableBeacon.deploy(marketImplAddress, admin);
  await beacon.waitForDeployment();
  const beaconAddress = await beacon.getAddress();
  console.log("Market Beacon:", beaconAddress);

  // 3. BinaryMarketFactory implementation
  const BinaryMarketFactory = await ethers.getContractFactory("BinaryMarketFactory");
  const factoryImpl = await BinaryMarketFactory.deploy();
  await factoryImpl.waitForDeployment();
  const factoryImplAddress = await factoryImpl.getAddress();
  console.log("BinaryMarketFactory implementation:", factoryImplAddress);

  // 4. Factory proxy: initialize(admin, beacon)
  const ERC1967Proxy = await ethers.getContractFactory("ERC1967Proxy");
  const initData = BinaryMarketFactory.interface.encodeFunctionData("initialize", [admin, beaconAddress]);
  const proxy = await ERC1967Proxy.deploy(factoryImplAddress, initData);
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();
  console.log("BinaryMarketFactory proxy (use this):", proxyAddress);

  // 5. Create first market
  const factory = await ethers.getContractAt("BinaryMarketFactory", proxyAddress);
  const resolutionTime = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const tx = await factory.createMarket(collateral, "will-india-win", resolutionTime);
  const receipt = await tx.wait();
  const created = receipt.logs.find((l) => l.fragment?.name === "MarketCreated");
  const marketId = created ? created.args[0] : 0n;
  const marketAddress = await factory.markets(marketId);
  console.log("Created market id 0:", marketAddress);

  const chainId = (await ethers.provider.getNetwork()).chainId;
  const out = {
    chainId: Number(chainId),
    collateral,
    binaryMarketImplementation: marketImplAddress,
    marketBeacon: beaconAddress,
    binaryMarketFactoryImplementation: factoryImplAddress,
    binaryMarketFactoryProxy: proxyAddress,
    binaryMarketFactory: proxyAddress, // alias for frontend
    markets: { 0: marketAddress },
  };

  const outPath = "deploy-addresses-binary.json";
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("Wrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
