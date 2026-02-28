/**
 * Integration test: two-wallet flow on a local or testnet node.
 * Requires: deploy-addresses.sepolia.json (or deploy-addresses.<network>.json),
 * and at least two accounts with collateral and gas.
 *
 * Usage: npx hardhat run scripts/integration-two-wallet.js [--network sepolia]
 */
const hre = require("hardhat");
const fs = require("fs");

const PRECISION = BigInt(1e18);

function loadAddresses() {
  const path = "deploy-addresses.sepolia.json";
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}. Deploy first.`);
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

async function main() {
  const { ethers } = hre;
  const addrs = loadAddresses();
  const signers = await ethers.getSigners();
  if (signers.length < 2) throw new Error("Need at least 2 signers");
  const admin = signers[0];
  const maker = signers[0];
  const taker = signers[1];

  const factory = await ethers.getContractAt("EventFactoryUpgradeable", addrs.eventFactoryProxy);
  const erc20Abi = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function decimals() view returns (uint8)",
  ];
  const collateral = new ethers.Contract(addrs.collateral, erc20Abi, admin);

  console.log("Admin:", admin.address);
  console.log("Maker:", maker.address);
  console.log("Taker:", taker.address);

  const eventId = 0;
  let marketAddress = null;
  try {
    const info = await factory.getEvent(eventId);
    marketAddress = info.market;
  } catch (e) {
    // create event if none
    const tx = await factory.createEvent(
      "E2E Test Market",
      Math.floor(Date.now() / 1000) + 86400 * 7,
      admin.address
    );
    const rc = await tx.wait();
    const created = rc?.logs?.find((l) => l.fragment?.name === "EventCreated");
    if (created) {
      marketAddress = created.args?.market ?? (await factory.getEvent(0)).market;
    } else {
      marketAddress = (await factory.getEvent(0)).market;
    }
    console.log("Created event, market:", marketAddress);
  }

  if (!marketAddress || marketAddress === ethers.ZeroAddress) {
    throw new Error("No market found");
  }

  const market = await ethers.getContractAt("EventMarketUpgradeable", marketAddress);
  const decimals = await collateral.decimals?.().catch(() => 18) ?? 18;
  const amount = ethers.parseUnits("1000", decimals);
  const price = (50n * PRECISION) / 100n;
  const size = ethers.parseUnits("100", decimals);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400 * 7);

  for (const who of [maker, taker]) {
    const allowance = await collateral.allowance(who.address, marketAddress);
    if (allowance < amount) {
      const approveTx = await collateral.connect(who).approve(marketAddress, amount);
      await approveTx.wait();
      console.log("Approved for", who.address);
    }
    const depTx = await market.connect(who).deposit(amount);
    await depTx.wait();
    console.log("Deposited for", who.address);
  }

  const nonce = await market.nonces(maker.address);
  const domain = {
    name: "EventPerpetual",
    version: "1",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: marketAddress,
  };
  const types = {
    Order: [
      { name: "maker", type: "address" },
      { name: "price", type: "uint256" },
      { name: "size", type: "uint256" },
      { name: "isLong", type: "bool" },
      { name: "nonce", type: "uint256" },
      { name: "expiry", type: "uint256" },
    ],
  };
  const order = {
    maker: maker.address,
    price,
    size,
    isLong: true,
    nonce,
    expiry,
  };
  const signature = await maker.signTypedData(domain, types, order);
  const makerOrderV1 = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256", "uint256", "uint256", "uint256", "uint256"],
    [maker.address, price, size, 1n, nonce, expiry]
  );
  const makerOrderV2 = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256", "uint256", "uint256", "uint256", "uint256", "bytes32"],
    [maker.address, price, size, 1n, nonce, expiry, ethers.ZeroHash]
  );

  const fillTx = await market.connect(taker).submitFill(
    taker.address,
    false,
    price,
    size,
    makerOrderV2,
    signature
  );
  await fillTx.wait();
  console.log("Submit fill tx confirmed");

  const posMaker = await market.getPosition(maker.address);
  const posTaker = await market.getPosition(taker.address);
  console.log("Maker position size:", posMaker.size.toString(), "long:", posMaker.isLong);
  console.log("Taker position size:", posTaker.size.toString(), "long:", posTaker.isLong);
  console.log("Mark price:", (await market.getMarkPrice()).toString());
  console.log("Integration two-wallet flow OK.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
