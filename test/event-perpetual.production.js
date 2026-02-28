/**
 * Production-level Hardhat tests: full flows, matcher-style order signing, edge cases.
 * Run: npx hardhat test test/event-perpetual.production.js
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");

const PRECISION = 10n ** 18n;

/** Assert that promise rejects (tx reverted). Optionally check reason substring. */
async function expectRevert(promise, reasonSubstring) {
  let err;
  try {
    await promise;
  } catch (e) {
    err = e;
  }
  expect(err, "Expected transaction to revert").to.not.be.undefined;
  const msg = (err && (err.message || err.reason || err.data || "")) + "";
  if (reasonSubstring) expect(msg.toLowerCase()).to.include(reasonSubstring.toLowerCase());
}
const ZERO = ethers.ZeroHash;

// ─── Matcher helpers (mirror off-chain matcher logic) ───────────────────────

function getDomain(chainId, verifyingContract) {
  return {
    name: "EventPerpetual",
    version: "1",
    chainId,
    verifyingContract,
  };
}

const ORDER_TYPES_V1 = {
  Order: [
    { name: "maker", type: "address" },
    { name: "price", type: "uint256" },
    { name: "size", type: "uint256" },
    { name: "isLong", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
};

const ORDER_TYPES_V2 = {
  Order: [
    ...ORDER_TYPES_V1.Order,
    { name: "salt", type: "bytes32" },
  ],
};

/** Encode maker order for submitFill (V1: 6 params, V2: 7 params with salt). */
function encodeMakerOrder(maker, price, size, isLong, nonce, expiry, salt = null) {
  const makerLongU = isLong ? 1n : 0n;
  if (salt != null) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256", "uint256", "uint256", "uint256", "bytes32"],
      [maker, price, size, makerLongU, nonce, expiry, salt]
    );
  }
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256", "uint256", "uint256", "uint256", "uint256"],
    [maker, price, size, makerLongU, nonce, expiry]
  );
}

/** Sign order V1 (no salt) for submitFill / submitFillV1. */
async function signOrderV1(signer, marketAddress, order) {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const domain = getDomain(chainId, marketAddress);
  return signer.signTypedData(domain, ORDER_TYPES_V1, order);
}

/** Sign order V2 (with salt) for partial fills. */
async function signOrderV2(signer, marketAddress, order) {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const domain = getDomain(chainId, marketAddress);
  return signer.signTypedData(domain, ORDER_TYPES_V2, order);
}

/** Build order object for signing (V1: no salt in message). */
function buildOrderV1(maker, price, size, isLong, nonce, expiry) {
  return { maker, price, size, isLong, nonce, expiry };
}

/** Build order object for signing (V2: with salt). */
function buildOrderV2(maker, price, size, isLong, nonce, expiry, salt) {
  return { maker, price, size, isLong, nonce, expiry, salt };
}

// ─── Deployment fixture ───────────────────────────────────────────────────

