/**
 * Basic tests for Binary (Polymarket-style) market: upgradeable factory + beacon; deposit, mint, trade, resolve, redeem.
 */
const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

const PRECISION = 10n ** 18n;
function parseCollateral(s) {
  return ethers.parseEther(String(s));
}

describe("BinaryMarket", function () {
  let factory, market, collateral;
  let admin, alice, bob;

  before(async function () {
    [admin, alice, bob] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    collateral = await MockERC20.deploy();
    await collateral.waitForDeployment();
    for (const acc of [admin, alice, bob]) {
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

  it("deposit and withdraw", async function () {
    const amount = parseCollateral("100");
    await collateral.connect(alice).approve(await market.getAddress(), amount);
    await market.connect(alice).deposit(amount);
    expect(await market.collateralBalance(alice.address)).to.equal(amount);
    await market.connect(alice).withdraw(amount);
    expect(await market.collateralBalance(alice.address)).to.equal(0n);
  });

  it("mint and merge shares", async function () {
    const amount = parseCollateral("50");
    await collateral.connect(alice).approve(await market.getAddress(), amount);
    await market.connect(alice).deposit(amount);
    await market.connect(alice).mintShares(amount);
    expect(await market.yesBalance(alice.address)).to.equal(amount);
    expect(await market.noBalance(alice.address)).to.equal(amount);
    expect(await market.collateralBalance(alice.address)).to.equal(0n);
    await market.connect(alice).mergeShares(amount);
    expect(await market.yesBalance(alice.address)).to.equal(0n);
    expect(await market.noBalance(alice.address)).to.equal(0n);
    expect(await market.collateralBalance(alice.address)).to.equal(amount);
  });

  it("resolve and redeem", async function () {
    const amount = parseCollateral("20");
    await collateral.connect(bob).approve(await market.getAddress(), amount);
    await market.connect(bob).deposit(amount);
    await market.connect(bob).mintShares(amount);
    await factory.connect(admin).resolveMarket(0, true); // YES wins
    const yesBefore = await market.yesBalance(bob.address);
    const colBefore = await collateral.balanceOf(bob.address);
    await market.connect(bob).redeem();
    expect(await market.yesBalance(bob.address)).to.equal(0n);
    expect(await collateral.balanceOf(bob.address)).to.equal(colBefore + yesBefore);
  });
});
