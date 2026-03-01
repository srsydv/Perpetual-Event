// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IBinaryMarketFactory} from "./IBinaryMarketFactory.sol";
import {IBinaryMarket} from "./IBinaryMarket.sol";
import {BinaryMarket} from "./BinaryMarket.sol";

/// @title BinaryMarketFactory (Polymarket-style)
/// @notice Deploys BinaryMarket contracts (one per event).
contract BinaryMarketFactory is IBinaryMarketFactory {
    address public override admin;
    uint256 public override marketCount;
    mapping(uint256 => address) public override markets;

    event MarketCreated(uint256 indexed marketId, address market, address collateral, string questionId, uint256 resolutionTime);
    event MarketResolved(uint256 indexed marketId, bool outcome);
    event AdminSet(address indexed admin);

    error Unauthorized();
    error AlreadyResolved();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    constructor(address _admin) {
        admin = _admin;
        emit AdminSet(_admin);
    }

    function setAdmin(address _admin) external onlyAdmin {
        admin = _admin;
        emit AdminSet(_admin);
    }

    function createMarket(address collateral, string calldata questionId, uint256 resolutionTime)
        external
        onlyAdmin
        returns (uint256 marketId, address market)
    {
        marketId = marketCount++;
        BinaryMarket m = new BinaryMarket();
        m.initialize(collateral, address(this), marketId);
        market = address(m);
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