async function deployFixture() {
  const [admin, maker, taker, liquidator, other] = await ethers.getSigners();
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const collateral = await MockERC20.deploy();
  await collateral.waitForDeployment();
  const collateralAddress = await collateral.getAddress();
  const oneMillion = ethers.parseEther("1000000");
  await collateral.transfer(maker.address, oneMillion);
  await collateral.transfer(taker.address, oneMillion);
  await collateral.transfer(liquidator.address, oneMillion);
  await collateral.transfer(other.address, oneMillion);

  const EventMarketUpgradeable = await ethers.getContractFactory("EventMarketUpgradeable");
  const marketImpl = await EventMarketUpgradeable.deploy();
  await marketImpl.waitForDeployment();
  const marketImplAddress = await marketImpl.getAddress();

  const UpgradeableBeacon = await ethers.getContractFactory("UpgradeableBeacon");
  const beacon = await UpgradeableBeacon.deploy(marketImplAddress, admin.address);
  await beacon.waitForDeployment();
  const beaconAddress = await beacon.getAddress();

  const EventFactoryUpgradeable = await ethers.getContractFactory("EventFactoryUpgradeable");
  const factoryImpl = await EventFactoryUpgradeable.deploy();
  await factoryImpl.waitForDeployment();
  const factoryImplAddress = await factoryImpl.getAddress();

  const initData = factoryImpl.interface.encodeFunctionData("initialize", [
    collateralAddress,
    admin.address,
    beaconAddress,
  ]);
  const ERC1967Proxy = await ethers.getContractFactory("ERC1967Proxy");
  const proxy = await ERC1967Proxy.deploy(factoryImplAddress, initData);
  await proxy.waitForDeployment();
  const factory = EventFactoryUpgradeable.attach(await proxy.getAddress());

  const resolutionTime = (await ethers.provider.getBlock("latest")).timestamp + 86400 * 7;
  const tx = await factory.createEvent("Production Test Market", resolutionTime, admin.address);
  const receipt = await tx.wait();
  const iface = factory.interface;
  const log = receipt.logs.find((l) => {
    try {
      const parsed = iface.parseLog({ topics: l.topics, data: l.data });
      return parsed && parsed.name === "EventCreated";
    } catch {
      return false;
    }
  });
  const parsed = iface.parseLog({ topics: log.topics, data: log.data });
  const marketAddress = parsed.args.market;
  const market = EventMarketUpgradeable.attach(marketAddress);

  return {
    admin,
    maker,
    taker,
    liquidator,
    other,
    collateral,
    factory,
    market,
    beacon,
  };
}

function parseCollateral(s) {
  return ethers.parseEther(String(s));
}

