// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev For testing only: 18 decimals, initial mint to deployer.
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 10_000_000 * 1e18);
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
