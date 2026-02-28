// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title EventPerpMath
/// @notice Fixed-point math for event perpetuals (price 0-1e18)
library EventPerpMath {
    uint256 internal constant PRECISION = 1e18;
    uint256 internal constant MAX_PRICE = 1e18;

    function mulDiv(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256) {
        return (a * b) / denominator;
    }

    function pnl(int256 size, uint256 entryPrice, uint256 exitPrice, bool isLong) internal pure returns (int256) {
        if (size == 0) return 0;
        if (isLong) {
            if (exitPrice >= entryPrice) {
                return int256((uint256(size) * (exitPrice - entryPrice)) / PRECISION);
            } else {
                return -int256((uint256(size) * (entryPrice - exitPrice)) / PRECISION);
            }
        } else {
            if (entryPrice >= exitPrice) {
                return int256((uint256(-size) * (entryPrice - exitPrice)) / PRECISION);
            } else {
                return -int256((uint256(-size) * (exitPrice - entryPrice)) / PRECISION);
            }
        }
    }

    function abs(int256 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }
}
