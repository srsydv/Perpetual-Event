// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IBinaryMarketFactory {
    struct MarketInfo {
        address market;
        address collateral;
        string questionId;
        uint256 resolutionTime;
        bool resolved;
    }

    function admin() external view returns (address);
    function marketBeacon() external view returns (address);
    function marketCount() external view returns (uint256);
    function markets(uint256) external view returns (address);
    function createMarket(address collateral, string calldata questionId, uint256 resolutionTime) external returns (uint256 marketId, address market);
    function resolveMarket(uint256 marketId, bool outcome) external;
}
