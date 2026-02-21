// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {EventFactoryUpgradeable} from "../src/EventFactoryUpgradeable.sol";
import {EventMarketUpgradeable} from "../src/EventMarketUpgradeable.sol";
import {IEventFactory} from "../src/interfaces/IEventFactory.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {
        _mint(msg.sender, 10_000_000 * 1e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract EventPerpetualUpgradeableTest is Test {
    EventFactoryUpgradeable public factory;
    MockUSDC public usdc;
    UpgradeableBeacon public beacon;

    address admin = address(1);
    address oracle = address(2);
    address alice = address(3);

    function setUp() public {
        usdc = new MockUSDC();
        usdc.transfer(alice, 1_000_000 * 1e6);

        EventMarketUpgradeable marketImpl = new EventMarketUpgradeable();
        beacon = new UpgradeableBeacon(address(marketImpl), admin);

        EventFactoryUpgradeable factoryImpl = new EventFactoryUpgradeable();
        bytes memory initData = abi.encodeWithSelector(
            EventFactoryUpgradeable.initialize.selector,
            address(usdc),
            admin,
            address(beacon)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(factoryImpl), initData);
        factory = EventFactoryUpgradeable(address(proxy));
    }

    function test_Upgradeable_CreateEvent() public {
        vm.prank(admin);
        (uint256 eventId, address market) = factory.createEvent(
            "Will BTC > 100k?",
            block.timestamp + 365 days,
            oracle
        );
        assertEq(eventId, 0);
        assertTrue(market != address(0));
        IEventFactory.EventInfo memory e = factory.getEvent(0);
        assertEq(e.name, "Will BTC > 100k?");
        assertEq(e.oracle, oracle);
        assertEq(e.market, market);
        assertFalse(e.resolved);

        EventMarketUpgradeable m = EventMarketUpgradeable(payable(market));
        assertEq(address(m.collateral()), address(usdc));
        assertEq(m.factory(), address(factory));
        assertEq(m.eventId(), 0);
    }

    function test_Upgradeable_DepositWithdraw() public {
        vm.prank(admin);
        (, address market) = factory.createEvent("Test", block.timestamp + 1 days, oracle);
        EventMarketUpgradeable m = EventMarketUpgradeable(payable(market));

        vm.startPrank(alice);
        usdc.approve(market, 1000 * 1e6);
        m.deposit(1000 * 1e6);
        assertEq(m.collateralBalance(alice), 1000 * 1e6);
        m.withdraw(500 * 1e6);
        assertEq(m.collateralBalance(alice), 500 * 1e6);
        vm.stopPrank();
    }

    function test_Upgradeable_UpgradeFactory() public {
        vm.prank(admin);
        factory.createEvent("Test", block.timestamp + 1 days, oracle);
        address market0 = factory.getEvent(0).market;

        EventFactoryUpgradeable factoryImplV2 = new EventFactoryUpgradeable();
        vm.prank(admin);
        factory.upgradeToAndCall(address(factoryImplV2), "");

        assertEq(factory.getEvent(0).market, market0);
        assertEq(factory.eventCount(), 1);
    }

    function test_Upgradeable_UpgradeMarketBeacon() public {
        vm.prank(admin);
        (, address market) = factory.createEvent("Test", block.timestamp + 1 days, oracle);
        EventMarketUpgradeable m = EventMarketUpgradeable(payable(market));
        vm.prank(alice);
        usdc.approve(market, 1000 * 1e6);
        vm.prank(alice);
        m.deposit(1000 * 1e6);

        EventMarketUpgradeable marketImplV2 = new EventMarketUpgradeable();
        vm.prank(admin);
        beacon.upgradeTo(address(marketImplV2));

        assertEq(m.collateralBalance(alice), 1000 * 1e6);
        assertEq(address(m.collateral()), address(usdc));
    }
}
