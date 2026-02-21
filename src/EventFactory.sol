// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IEventFactory} from "./interfaces/IEventFactory.sol";
import {EventMarket} from "./EventMarket.sol";

/// @title EventFactory
/// @notice Creates event perpetual markets and handles oracle resolution
contract EventFactory is IEventFactory {
    address public immutable collateral;
    address public admin;

    uint256 private _eventCount;
    mapping(uint256 => EventInfo) private _events;

    event EventCreated(uint256 indexed eventId, string name, address market, address oracle, uint256 resolutionTime);
    event EventResolved(uint256 indexed eventId, bool outcome);
    event EventPaused(uint256 indexed eventId);
    event EventUnpaused(uint256 indexed eventId);
    event AdminSet(address indexed admin);

    error Unauthorized();
    error InvalidResolutionTime();
    error EventNotFound();
    error AlreadyResolved();
    error NotYetResolvable();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlyOracle(uint256 eventId) {
        if (msg.sender != _events[eventId].oracle) revert Unauthorized();
        _;
    }

    constructor(address _collateral, address _admin) {
        collateral = _collateral;
        admin = _admin;
        emit AdminSet(_admin);
    }

    function setAdmin(address _admin) external onlyAdmin {
        admin = _admin;
        emit AdminSet(_admin);
    }

    /// @inheritdoc IEventFactory
    function createEvent(
        string calldata name,
        uint256 resolutionTime,
        address oracle
    ) external onlyAdmin returns (uint256 eventId, address market) {
        if (resolutionTime <= block.timestamp) revert InvalidResolutionTime();
        eventId = _eventCount++;
        market = address(new EventMarket(collateral, address(this), eventId));
        _events[eventId] = EventInfo({
            name: name,
            resolutionTime: resolutionTime,
            oracle: oracle,
            market: market,
            resolved: false,
            outcome: false,
            paused: false
        });
        emit EventCreated(eventId, name, market, oracle, resolutionTime);
        return (eventId, market);
    }

    /// @inheritdoc IEventFactory
    function resolveEvent(uint256 eventId, bool outcome) external onlyOracle(eventId) {
        EventInfo storage e = _events[eventId];
        if (e.resolved) revert AlreadyResolved();
        if (block.timestamp < e.resolutionTime) revert NotYetResolvable();
        e.resolved = true;
        e.outcome = outcome;
        EventMarket(e.market).resolve(outcome);
        emit EventResolved(eventId, outcome);
    }

    /// @inheritdoc IEventFactory
    function pauseEvent(uint256 eventId) external onlyAdmin {
        _events[eventId].paused = true;
        emit EventPaused(eventId);
    }

    function unpauseEvent(uint256 eventId) external onlyAdmin {
        _events[eventId].paused = false;
        emit EventUnpaused(eventId);
    }

    /// @inheritdoc IEventFactory
    function getEvent(uint256 eventId) external view returns (EventInfo memory) {
        return _events[eventId];
    }

    /// @inheritdoc IEventFactory
    function eventCount() external view returns (uint256) {
        return _eventCount;
    }

    /// @notice Update index price for funding (called by oracle or admin)
    function setMarketIndexPrice(uint256 eventId, uint256 indexPrice) external {
        if (msg.sender != admin && msg.sender != _events[eventId].oracle) revert Unauthorized();
        EventMarket(_events[eventId].market).setIndexPrice(indexPrice);
    }
}
