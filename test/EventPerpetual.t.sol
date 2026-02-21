// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EventFactory} from "../src/EventFactory.sol";
import {EventMarket} from "../src/EventMarket.sol";
import {IEventFactory} from "../src/interfaces/IEventFactory.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {
        _mint(msg.sender, 10_000_000 * 1e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract EventPerpetualTest is Test {
    EventFactory public factory;
    MockUSDC public usdc;

    address admin = address(1);
    address oracle = address(2);
    address alice = address(3);
    address bob = address(4);

    function setUp() public {
        usdc = new MockUSDC();
        factory = new EventFactory(address(usdc), admin);
        usdc.transfer(alice, 1_000_000 * 1e6);
        usdc.transfer(bob, 1_000_000 * 1e6);
    }

    function test_CreateEvent() public {
        vm.prank(admin);
        (uint256 eventId, address market) = factory.createEvent(
            "Will Trump win 2028?",
            block.timestamp + 365 days,
            oracle
        );
        assertEq(eventId, 0);
        assertTrue(market != address(0));
        IEventFactory.EventInfo memory e = factory.getEvent(0);
        assertEq(e.name, "Will Trump win 2028?");
        assertEq(e.oracle, oracle);
        assertEq(e.market, market);
        assertFalse(e.resolved);
        assertFalse(e.paused);
    }

    function test_DepositWithdraw() public {
        vm.prank(admin);
        (, address market) = factory.createEvent("Test", block.timestamp + 1 days, oracle);
        EventMarket m = EventMarket(payable(market));

        vm.startPrank(alice);
        usdc.approve(market, 1000 * 1e6);
        m.deposit(1000 * 1e6);
        assertEq(m.collateralBalance(alice), 1000 * 1e6);
        m.withdraw(500 * 1e6);
        assertEq(m.collateralBalance(alice), 500 * 1e6);
        assertEq(usdc.balanceOf(alice), 1_000_000 * 1e6 - 500 * 1e6);
        vm.stopPrank();
    }

    function test_ResolveEvent() public {
        vm.prank(admin);
        (, address market) = factory.createEvent("Test", block.timestamp + 1 days, oracle);
        EventMarket m = EventMarket(payable(market));

        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(oracle);
        factory.resolveEvent(0, true);

        IEventFactory.EventInfo memory e = factory.getEvent(0);
        assertTrue(e.resolved);
        assertTrue(e.outcome);
        assertTrue(m.resolved());
        assertTrue(m.outcome());
    }

    function test_PauseUnpause() public {
        vm.prank(admin);
        factory.createEvent("Test", block.timestamp + 1 days, oracle);
        vm.prank(admin);
        factory.pauseEvent(0);
        assertTrue(factory.getEvent(0).paused);
        vm.prank(admin);
        factory.unpauseEvent(0);
        assertFalse(factory.getEvent(0).paused);
    }
}
