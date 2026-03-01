// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IBinaryMarket {
    function collateral() external view returns (address);
    function factory() external view returns (address);
    function marketId() external view returns (uint256);
    function resolved() external view returns (bool);
    function outcome() external view returns (bool); // true = YES wins

    function collateralBalance(address) external view returns (uint256);
    function yesBalance(address) external view returns (uint256);
    function noBalance(address) external view returns (uint256);
    function nonces(address) external view returns (uint256);
    function filledAmount(bytes32) external view returns (uint256);

    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function mintShares(uint256 amount) external;
    function mergeShares(uint256 amount) external;
    function submitFill(
        address taker,
        bool takerIsLong,
        uint256 price,
        uint256 size,
        bytes calldata makerOrder,
        bytes calldata signature
    ) external;
    function submitFillV1(
        address taker,
        bool takerIsLong,
        uint256 price,
        uint256 size,
        bytes calldata makerOrder,
        bytes calldata signature
    ) external;
    function cancelOrder(uint256 price, uint256 size, uint256 nonce, uint256 expiry, bytes32 salt) external;
    function resolve(bool _outcome) external;
    function redeem() external;

    function getOrderHash(address maker, uint256 price, uint256 size, uint256 nonce, uint256 expiry, bytes32 salt) external view returns (bytes32);
}
