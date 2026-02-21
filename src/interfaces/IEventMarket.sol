// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IEventMarket {
    struct Position {
        uint256 size;
        uint256 entryPrice;
        bool isLong;
        uint256 lastFundingIndex;
    }

    function deposit(uint256 amount) external;

    function withdraw(uint256 amount) external;

    function submitFill(
        address taker,
        bool takerIsLong,
        uint256 price,
        uint256 size,
        bytes calldata makerOrder,
        bytes calldata signature
    ) external;

    function liquidate(address trader) external;

    function updateFunding() external;

    function resolve(bool outcome) external;

    function getPosition(address trader) external view returns (Position memory);

    function getMarkPrice() external view returns (uint256);

    function getIndexPrice() external view returns (uint256);
}
