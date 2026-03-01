const hre = require("hardhat");
const fs = require("fs");

const COLLATERAL_DEFAULT = "0x799a5570318c0C5Fcfd09b0f573335B5aa8d85Ff";

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  const collateral = process.env.COLLATERAL || process.env.COLLATERAL_TOKEN_ADDRESS || COLLATERAL_DEFAULT;
  const admin = process.env.ADMIN || deployer.address;

  console.log("Deploying Binary (Polymarket-style) with:", { collateral, admin, deployer: deployer.address });

  const BinaryMarketFactory = await ethers.getContractFactory("BinaryMarketFactory");
  const factory = await BinaryMarketFactory.deploy(admin);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("BinaryMarketFactory:", factoryAddress);

  const resolutionTime = Math.floor(Date.now() / 1000) + 365 * 24 * 3600; // 1 year
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
    binaryMarketFactory: factoryAddress,
    markets: { 0: marketAddress },
  };

  const outPath = "deploy-addresses-binary.json";
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("Wrote", outPath);
}

main().catch((e) => { console.error(e); process.exit(1); });