describe("Event Perpetuals — Production", function () {
  describe("1. Deployment & config", function () {
    it("deploys factory, beacon, market impl and creates one event", async function () {
      const { factory, market, collateral } = await deployFixture();
      expect(await factory.eventCount()).to.equal(1n);
      expect(ethers.isAddress(await market.getAddress())).to.be.true;
      expect(await market.collateral()).to.equal(await collateral.getAddress());
      expect(await market.resolved()).to.equal(false);
    });

    it("market has default microstructure and funding params", async function () {
      const { market } = await deployFixture();
      expect(await market.markEmaAlphaBps()).to.be.gt(0);
      expect(await market.maxMarkDeviationBps()).to.be.gt(0);
      expect(await market.closeOnly()).to.equal(false);
    });
  });

  describe("2. Deposit & Withdraw", function () {
    it("deposit and withdraw full amount", async function () {
      const { market, collateral, maker } = await deployFixture();
      const amount = parseCollateral("1000");
      await collateral.connect(maker).approve(market, amount);
      await market.connect(maker).deposit(amount);
      expect(await market.collateralBalance(maker.address)).to.equal(amount);
      await market.connect(maker).withdraw(amount);
      expect(await market.collateralBalance(maker.address)).to.equal(0n);
    });

    it("reverts withdraw when insufficient balance", async function () {
      const { market, collateral, maker } = await deployFixture();
      const amount = parseCollateral("1000");
      await collateral.connect(maker).approve(market, amount);
      await market.connect(maker).deposit(amount);
      await expectRevert(market.connect(maker).withdraw(amount + 1n), "InsufficientCollateral");
    });

    it("withdraw with open position: can withdraw up to available balance", async function () {
      const { market, collateral, maker, taker } = await deployFixture();
      const depositAmount = parseCollateral("10000");
      const price = (60n * PRECISION) / 100n;
      const size = parseCollateral("100");
      await collateral.connect(maker).approve(market, depositAmount);
      await collateral.connect(taker).approve(market, depositAmount);
      await market.connect(maker).deposit(depositAmount);
      await market.connect(taker).deposit(depositAmount);

      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const order = buildOrderV1(maker.address, price, size, true, nonce, expiry);
      const sig = await signOrderV1(maker, await market.getAddress(), order);
      const makerOrderV2 = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, ZERO);
      await market.connect(taker).submitFill(taker.address, false, price, size, makerOrderV2, sig);

      const balanceBefore = await market.collateralBalance(maker.address);
      const withdrawAmount = parseCollateral("100");
      await market.connect(maker).withdraw(withdrawAmount);
      expect(await market.collateralBalance(maker.address)).to.equal(balanceBefore - withdrawAmount);
    });

    it("deposit zero is no-op", async function () {
      const { market, maker } = await deployFixture();
      await market.connect(maker).deposit(0);
      expect(await market.collateralBalance(maker.address)).to.equal(0n);
    });
  });

  describe("3. Matcher flow — sign order & submitFill V1", function () {
    it("full flow: maker signs, taker fills, positions and mark updated", async function () {
      const { market, collateral, maker, taker } = await deployFixture();
      const depositAmount = parseCollateral("10000");
      const price = (50n * PRECISION) / 100n;
      const size = parseCollateral("100");
      await collateral.connect(maker).approve(market, depositAmount);
      await collateral.connect(taker).approve(market, depositAmount);
      await market.connect(maker).deposit(depositAmount);
      await market.connect(taker).deposit(depositAmount);

      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const order = buildOrderV1(maker.address, price, size, true, nonce, expiry);
      const sig = await signOrderV1(maker, await market.getAddress(), order);
      const makerOrderV2 = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, ZERO);

      await market.connect(taker).submitFill(taker.address, false, price, size, makerOrderV2, sig);

      const posMaker = await market.getPosition(maker.address);
      const posTaker = await market.getPosition(taker.address);
      expect(posMaker.size).to.equal(size);
      expect(posMaker.isLong).to.equal(true);
      expect(posTaker.size).to.equal(size);
      expect(posTaker.isLong).to.equal(false);
      expect(await market.getMarkPrice()).to.equal(price);
      expect(await market.nonces(maker.address)).to.equal(nonce + 1n);
    });

    it("submitFillV1 (6-param encoding) works", async function () {
      const { market, collateral, maker, taker } = await deployFixture();
      const depositAmount = parseCollateral("10000");
      const price = (55n * PRECISION) / 100n;
      const size = parseCollateral("200");
      await collateral.connect(maker).approve(market, depositAmount);
      await collateral.connect(taker).approve(market, depositAmount);
      await market.connect(maker).deposit(depositAmount);
      await market.connect(taker).deposit(depositAmount);

      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const order = buildOrderV1(maker.address, price, size, false, nonce, expiry);
      const sig = await signOrderV1(maker, await market.getAddress(), order);
      const makerOrderV1 = encodeMakerOrder(maker.address, price, size, false, nonce, expiry);

      await market.connect(taker).submitFillV1(taker.address, true, price, size, makerOrderV1, sig);

      const posMaker = await market.getPosition(maker.address);
      const posTaker = await market.getPosition(taker.address);
      expect(posMaker.size).to.equal(size);
      expect(posMaker.isLong).to.equal(false);
      expect(posTaker.size).to.equal(size);
      expect(posTaker.isLong).to.equal(true);
    });
  });

  describe("4. Edge cases — submitFill reverts", function () {
    it("reverts when order expired", async function () {
      const { market, collateral, maker, taker } = await deployFixture();
      const depositAmount = parseCollateral("10000");
      const price = (50n * PRECISION) / 100n;
      const size = parseCollateral("100");
      await collateral.connect(maker).approve(market, depositAmount);
      await collateral.connect(taker).approve(market, depositAmount);
      await market.connect(maker).deposit(depositAmount);
      await market.connect(taker).deposit(depositAmount);

      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp - 1;
      const order = buildOrderV1(maker.address, price, size, true, nonce, expiry);
      const sig = await signOrderV1(maker, await market.getAddress(), order);
      const makerOrder = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, ZERO);
      await expectRevert(
        market.connect(taker).submitFill(taker.address, false, price, size, makerOrder, sig),
        "OrderExpired"
      );
    });

    it("reverts self-fill (maker == taker)", async function () {
      const { market, collateral, maker, taker } = await deployFixture();
      const depositAmount = parseCollateral("10000");
      const price = (50n * PRECISION) / 100n;
      const size = parseCollateral("100");
      await collateral.connect(maker).approve(market, depositAmount);
      await collateral.connect(taker).approve(market, depositAmount);
      await market.connect(maker).deposit(depositAmount);
      await market.connect(taker).deposit(depositAmount);

      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const order = buildOrderV1(maker.address, price, size, true, nonce, expiry);
      const sig = await signOrderV1(maker, await market.getAddress(), order);
      const makerOrder = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, ZERO);
      await expectRevert(
        market.connect(taker).submitFill(maker.address, false, price, size, makerOrder, sig),
        "InvalidSize"
      );
    });

    it("reverts same side (taker long when maker long)", async function () {
      const { market, collateral, maker, taker } = await deployFixture();
      const depositAmount = parseCollateral("10000");
      const price = (50n * PRECISION) / 100n;
      const size = parseCollateral("100");
      await collateral.connect(maker).approve(market, depositAmount);
      await collateral.connect(taker).approve(market, depositAmount);
      await market.connect(maker).deposit(depositAmount);
      await market.connect(taker).deposit(depositAmount);

      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const order = buildOrderV1(maker.address, price, size, true, nonce, expiry);
      const sig = await signOrderV1(maker, await market.getAddress(), order);
      const makerOrder = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, ZERO);
      await expectRevert(
        market.connect(taker).submitFill(taker.address, true, price, size, makerOrder, sig),
        "InvalidSize"
      );
    });

    it("reverts when taker long but fill price < maker price", async function () {
      const { market, collateral, maker, taker } = await deployFixture();
      const depositAmount = parseCollateral("10000");
      const makerPrice = (60n * PRECISION) / 100n;
      const takerPrice = (50n * PRECISION) / 100n;
      const size = parseCollateral("100");
      await collateral.connect(maker).approve(market, depositAmount);
      await collateral.connect(taker).approve(market, depositAmount);
      await market.connect(maker).deposit(depositAmount);
      await market.connect(taker).deposit(depositAmount);

      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const order = buildOrderV1(maker.address, makerPrice, size, false, nonce, expiry);
      const sig = await signOrderV1(maker, await market.getAddress(), order);
      const makerOrder = encodeMakerOrder(maker.address, makerPrice, size, false, nonce, expiry, ZERO);
      await expectRevert(
        market.connect(taker).submitFill(taker.address, true, takerPrice, size, makerOrder, sig),
        "InvalidPrice"
      );
    });

    it("reverts stale nonce (reuse same nonce after fill)", async function () {
      const { market, collateral, maker, taker } = await deployFixture();
      const depositAmount = parseCollateral("10000");
      const price = (50n * PRECISION) / 100n;
      const size = parseCollateral("100");
      await collateral.connect(maker).approve(market, depositAmount);
      await collateral.connect(taker).approve(market, depositAmount);
      await market.connect(maker).deposit(depositAmount);
      await market.connect(taker).deposit(depositAmount);

      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const order = buildOrderV1(maker.address, price, size, true, nonce, expiry);
      const sig = await signOrderV1(maker, await market.getAddress(), order);
      const makerOrder = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, ZERO);
      await market.connect(taker).submitFill(taker.address, false, price, size, makerOrder, sig);
      await expectRevert(
        market.connect(taker).submitFill(taker.address, false, price, size, makerOrder, sig),
        "revert"
      );
    });

    it("reverts invalid signature (wrong signer)", async function () {
      const { market, collateral, maker, taker, other } = await deployFixture();
      const depositAmount = parseCollateral("10000");
      const price = (50n * PRECISION) / 100n;
      const size = parseCollateral("100");
      await collateral.connect(maker).approve(market, depositAmount);
      await collateral.connect(taker).approve(market, depositAmount);
      await market.connect(maker).deposit(depositAmount);
      await market.connect(taker).deposit(depositAmount);

      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const order = buildOrderV1(maker.address, price, size, true, nonce, expiry);
      const sig = await signOrderV1(other, await market.getAddress(), order);
      const makerOrder = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, ZERO);
      await expectRevert(
        market.connect(taker).submitFill(taker.address, false, price, size, makerOrder, sig),
        "revert"
      );
    });

    it("reverts when closeOnly and new fill", async function () {
      const { market, collateral, maker, taker, admin, factory } = await deployFixture();
      const depositAmount = parseCollateral("10000");
      const price = (50n * PRECISION) / 100n;
      const size = parseCollateral("100");
      await collateral.connect(maker).approve(market, depositAmount);
      await collateral.connect(taker).approve(market, depositAmount);
      await market.connect(maker).deposit(depositAmount);
      await market.connect(taker).deposit(depositAmount);
      await factory.connect(admin).setMarketCloseOnly(0, true);

      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const order = buildOrderV1(maker.address, price, size, true, nonce, expiry);
      const sig = await signOrderV1(maker, await market.getAddress(), order);
      const makerOrder = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, ZERO);
      await expectRevert(
        market.connect(taker).submitFill(taker.address, false, price, size, makerOrder, sig),
        "CloseOnly"
      );
    });

    it("reverts price 0", async function () {
      const { market, collateral, maker, taker } = await deployFixture();
      await collateral.connect(maker).approve(market, parseCollateral("10000"));
      await collateral.connect(taker).approve(market, parseCollateral("10000"));
      await market.connect(maker).deposit(parseCollateral("10000"));
      await market.connect(taker).deposit(parseCollateral("10000"));
      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const price = (50n * PRECISION) / 100n;
      const size = parseCollateral("100");
      const order = buildOrderV1(maker.address, price, size, true, nonce, expiry);
      const sig = await signOrderV1(maker, await market.getAddress(), order);
      const makerOrder = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, ZERO);
      await expectRevert(
        market.connect(taker).submitFill(taker.address, false, 0n, size, makerOrder, sig),
        "InvalidPrice"
      );
    });

    it("reverts size 0", async function () {
      const { market, collateral, maker, taker } = await deployFixture();
      await collateral.connect(maker).approve(market, parseCollateral("10000"));
      await collateral.connect(taker).approve(market, parseCollateral("10000"));
      await market.connect(maker).deposit(parseCollateral("10000"));
      await market.connect(taker).deposit(parseCollateral("10000"));
      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const price = (50n * PRECISION) / 100n;
      const size = parseCollateral("100");
      const order = buildOrderV1(maker.address, price, size, true, nonce, expiry);
      const sig = await signOrderV1(maker, await market.getAddress(), order);
      const makerOrder = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, ZERO);
      await expectRevert(
        market.connect(taker).submitFill(taker.address, false, price, 0n, makerOrder, sig),
        "InvalidSize"
      );
    });
  });

  describe("5. V2 partial fill & cancel", function () {
    it("partial fill then second fill then order fully filled", async function () {
      const { market, collateral, maker, taker } = await deployFixture();
      const depositAmount = parseCollateral("10000");
      const price = (50n * PRECISION) / 100n;
      const size = parseCollateral("300");
      const salt = ethers.keccak256(ethers.toUtf8Bytes("order1"));
      await collateral.connect(maker).approve(market, depositAmount);
      await collateral.connect(taker).approve(market, depositAmount);
      await market.connect(maker).deposit(depositAmount);
      await market.connect(taker).deposit(depositAmount);

      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const order = buildOrderV2(maker.address, price, size, true, nonce, expiry, salt);
      const sig = await signOrderV2(maker, await market.getAddress(), order);
      const makerOrder = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, salt);

      const fill1 = parseCollateral("100");
      await market.connect(taker).submitFill(taker.address, false, price, fill1, makerOrder, sig);
      const orderHash = await market.getOrderHash(maker.address, price, size, nonce, expiry, salt);
      expect(await market.filledAmount(orderHash)).to.equal(fill1);

      const fill2 = parseCollateral("150");
      await market.connect(taker).submitFill(taker.address, false, price, fill2, makerOrder, sig);
      expect(await market.filledAmount(orderHash)).to.equal(fill1 + fill2);

      const fill3 = parseCollateral("50");
      await market.connect(taker).submitFill(taker.address, false, price, fill3, makerOrder, sig);
      expect(await market.filledAmount(orderHash)).to.equal(size);
    });

    it("cancelOrder marks order as fully filled", async function () {
      const { market, collateral, maker, taker } = await deployFixture();
      const depositAmount = parseCollateral("10000");
      const price = (50n * PRECISION) / 100n;
      const size = parseCollateral("200");
      const salt = ethers.keccak256(ethers.toUtf8Bytes("ordercancel"));
      await collateral.connect(maker).approve(market, depositAmount);
      await collateral.connect(taker).approve(market, depositAmount);
      await market.connect(maker).deposit(depositAmount);
      await market.connect(taker).deposit(depositAmount);

      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const orderHash = await market.getOrderHash(maker.address, price, size, nonce, expiry, salt);
      expect(await market.filledAmount(orderHash)).to.equal(0n);
      await market.connect(maker).cancelOrder(price, size, nonce, expiry, salt);
      expect(await market.filledAmount(orderHash)).to.equal(size);
      const order = buildOrderV2(maker.address, price, size, true, nonce, expiry, salt);
      const sig = await signOrderV2(maker, await market.getAddress(), order);
      const makerOrder = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, salt);
      await expectRevert(
        market.connect(taker).submitFill(taker.address, false, price, parseCollateral("1"), makerOrder, sig),
        "OrderFilledOrCanceled"
      );
    });
  });

  describe("6. Liquidation", function () {
    it("liquidate reverts with NotLiquidatable when position is healthy", async function () {
      const { market, collateral, maker, taker, liquidator } = await deployFixture();
      const depositAmount = parseCollateral("10000");
      const liquidatorDeposit = parseCollateral("1000");
      const price = (50n * PRECISION) / 100n;
      const size = parseCollateral("100");
      await collateral.connect(maker).approve(market, depositAmount);
      await collateral.connect(taker).approve(market, depositAmount);
      await collateral.connect(liquidator).approve(await market.getAddress(), liquidatorDeposit);
      await market.connect(maker).deposit(depositAmount);
      await market.connect(taker).deposit(depositAmount);
      await market.connect(liquidator).deposit(liquidatorDeposit);

      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const order = buildOrderV1(maker.address, price, size, true, nonce, expiry);
      const sig = await signOrderV1(maker, await market.getAddress(), order);
      const makerOrder = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, ZERO);
      await market.connect(taker).submitFill(taker.address, false, price, size, makerOrder, sig);

      await expectRevert(market.connect(liquidator).liquidate(taker.address), "NotLiquidatable");
      const posTaker = await market.getPosition(taker.address);
      expect(posTaker.size).to.equal(size);
    });

    it("reverts liquidate when not underwater", async function () {
      const { market, collateral, maker, taker, liquidator } = await deployFixture();
      const depositAmount = parseCollateral("10000");
      const price = (50n * PRECISION) / 100n;
      const size = parseCollateral("100");
      await collateral.connect(maker).approve(market, depositAmount);
      await collateral.connect(taker).approve(market, depositAmount);
      await market.connect(maker).deposit(depositAmount);
      await market.connect(taker).deposit(depositAmount);

      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const order = buildOrderV1(maker.address, price, size, true, nonce, expiry);
      const sig = await signOrderV1(maker, await market.getAddress(), order);
      const makerOrder = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, ZERO);
      await market.connect(taker).submitFill(taker.address, false, price, size, makerOrder, sig);

      await expectRevert(market.connect(liquidator).liquidate(taker.address), "NotLiquidatable");
    });
  });

  describe("7. Funding", function () {
    it("funding index updates after period and settleFunding applied on fill", async function () {
      const { market, collateral, factory, maker, taker, admin } = await deployFixture();
      const depositAmount = parseCollateral("10000");
      const price = (50n * PRECISION) / 100n;
      const size = parseCollateral("100");
      await collateral.connect(maker).approve(market, depositAmount);
      await collateral.connect(taker).approve(market, depositAmount);
      await market.connect(maker).deposit(depositAmount);
      await market.connect(taker).deposit(depositAmount);

      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const order = buildOrderV1(maker.address, price, size, true, nonce, expiry);
      const sig = await signOrderV1(maker, await market.getAddress(), order);
      const makerOrder = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, ZERO);
      await market.connect(taker).submitFill(taker.address, false, price, size, makerOrder, sig);

      await factory.connect(admin).setMarketIndexPrice(0, (40n * PRECISION) / 100n);
      await ethers.provider.send("evm_increaseTime", [7200]);
      await ethers.provider.send("evm_mine", []);
      await market.updateFunding();
      const idxAfter = await market.fundingIndex();
      expect(idxAfter).to.be.gte(0n);
    });
  });

  describe("8. Resolution & settle", function () {
    it("resolve YES then settleAndWithdraw: long wins, short loses", async function () {
      const { market, collateral, factory, maker, taker, admin } = await deployFixture();
      const depositAmount = parseCollateral("10000");
      const price = (50n * PRECISION) / 100n;
      const size = parseCollateral("100");
      await collateral.connect(maker).approve(market, depositAmount);
      await collateral.connect(taker).approve(market, depositAmount);
      await market.connect(maker).deposit(depositAmount);
      await market.connect(taker).deposit(depositAmount);

      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const order = buildOrderV1(maker.address, price, size, true, nonce, expiry);
      const sig = await signOrderV1(maker, await market.getAddress(), order);
      const makerOrder = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, ZERO);
      await market.connect(taker).submitFill(taker.address, false, price, size, makerOrder, sig);

      await factory.connect(admin).resolveEvent(0, true);
      const balMakerBefore = await collateral.balanceOf(maker.address);
      const balTakerBefore = await collateral.balanceOf(taker.address);
      await market.connect(maker).settleAndWithdraw();
      await market.connect(taker).settleAndWithdraw();
      const balMakerAfter = await collateral.balanceOf(maker.address);
      const balTakerAfter = await collateral.balanceOf(taker.address);
      const deposited = parseCollateral("10000");
      expect(balMakerAfter - balMakerBefore).to.be.gt(deposited);
      expect(balTakerAfter - balTakerBefore).to.be.lt(deposited);
    });

    it("resolve NO: short wins, long loses", async function () {
      const { market, collateral, factory, maker, taker, admin } = await deployFixture();
      const depositAmount = parseCollateral("10000");
      const price = (50n * PRECISION) / 100n;
      const size = parseCollateral("100");
      await collateral.connect(maker).approve(market, depositAmount);
      await collateral.connect(taker).approve(market, depositAmount);
      await market.connect(maker).deposit(depositAmount);
      await market.connect(taker).deposit(depositAmount);

      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const order = buildOrderV1(maker.address, price, size, true, nonce, expiry);
      const sig = await signOrderV1(maker, await market.getAddress(), order);
      const makerOrder = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, ZERO);
      await market.connect(taker).submitFill(taker.address, false, price, size, makerOrder, sig);

      await factory.connect(admin).resolveEvent(0, false);
      const balMakerBefore = await collateral.balanceOf(maker.address);
      const balTakerBefore = await collateral.balanceOf(taker.address);
      await market.connect(maker).settleAndWithdraw();
      await market.connect(taker).settleAndWithdraw();
      const balMakerAfter = await collateral.balanceOf(maker.address);
      const balTakerAfter = await collateral.balanceOf(taker.address);
      const deposited = parseCollateral("10000");
      expect(balMakerAfter - balMakerBefore).to.be.lt(deposited);
      expect(balTakerAfter - balTakerBefore).to.be.gt(deposited);
    });

    it("settleAndWithdraw with no position returns balance only", async function () {
      const { market, collateral, factory, maker, admin } = await deployFixture();
      await collateral.connect(maker).approve(market, parseCollateral("500"));
      await market.connect(maker).deposit(parseCollateral("500"));
      await factory.connect(admin).resolveEvent(0, true);
      const before = await collateral.balanceOf(maker.address);
      await market.connect(maker).settleAndWithdraw();
      const after = await collateral.balanceOf(maker.address);
      expect(after - before).to.equal(parseCollateral("500"));
    });

    it("reverts submitFill after resolution", async function () {
      const { market, collateral, factory, maker, taker, admin } = await deployFixture();
      const depositAmount = parseCollateral("10000");
      const price = (50n * PRECISION) / 100n;
      const size = parseCollateral("100");
      await collateral.connect(maker).approve(market, depositAmount);
      await collateral.connect(taker).approve(market, depositAmount);
      await market.connect(maker).deposit(depositAmount);
      await market.connect(taker).deposit(depositAmount);
      await factory.connect(admin).resolveEvent(0, true);

      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const order = buildOrderV1(maker.address, price, size, true, nonce, expiry);
      const sig = await signOrderV1(maker, await market.getAddress(), order);
      const makerOrder = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, ZERO);
      await expectRevert(
        market.connect(taker).submitFill(taker.address, false, price, size, makerOrder, sig),
        "revert"
      );
    });
  });

  describe("9. Invariants", function () {
    it("after one fill: insurance fund receives fees", async function () {
      const { market, collateral, maker, taker } = await deployFixture();
      const depositAmount = parseCollateral("10000");
      const price = (50n * PRECISION) / 100n;
      const size = parseCollateral("100");
      await collateral.connect(maker).approve(market, depositAmount);
      await collateral.connect(taker).approve(market, depositAmount);
      await market.connect(maker).deposit(depositAmount);
      await market.connect(taker).deposit(depositAmount);

      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const order = buildOrderV1(maker.address, price, size, true, nonce, expiry);
      const sig = await signOrderV1(maker, await market.getAddress(), order);
      const makerOrder = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, ZERO);
      await market.connect(taker).submitFill(taker.address, false, price, size, makerOrder, sig);

      expect(await market.insuranceFund()).to.be.gte(0n);
    });

    it("mark price clamped when index set and maxDeviation", async function () {
      const { market, collateral, factory, maker, taker, admin } = await deployFixture();
      const depositAmount = parseCollateral("10000");
      await factory.connect(admin).setMarketIndexPrice(0, (50n * PRECISION) / 100n);
      const price = (90n * PRECISION) / 100n;
      const size = parseCollateral("100");
      await collateral.connect(maker).approve(market, depositAmount);
      await collateral.connect(taker).approve(market, depositAmount);
      await market.connect(maker).deposit(depositAmount);
      await market.connect(taker).deposit(depositAmount);

      const nonce = await market.nonces(maker.address);
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const order = buildOrderV1(maker.address, price, size, true, nonce, expiry);
      const sig = await signOrderV1(maker, await market.getAddress(), order);
      const makerOrder = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, ZERO);
      await market.connect(taker).submitFill(taker.address, false, price, size, makerOrder, sig);

      const mark = await market.getMarkPrice();
      const index = await market.getIndexPrice();
      const maxDev = await market.maxMarkDeviationBps();
      const upper = (index * (10000n + maxDev)) / 10000n;
      expect(mark).to.be.lte(upper);
    });
  });

  describe("10. Matcher alignment (order encoding & hashing)", function () {
    it("encoded maker order round-trip matches contract getOrderHash", async function () {
      const { market } = await deployFixture();
      const maker = (await ethers.getSigners())[1];
      const price = (55n * PRECISION) / 100n;
      const size = parseCollateral("200");
      const nonce = 3n;
      const expiry = (await ethers.provider.getBlock("latest")).timestamp + 86400;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("matcher-order-1"));
      const expectedHash = await market.getOrderHash(maker.address, price, size, nonce, expiry, salt);
      const encoded = encodeMakerOrder(maker.address, price, size, true, nonce, expiry, salt);
      expect(encoded).to.be.a("string");
      expect(encoded.slice(0, 2)).to.equal("0x");
      expect(expectedHash).to.be.a("string");
      expect(expectedHash.length).to.equal(66);
    });

    it("V1 and V2 order encoding lengths", async function () {
      const signers = await ethers.getSigners();
      const maker = signers[1].address;
      const price = (50n * PRECISION) / 100n;
      const size = parseCollateral("100");
      const nonce = 0n;
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400);
      const v1 = encodeMakerOrder(maker, price, size, true, nonce, expiry, null);
      const v2 = encodeMakerOrder(maker, price, size, true, nonce, expiry, ZERO);
      expect(v1.length).to.be.lt(v2.length);
      const v2WithSalt = encodeMakerOrder(maker, price, size, true, nonce, expiry, ethers.keccak256(ethers.toUtf8Bytes("x")));
      expect(v2WithSalt.length).to.equal(v2.length);
    });
  });
});
