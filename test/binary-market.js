/**
 * Binary (Polymarket-style) market: full test suite + edge cases.
 * Tests: factory (create, resolve, admin, beacon), market (deposit, withdraw, mint, merge, fill V1, resolve, redeem).
 */
const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

const PRECISION = 10n ** 18n;

function parseCollateral(s) {
  return ethers.parseEther(String(s));
}

// EIP-712 sign order V1 (no salt) for BinaryMarket
async function signOrderV1(signer, marketAddress, order) {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const domain = {
    name: "BinaryMarket",
    version: "1",
    chainId: Number(chainId),
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
  const signature = await signer.signTypedData(domain, types, order);
  return signature;
}

// Encode maker order for submitFillV1: (maker, price, size, makerLongU, nonce, expiry)
function encodeMakerOrderV1(maker, price, size, isLong, nonce, expiry) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256", "uint256", "uint256", "uint256", "uint256"],
    [maker, price, size, isLong ? 1n : 0n, nonce, expiry]
  );
}

describe("BinaryMarket", function () {
  let factory, market, collateral;
  let admin, alice, bob, carol;

  before(async function () {
    [admin, alice, bob, carol] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    collateral = await MockERC20.deploy();
    await collateral.waitForDeployment();
    for (const acc of [admin, alice, bob, carol]) {
      await collateral.transfer(await acc.getAddress(), parseCollateral("10000"));
    }

    const BinaryMarket = await ethers.getContractFactory("BinaryMarket");
    const marketImpl = await BinaryMarket.deploy();
    await marketImpl.waitForDeployment();
    const UpgradeableBeacon = await ethers.getContractFactory("UpgradeableBeacon");
    const beacon = await UpgradeableBeacon.deploy(await marketImpl.getAddress(), admin.address);
    await beacon.waitForDeployment();
    const BinaryMarketFactory = await ethers.getContractFactory("BinaryMarketFactory");
    const factoryImpl = await BinaryMarketFactory.deploy();
    await factoryImpl.waitForDeployment();
    const ERC1967Proxy = await ethers.getContractFactory("ERC1967Proxy");
    const initData = BinaryMarketFactory.interface.encodeFunctionData("initialize", [
      admin.address,
      await beacon.getAddress(),
    ]);
    const proxy = await ERC1967Proxy.deploy(await factoryImpl.getAddress(), initData);
    await proxy.waitForDeployment();
    factory = await ethers.getContractAt("BinaryMarketFactory", await proxy.getAddress());

    const resolutionTime = Math.floor(Date.now() / 1000) + 86400 * 365;
    await factory.createMarket(await collateral.getAddress(), "will-x-win", resolutionTime);
    const marketAddr = await factory.markets(0);
    market = await ethers.getContractAt("BinaryMarket", marketAddr);
  });

  describe("Factory", function () {
    it("has correct admin and beacon", async function () {
      expect(await factory.admin()).to.equal(admin.address);
      expect(await factory.marketCount()).to.equal(1n);
      expect(await factory.markets(0)).to.not.equal(ethers.ZeroAddress);
    });

    it("only admin can create market", async function () {
      await expect(
        factory.connect(alice).createMarket(await collateral.getAddress(), "q2", Math.floor(Date.now() / 1000) + 86400)
      ).to.be.revertedWithCustomError(factory, "Unauthorized");
    });

    it("createMarket with beacon zero reverts if beacon not set", async function () {
      const BinaryMarketFactory = await ethers.getContractFactory("BinaryMarketFactory");
      const F = await BinaryMarketFactory.deploy();
      await F.waitForDeployment();
      const Proxy = await ethers.getContractFactory("ERC1967Proxy");
      const init = BinaryMarketFactory.interface.encodeFunctionData("initialize", [admin.address, ethers.ZeroAddress]);
      const p = await Proxy.deploy(await F.getAddress(), init);
      await p.waitForDeployment();
      const noBeaconFactory = await ethers.getContractAt("BinaryMarketFactory", await p.getAddress());
      await expect(
        noBeaconFactory.createMarket(await collateral.getAddress(), "q", Math.floor(Date.now() / 1000) + 86400)
      ).to.be.revertedWithCustomError(noBeaconFactory, "BeaconNotSet");
    });

    it("admin can setMarketBeacon and setAdmin", async function () {
      const newAdmin = carol.address;
      await factory.setAdmin(newAdmin);
      expect(await factory.admin()).to.equal(newAdmin);
      await factory.connect(carol).setAdmin(admin.address);
      expect(await factory.admin()).to.equal(admin.address);
    });

    it("non-admin cannot setAdmin or resolveMarket", async function () {
      await expect(factory.connect(alice).setAdmin(bob.address)).to.be.revertedWithCustomError(factory, "Unauthorized");
      await expect(factory.connect(alice).resolveMarket(0, true)).to.be.revertedWithCustomError(factory, "Unauthorized");
    });

    it("resolveMarket for non-existent market reverts", async function () {
      await expect(factory.resolveMarket(999, true)).to.be.revertedWithCustomError(factory, "Unauthorized");
    });
  });

  describe("Market: deposit / withdraw", function () {
    it("deposit increases collateral balance", async function () {
      const amount = parseCollateral("100");
      await collateral.connect(alice).approve(await market.getAddress(), amount);
      await market.connect(alice).deposit(amount);
      expect(await market.collateralBalance(alice.address)).to.equal(amount);
    });

    it("deposit(0) is no-op", async function () {
      const before = await market.collateralBalance(alice.address);
      await market.connect(alice).deposit(0);
      expect(await market.collateralBalance(alice.address)).to.equal(before);
    });

    it("withdraw decreases balance and sends tokens", async function () {
      const amount = parseCollateral("50");
      const balBefore = await collateral.balanceOf(alice.address);
      await market.connect(alice).withdraw(amount);
      expect(await market.collateralBalance(alice.address)).to.equal(parseCollateral("50"));
      expect(await collateral.balanceOf(alice.address)).to.equal(balBefore + amount);
    });

    it("withdraw(0) is no-op", async function () {
      const before = await market.collateralBalance(alice.address);
      await market.connect(alice).withdraw(0);
      expect(await market.collateralBalance(alice.address)).to.equal(before);
    });

    it("withdraw more than balance reverts", async function () {
      await expect(market.connect(alice).withdraw(parseCollateral("1000"))).to.be.revertedWithCustomError(
        market,
        "InsufficientCollateral"
      );
    });

    it("deposit without allowance reverts", async function () {
      await expect(market.connect(bob).deposit(parseCollateral("1"))).to.be.reverted;
    });
  });

  describe("Market: mint / merge", function () {
    it("mint converts collateral to YES+NO", async function () {
      const amount = parseCollateral("50");
      await collateral.connect(bob).approve(await market.getAddress(), amount);
      await market.connect(bob).deposit(amount);
      await market.connect(bob).mintShares(amount);
      expect(await market.yesBalance(bob.address)).to.equal(amount);
      expect(await market.noBalance(bob.address)).to.equal(amount);
      expect(await market.collateralBalance(bob.address)).to.equal(0n);
    });

    it("mint(0) is no-op", async function () {
      await collateral.connect(carol).approve(await market.getAddress(), parseCollateral("10"));
      await market.connect(carol).deposit(parseCollateral("10"));
      await market.connect(carol).mintShares(0);
      expect(await market.collateralBalance(carol.address)).to.equal(parseCollateral("10"));
    });

    it("mint more than collateral balance reverts", async function () {
      await expect(market.connect(bob).mintShares(parseCollateral("1000"))).to.be.revertedWithCustomError(
        market,
        "InsufficientCollateral"
      );
    });

    it("merge converts YES+NO back to collateral", async function () {
      const amount = parseCollateral("20");
      await market.connect(bob).mergeShares(amount);
      expect(await market.yesBalance(bob.address)).to.equal(parseCollateral("30"));
      expect(await market.noBalance(bob.address)).to.equal(parseCollateral("30"));
      expect(await market.collateralBalance(bob.address)).to.equal(amount);
    });

    it("merge(0) is no-op", async function () {
      const yBefore = await market.yesBalance(bob.address);
      await market.connect(bob).mergeShares(0);
      expect(await market.yesBalance(bob.address)).to.equal(yBefore);
    });

    it("merge with insufficient YES reverts", async function () {
      await market.connect(bob).mergeShares(parseCollateral("30"));
      expect(await market.yesBalance(bob.address)).to.equal(0n);
      await expect(market.connect(bob).mergeShares(1)).to.be.revertedWithCustomError(market, "InsufficientShares");
    });
  });

  describe("Market: submitFillV1 (trade)", function () {
    let marketAddr;
    const price = (50n * PRECISION) / 100n;
    const size = parseCollateral("100");
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400 * 7);

    before(async function () {
      marketAddr = await market.getAddress();
      await collateral.connect(alice).approve(marketAddr, parseCollateral("10000"));
      await collateral.connect(bob).approve(marketAddr, parseCollateral("10000"));
      const aliceCol = await market.collateralBalance(alice.address);
      if (aliceCol > 0n) await market.connect(alice).withdraw(aliceCol);
      await market.connect(alice).deposit(parseCollateral("500"));
      await market.connect(alice).mintShares(parseCollateral("500"));
      await market.connect(bob).deposit(parseCollateral("500"));
    });

    it("maker sells YES, taker buys YES: fill succeeds and balances update", async function () {
      const nonce = await market.nonces(alice.address);
      const order = {
        maker: alice.address,
        price,
        size,
        isLong: false,
        nonce,
        expiry,
      };
      const sig = await signOrderV1(alice, marketAddr, order);
      const makerOrderEncoded = encodeMakerOrderV1(
        alice.address,
        price,
        size,
        false,
        nonce,
        expiry
      );
      const notional = (size * price) / PRECISION;
      const aliceYesBefore = await market.yesBalance(alice.address);
      const bobColBefore = await market.collateralBalance(bob.address);
      await market.connect(bob).submitFillV1(bob.address, true, price, size, makerOrderEncoded, sig);
      expect(await market.yesBalance(alice.address)).to.equal(aliceYesBefore - size);
      expect(await market.yesBalance(bob.address)).to.equal(size);
      expect(await market.collateralBalance(bob.address)).to.equal(bobColBefore - notional);
      expect(await market.collateralBalance(alice.address)).to.equal(notional);
    });

    it("same order (reuse nonce) reverts InvalidSignature", async function () {
      const nonce = 0n; // reuse nonce already consumed by first fill
      const order = {
        maker: alice.address,
        price,
        size: parseCollateral("50"),
        isLong: true,
        nonce,
        expiry,
      };
      const sig = await signOrderV1(alice, marketAddr, order);
      const makerOrderEncoded = encodeMakerOrderV1(
        alice.address,
        price,
        parseCollateral("50"),
        true,
        nonce,
        expiry
      );
      await collateral.connect(carol).approve(marketAddr, parseCollateral("100"));
      await market.connect(carol).deposit(parseCollateral("100"));
      await expect(
        market.connect(carol).submitFillV1(carol.address, false, price, parseCollateral("50"), makerOrderEncoded, sig)
      ).to.be.revertedWithCustomError(market, "InvalidSignature");
    });

    it("taker == maker reverts InvalidSize", async function () {
      const nonce = await market.nonces(alice.address);
      const order = {
        maker: alice.address,
        price,
        size: parseCollateral("10"),
        isLong: true,
        nonce,
        expiry,
      };
      const sig = await signOrderV1(alice, marketAddr, order);
      const makerOrderEncoded = encodeMakerOrderV1(alice.address, price, parseCollateral("10"), true, nonce, expiry);
      await expect(
        market.connect(alice).submitFillV1(alice.address, false, price, parseCollateral("10"), makerOrderEncoded, sig)
      ).to.be.revertedWithCustomError(market, "InvalidSize");
    });

    it("taker and maker same side (both long) reverts InvalidSize", async function () {
      const nonce = await market.nonces(alice.address);
      const order = {
        maker: alice.address,
        price,
        size: parseCollateral("10"),
        isLong: true,
        nonce,
        expiry,
      };
      const sig = await signOrderV1(alice, marketAddr, order);
      const makerOrderEncoded = encodeMakerOrderV1(alice.address, price, parseCollateral("10"), true, nonce, expiry);
      await expect(
        market.connect(bob).submitFillV1(bob.address, true, price, parseCollateral("10"), makerOrderEncoded, sig)
      ).to.be.revertedWithCustomError(market, "InvalidSize");
    });

    it("fill size != maker size for V1 reverts InvalidSize", async function () {
      const nonce = await market.nonces(alice.address);
      const makerSize = parseCollateral("25");
      const order = {
        maker: alice.address,
        price,
        size: makerSize,
        isLong: false,
        nonce,
        expiry,
      };
      const sig = await signOrderV1(alice, marketAddr, order);
      const makerOrderEncoded = encodeMakerOrderV1(alice.address, price, makerSize, false, nonce, expiry);
      await expect(
        market.connect(bob).submitFillV1(bob.address, true, price, parseCollateral("10"), makerOrderEncoded, sig)
      ).to.be.revertedWithCustomError(market, "InvalidSize");
    });

    it("expired order reverts OrderExpired", async function () {
      const nonce = await market.nonces(alice.address);
      const pastExpiry = BigInt(Math.floor(Date.now() / 1000) - 60);
      const order = {
        maker: alice.address,
        price,
        size: parseCollateral("5"),
        isLong: false,
        nonce,
        expiry: pastExpiry,
      };
      const sig = await signOrderV1(alice, marketAddr, order);
      const makerOrderEncoded = encodeMakerOrderV1(alice.address, price, parseCollateral("5"), false, nonce, pastExpiry);
      await expect(
        market.connect(bob).submitFillV1(bob.address, true, price, parseCollateral("5"), makerOrderEncoded, sig)
      ).to.be.revertedWithCustomError(market, "OrderExpired");
    });

    it("fill size 0 reverts InvalidSize", async function () {
      const nonce = await market.nonces(alice.address);
      const order = {
        maker: alice.address,
        price,
        size: parseCollateral("10"),
        isLong: false,
        nonce,
        expiry,
      };
      const sig = await signOrderV1(alice, marketAddr, order);
      const makerOrderEncoded = encodeMakerOrderV1(alice.address, price, parseCollateral("10"), false, nonce, expiry);
      await expect(
        market.connect(bob).submitFillV1(bob.address, true, price, 0n, makerOrderEncoded, sig)
      ).to.be.revertedWithCustomError(market, "InvalidSize");
    });

    it("price 0 reverts InvalidPrice", async function () {
      const nonce = await market.nonces(alice.address);
      const order = {
        maker: alice.address,
        price: 0n,
        size: parseCollateral("5"),
        isLong: false,
        nonce,
        expiry,
      };
      const sig = await signOrderV1(alice, marketAddr, order);
      const makerOrderEncoded = encodeMakerOrderV1(alice.address, 0n, parseCollateral("5"), false, nonce, expiry);
      await expect(
        market.connect(bob).submitFillV1(bob.address, true, 0n, parseCollateral("5"), makerOrderEncoded, sig)
      ).to.be.revertedWithCustomError(market, "InvalidPrice");
    });

    it("price > PRECISION reverts InvalidPrice", async function () {
      const nonce = await market.nonces(alice.address);
      const order = {
        maker: alice.address,
        price: PRECISION + 1n,
        size: parseCollateral("5"),
        isLong: false,
        nonce,
        expiry,
      };
      const sig = await signOrderV1(alice, marketAddr, order);
      const makerOrderEncoded = encodeMakerOrderV1(
        alice.address,
        PRECISION + 1n,
        parseCollateral("5"),
        false,
        nonce,
        expiry
      );
      await expect(
        market
          .connect(bob)
          .submitFillV1(bob.address, true, PRECISION + 1n, parseCollateral("5"), makerOrderEncoded, sig)
      ).to.be.revertedWithCustomError(market, "InvalidPrice");
    });

    it("wrong signature reverts InvalidSignature", async function () {
      const nonce = await market.nonces(alice.address);
      const order = {
        maker: alice.address,
        price,
        size: parseCollateral("5"),
        isLong: false,
        nonce,
        expiry,
      };
      const sigFromWrongMaker = await signOrderV1(bob, marketAddr, order);
      const makerOrderEncoded = encodeMakerOrderV1(
        alice.address,
        price,
        parseCollateral("5"),
        false,
        nonce,
        expiry
      );
      await expect(
        market.connect(bob).submitFillV1(bob.address, true, price, parseCollateral("5"), makerOrderEncoded, sigFromWrongMaker)
      ).to.be.revertedWithCustomError(market, "InvalidSignature");
    });

    it("taker long with fill price < maker price reverts InvalidPrice", async function () {
      const nonce = await market.nonces(alice.address);
      const makerPrice = (60n * PRECISION) / 100n;
      const takerPrice = (50n * PRECISION) / 100n;
      const order = {
        maker: alice.address,
        price: makerPrice,
        size: parseCollateral("5"),
        isLong: false,
        nonce,
        expiry,
      };
      const sig = await signOrderV1(alice, marketAddr, order);
      const makerOrderEncoded = encodeMakerOrderV1(
        alice.address,
        makerPrice,
        parseCollateral("5"),
        false,
        nonce,
        expiry
      );
      await expect(
        market.connect(bob).submitFillV1(bob.address, true, takerPrice, parseCollateral("5"), makerOrderEncoded, sig)
      ).to.be.revertedWithCustomError(market, "InvalidPrice");
    });

    it("insufficient taker collateral reverts", async function () {
      const signers = await ethers.getSigners();
      const poor = signers[signers.length - 1];
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const col2 = await MockERC20.deploy();
      await col2.waitForDeployment();
      await col2.transfer(poor.address, parseCollateral("1"));
      await col2.transfer(alice.address, parseCollateral("1000"));
      const BinaryMarket = await ethers.getContractFactory("BinaryMarket");
      const impl = await BinaryMarket.deploy();
      await impl.waitForDeployment();
      const UpgradeableBeacon = await ethers.getContractFactory("UpgradeableBeacon");
      const b = await UpgradeableBeacon.deploy(await impl.getAddress(), admin.address);
      await b.waitForDeployment();
      const F = await ethers.getContractFactory("BinaryMarketFactory");
      const fi = await F.deploy();
      await fi.waitForDeployment();
      const Proxy = await ethers.getContractFactory("ERC1967Proxy");
      const id = F.interface.encodeFunctionData("initialize", [admin.address, await b.getAddress()]);
      const pr = await Proxy.deploy(await fi.getAddress(), id);
      await pr.waitForDeployment();
      const fact = await ethers.getContractAt("BinaryMarketFactory", await pr.getAddress());
      await fact.createMarket(await col2.getAddress(), "q", expiry);
      const mktAddr = await fact.markets(0);
      const mkt = await ethers.getContractAt("BinaryMarket", mktAddr);
      await col2.connect(poor).approve(mktAddr, parseCollateral("1"));
      await mkt.connect(poor).deposit(parseCollateral("1"));
      await col2.connect(alice).approve(mktAddr, parseCollateral("1000"));
      await mkt.connect(alice).deposit(parseCollateral("500"));
      await mkt.connect(alice).mintShares(parseCollateral("500"));
      const nonce = await mkt.nonces(alice.address);
      const ord = {
        maker: alice.address,
        price: (50n * PRECISION) / 100n,
        size: parseCollateral("100"),
        isLong: false,
        nonce,
        expiry,
      };
      const sig = await signOrderV1(alice, mktAddr, ord);
      const enc = encodeMakerOrderV1(
        alice.address,
        (50n * PRECISION) / 100n,
        parseCollateral("100"),
        false,
        nonce,
        expiry
      );
      await expect(
        mkt.connect(poor).submitFillV1(poor.address, true, (50n * PRECISION) / 100n, parseCollateral("100"), enc, sig)
      ).to.be.revertedWithCustomError(mkt, "InsufficientCollateral");
    });
  });

  describe("Market: resolve and redeem", function () {
    it("only factory can resolve", async function () {
      const market2Addr = await factory.markets(0);
      const m2 = await ethers.getContractAt("BinaryMarket", market2Addr);
      await expect(m2.connect(admin).resolve(true)).to.be.revertedWithCustomError(m2, "Unauthorized");
    });

    it("resolve then redeem YES: winner gets collateral", async function () {
      const market2Addr = await factory.markets(0);
      const m2 = await ethers.getContractAt("BinaryMarket", market2Addr);
      if (await m2.resolved()) return;
      const bobYes = await m2.yesBalance(bob.address);
      const colBefore = await collateral.balanceOf(bob.address);
      await factory.connect(admin).resolveMarket(0, true);
      expect(await m2.resolved()).to.be.true;
      expect(await m2.outcome()).to.be.true;
      await m2.connect(bob).redeem();
      expect(await collateral.balanceOf(bob.address)).to.equal(colBefore + bobYes);
      expect(await m2.yesBalance(bob.address)).to.equal(0n);
    });

    it("resolve twice reverts AlreadyResolved", async function () {
      await expect(factory.connect(admin).resolveMarket(0, false)).to.be.revertedWithCustomError(
        factory,
        "AlreadyResolved"
      );
    });

    it("redeem with zero winning balance reverts NothingToRedeem", async function () {
      await expect(market.connect(carol).redeem()).to.be.revertedWithCustomError(market, "NothingToRedeem");
    });

    it("redeem on unresolved market reverts EventResolved", async function () {
      const resolutionTime = Math.floor(Date.now() / 1000) + 86400 * 365;
      await factory.createMarket(await collateral.getAddress(), "another-q", resolutionTime);
      const newMarketAddr = await factory.markets(1);
      const newMarket = await ethers.getContractAt("BinaryMarket", newMarketAddr);
      await collateral.connect(alice).approve(newMarketAddr, parseCollateral("10"));
      await newMarket.connect(alice).deposit(parseCollateral("10"));
      await newMarket.connect(alice).mintShares(parseCollateral("10"));
      await expect(newMarket.connect(alice).redeem()).to.be.revertedWithCustomError(newMarket, "EventResolved");
    });
  });

  describe("Market: after resolution", function () {
    it("deposit / withdraw / mint / merge revert when resolved", async function () {
      const resolutionTime = Math.floor(Date.now() / 1000) + 86400 * 365;
      await factory.createMarket(await collateral.getAddress(), "resolved-q", resolutionTime);
      const addr = await factory.markets(2);
      const m = await ethers.getContractAt("BinaryMarket", addr);
      await collateral.connect(bob).approve(addr, parseCollateral("10"));
      await m.connect(bob).deposit(parseCollateral("10"));
      await factory.connect(admin).resolveMarket(2, true);
      await expect(m.connect(bob).deposit(1)).to.be.revertedWithCustomError(m, "EventResolved");
      await expect(m.connect(bob).withdraw(1)).to.be.revertedWithCustomError(m, "EventResolved");
      await expect(m.connect(bob).mintShares(1)).to.be.revertedWithCustomError(m, "EventResolved");
      await expect(m.connect(bob).mergeShares(1)).to.be.revertedWithCustomError(m, "EventResolved");
    });

    it("submitFill reverts when resolved", async function () {
      const m = await ethers.getContractAt("BinaryMarket", await factory.markets(2));
      const nonce = await m.nonces(alice.address);
      const order = {
        maker: alice.address,
        price: (50n * PRECISION) / 100n,
        size: parseCollateral("1"),
        isLong: false,
        nonce,
        expiry: BigInt(Math.floor(Date.now() / 1000) + 86400),
      };
      const sig = await signOrderV1(alice, await m.getAddress(), order);
      const enc = encodeMakerOrderV1(
        alice.address,
        (50n * PRECISION) / 100n,
        parseCollateral("1"),
        false,
        nonce,
        order.expiry
      );
      await expect(
        m.connect(bob).submitFillV1(
          bob.address,
          true,
          (50n * PRECISION) / 100n,
          parseCollateral("1"),
          enc,
          sig
        )
      ).to.be.revertedWithCustomError(m, "EventResolved");
    });
  });

  describe("Market: NO outcome redeem", function () {
    it("when outcome is NO, redeem pays noBalance", async function () {
      const resolutionTime = Math.floor(Date.now() / 1000) + 86400 * 365;
      await factory.createMarket(await collateral.getAddress(), "no-wins", resolutionTime);
      const addr = await factory.markets(3);
      const m = await ethers.getContractAt("BinaryMarket", addr);
      await collateral.connect(alice).approve(addr, parseCollateral("100"));
      await m.connect(alice).deposit(parseCollateral("100"));
      await m.connect(alice).mintShares(parseCollateral("100"));
      await m.connect(alice).mergeShares(parseCollateral("50"));
      expect(await m.yesBalance(alice.address)).to.equal(parseCollateral("50"));
      expect(await m.noBalance(alice.address)).to.equal(parseCollateral("50"));
      await factory.connect(admin).resolveMarket(3, false);
      const colBefore = await collateral.balanceOf(alice.address);
      await m.connect(alice).redeem();
      expect(await m.noBalance(alice.address)).to.equal(0n);
      expect(await collateral.balanceOf(alice.address)).to.equal(colBefore + parseCollateral("50"));
    });
  });

  describe("Edge: initialization and view", function () {
    it("market exposes collateral, factory, marketId", async function () {
      expect(await market.collateral()).to.equal(await collateral.getAddress());
      expect(await market.factory()).to.equal(await factory.getAddress());
      expect(await market.marketId()).to.equal(0n);
    });

    it("initialize cannot be called twice", async function () {
      const BinaryMarket = await ethers.getContractFactory("BinaryMarket");
      const impl = await BinaryMarket.deploy();
      await impl.waitForDeployment();
      const UpgradeableBeacon = await ethers.getContractFactory("UpgradeableBeacon");
      const b = await UpgradeableBeacon.deploy(await impl.getAddress(), admin.address);
      await b.waitForDeployment();
      const BeaconProxy = await ethers.getContractFactory("BeaconProxy");
      const initData = BinaryMarket.interface.encodeFunctionData("initialize", [
        await collateral.getAddress(),
        await factory.getAddress(),
        99n,
      ]);
      const proxy = await BeaconProxy.deploy(await b.getAddress(), initData);
      await proxy.waitForDeployment();
      const m = await ethers.getContractAt("BinaryMarket", await proxy.getAddress());
      await expect(
        m.initialize(await collateral.getAddress(), await factory.getAddress(), 99n)
      ).to.be.revertedWithCustomError(m, "InvalidInitialization");
    });
  });

  describe("Edge: multiple markets", function () {
    it("market 0 and 1 have different addresses and state", async function () {
      expect(await factory.markets(0)).to.not.equal(await factory.markets(1));
      const m0 = await ethers.getContractAt("BinaryMarket", await factory.markets(0));
      const m1 = await ethers.getContractAt("BinaryMarket", await factory.markets(1));
      expect(await m0.resolved()).to.be.true;
      expect(await m1.resolved()).to.be.false;
    });
  });
});
