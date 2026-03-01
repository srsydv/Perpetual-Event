// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IBinaryMarketFactory} from "./IBinaryMarketFactory.sol";
import {IBinaryMarket} from "./IBinaryMarket.sol";
import {BinaryMarket} from "./BinaryMarket.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

/// @title BinaryMarketFactory (Polymarket-style, Upgradeable)
/// @notice Creates binary markets via beacon proxies; UUPS upgradeable
contract BinaryMarketFactory is IBinaryMarketFactory, Initializable, UUPSUpgradeable {
    address public override admin;
    address public override marketBeacon;
    uint256 public override marketCount;
    mapping(uint256 => address) public override markets;

    event MarketCreated(uint256 indexed marketId, address market, address collateral, string questionId, uint256 resolutionTime);
    event MarketResolved(uint256 indexed marketId, bool outcome);
    event AdminSet(address indexed admin);
    event MarketBeaconSet(address indexed beacon);

    error Unauthorized();
    error AlreadyResolved();
    error BeaconNotSet();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param _admin Admin address
    /// @param _marketBeacon Beacon for BinaryMarket implementation (set to address(0) to set later)
    function initialize(address _admin, address _marketBeacon) public initializer {
        admin = _admin;
        marketBeacon = _marketBeacon;
        emit AdminSet(_admin);
        if (_marketBeacon != address(0)) emit MarketBeaconSet(_marketBeacon);
    }

    function _authorizeUpgrade(address) internal override onlyAdmin {}

    function setAdmin(address _admin) external onlyAdmin {
        admin = _admin;
        emit AdminSet(_admin);
    }

    function setMarketBeacon(address _marketBeacon) external onlyAdmin {
        marketBeacon = _marketBeacon;
        emit MarketBeaconSet(_marketBeacon);
    }

    function createMarket(address collateral, string calldata questionId, uint256 resolutionTime)
        external
        onlyAdmin
        returns (uint256 marketId, address market)
    {
        if (marketBeacon == address(0)) revert BeaconNotSet();
        marketId = marketCount++;
        bytes memory initData = abi.encodeWithSelector(
            BinaryMarket.initialize.selector,
            collateral,
            address(this),
            marketId
        );
        market = address(new BeaconProxy(marketBeacon, initData));
        markets[marketId] = market;
        emit MarketCreated(marketId, market, collateral, questionId, resolutionTime);
        return (marketId, market);
    }

    function resolveMarket(uint256 marketId, bool outcome) external onlyAdmin {
        address m = markets[marketId];
        if (m == address(0)) revert Unauthorized();
        if (IBinaryMarket(m).resolved()) revert AlreadyResolved();
        IBinaryMarket(m).resolve(outcome);
        emit MarketResolved(marketId, outcome);
    }
}
