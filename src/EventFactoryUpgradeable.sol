// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IEventFactory} from "./interfaces/IEventFactory.sol";
import {EventMarket} from "./EventMarket.sol";
import {EventMarketUpgradeable} from "./EventMarketUpgradeable.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

/// @title EventFactory (Upgradeable)
/// @notice Creates event perpetual markets via beacon proxies; UUPS upgradeable
contract EventFactoryUpgradeable is IEventFactory, Initializable, UUPSUpgradeable {
    address public collateral;
    address public admin;
    address public marketBeacon;

    uint256 private _eventCount;
    mapping(uint256 => EventInfo) private _events;

    event EventCreated(uint256 indexed eventId, string name, address market, address oracle, uint256 resolutionTime);
    event EventResolved(uint256 indexed eventId, bool outcome);
    event EventPaused(uint256 indexed eventId);
    event EventUnpaused(uint256 indexed eventId);
    event AdminSet(address indexed admin);
    event MarketBeaconSet(address indexed beacon);

    error Unauthorized();
    error InvalidResolutionTime();
    error BeaconNotSet();
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

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param _collateral Collateral token (e.g. USDC)
    /// @param _admin Admin address
    /// @param _marketBeacon Beacon for EventMarket implementation (set to address(0) to set later)
    function initialize(address _collateral, address _admin, address _marketBeacon) public initializer {
        collateral = _collateral;
        admin = _admin;
        marketBeacon = _marketBeacon;
        emit AdminSet(_admin);
        if (_marketBeacon != address(0)) emit MarketBeaconSet(_marketBeacon);
    }

    function setMarketBeacon(address _marketBeacon) external onlyAdmin {
        marketBeacon = _marketBeacon;
        emit MarketBeaconSet(_marketBeacon);
    }

    function _authorizeUpgrade(address) internal override onlyAdmin {}

    function setAdmin(address _admin) external onlyAdmin {
        admin = _admin;
        emit AdminSet(_admin);
    }

    function createEvent(
        string calldata name,
        uint256 resolutionTime,
        address oracle
    ) external onlyAdmin returns (uint256 eventId, address market) {
        if (marketBeacon == address(0)) revert BeaconNotSet();
        if (resolutionTime <= block.timestamp) revert InvalidResolutionTime();
        eventId = _eventCount++;
        bytes memory initData = abi.encodeWithSelector(
            EventMarketUpgradeable.initialize.selector,
            collateral,
            address(this),
            eventId
        );
        market = address(new BeaconProxy(marketBeacon, initData));
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

    function resolveEvent(uint256 eventId, bool outcome) external onlyOracle(eventId) {
        EventInfo storage e = _events[eventId];
        if (e.resolved) revert AlreadyResolved();
        if (block.timestamp < e.resolutionTime) revert NotYetResolvable();
        e.resolved = true;
        e.outcome = outcome;
        EventMarket(e.market).resolve(outcome);
        emit EventResolved(eventId, outcome);
    }

    function pauseEvent(uint256 eventId) external onlyAdmin {
        _events[eventId].paused = true;
        emit EventPaused(eventId);
    }

    function unpauseEvent(uint256 eventId) external onlyAdmin {
        _events[eventId].paused = false;
        emit EventUnpaused(eventId);
    }

    function getEvent(uint256 eventId) external view returns (EventInfo memory) {
        return _events[eventId];
    }

    function eventCount() external view returns (uint256) {
        return _eventCount;
    }

    function setMarketIndexPrice(uint256 eventId, uint256 indexPrice) external {
        if (msg.sender != admin && msg.sender != _events[eventId].oracle) revert Unauthorized();
        EventMarket(_events[eventId].market).setIndexPrice(indexPrice);
    }
}
