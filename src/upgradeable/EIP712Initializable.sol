// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @dev Minimal EIP-712 for upgradeable contracts: domain set in initializer, not constructor.
abstract contract EIP712Initializable {
    bytes32 private constant TYPE_HASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 private _cachedDomainSeparator;
    uint256 private _cachedChainId;
    address private _cachedThis;
    bytes32 private _hashedName;
    bytes32 private _hashedVersion;

    function _domainSeparatorV4() internal view returns (bytes32) {
        if (address(this) == _cachedThis && block.chainid == _cachedChainId) {
            return _cachedDomainSeparator;
        }
        return keccak256(abi.encode(TYPE_HASH, _hashedName, _hashedVersion, block.chainid, address(this)));
    }

    function _hashTypedDataV4(bytes32 structHash) internal view virtual returns (bytes32) {
        return MessageHashUtils.toTypedDataHash(_domainSeparatorV4(), structHash);
    }

    /// @dev Call from contract initializer (e.g. __EventMarket_init_unchained).
    function __EIP712_init_unchained(string memory name, string memory version) internal {
        _hashedName = keccak256(bytes(name));
        _hashedVersion = keccak256(bytes(version));
        _cachedChainId = block.chainid;
        _cachedThis = address(this);
        _cachedDomainSeparator = keccak256(abi.encode(TYPE_HASH, _hashedName, _hashedVersion, block.chainid, address(this)));
    }
}
