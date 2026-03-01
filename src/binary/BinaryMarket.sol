// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IBinaryMarket} from "./IBinaryMarket.sol";
import {EIP712Initializable} from "../upgradeable/EIP712Initializable.sol";

/// @title BinaryMarket (Polymarket-style)
/// @notice Binary outcome market: buy/sell YES and NO shares; at resolution redeem winning shares for 1:1 collateral.
/// No margin, no leverage, no funding. CLOB: same EIP-712 order format; fill transfers collateral and share balances.
contract BinaryMarket is IBinaryMarket, ReentrancyGuard, EIP712Initializable {
    using SafeERC20 for IERC20;

    bytes32 public constant ORDER_TYPEHASH_V1 = keccak256(
        "Order(address maker,uint256 price,uint256 size,bool isLong,uint256 nonce,uint256 expiry)"
    );
    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,uint256 price,uint256 size,bool isLong,uint256 nonce,uint256 expiry,bytes32 salt)"
    );

    struct Order {
        address maker;
        uint256 price;
        uint256 size;
        bool isLong;
        uint256 nonce;
        uint256 expiry;
        bytes32 salt;
    }

    IERC20 private _collateral;
    address public override factory;
    uint256 public override marketId;

    function collateral() external view override returns (address) {
        return address(_collateral);
    }

    uint256 public constant PRECISION = 1e18;
    uint256 public makerFeeBps = 0;
    uint256 public takerFeeBps = 0;

    bool public override resolved;
    bool public override outcome; // true = YES wins

    mapping(address => uint256) public override collateralBalance;
    mapping(address => uint256) public override yesBalance;
    mapping(address => uint256) public override noBalance;
    mapping(address => uint256) public override nonces;
    mapping(bytes32 => uint256) public override filledAmount;

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event Fill(address indexed taker, address indexed maker, bool takerLong, uint256 price, uint256 size);
    event Resolved(bool outcome);
    event Redeem(address indexed user, bool sideYes, uint256 amount);
    event OrderCanceled(address indexed maker, bytes32 orderHash);

    error Unauthorized();
    error EventResolved();
    error InsufficientCollateral();
    error InsufficientShares();
    error InvalidPrice();
    error InvalidSize();
    error InvalidSignature();
    error OrderExpired();
    error AlreadyResolved();
    error OrderFilledOrCanceled();
    error NothingToRedeem();

    modifier onlyFactory() {
        if (msg.sender != factory) revert Unauthorized();
        _;
    }
    modifier whenNotResolved() {
        if (resolved) revert EventResolved();
        _;
    }

    constructor() {
        // non-upgradeable; init via initializer called by factory
    }

    function initialize(address collateral_, address _factory, uint256 _marketId) external {
        require(collateral_ != address(0) && factory == address(0), "already init");
        _collateral = IERC20(collateral_);
        factory = _factory;
        marketId = _marketId;
        __EIP712_init_unchained("BinaryMarket", "1");
    }

    function deposit(uint256 amount) external nonReentrant whenNotResolved {
        if (amount == 0) return;
        _collateral.safeTransferFrom(msg.sender, address(this), amount);
        collateralBalance[msg.sender] += amount;
        emit Deposit(msg.sender, amount);
    }

    /// @dev Polymarket-style: split collateral into 1 YES + 1 NO per unit. Use to get shares to sell on the book.
    function mintShares(uint256 amount) external nonReentrant whenNotResolved {
        if (amount == 0) return;
        if (collateralBalance[msg.sender] < amount) revert InsufficientCollateral();
        collateralBalance[msg.sender] -= amount;
        yesBalance[msg.sender] += amount;
        noBalance[msg.sender] += amount;
    }

    /// @dev Merge 1 YES + 1 NO back to 1 collateral (e.g. after resolution to reclaim from losing side).
    function mergeShares(uint256 amount) external nonReentrant whenNotResolved {
        if (amount == 0) return;
        if (yesBalance[msg.sender] < amount || noBalance[msg.sender] < amount) revert InsufficientShares();
        yesBalance[msg.sender] -= amount;
        noBalance[msg.sender] -= amount;
        collateralBalance[msg.sender] += amount;
    }

    function withdraw(uint256 amount) external nonReentrant whenNotResolved {
        if (amount == 0) return;
        if (collateralBalance[msg.sender] < amount) revert InsufficientCollateral();
        collateralBalance[msg.sender] -= amount;
        _collateral.safeTransfer(msg.sender, amount);
        emit Withdraw(msg.sender, amount);
    }

    function hashOrder(Order memory order) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            ORDER_TYPEHASH,
            order.maker,
            order.price,
            order.size,
            order.isLong,
            order.nonce,
            order.expiry,
            order.salt
        )));
    }

    function hashOrderV1(address maker, uint256 price, uint256 size, bool isLong, uint256 nonce, uint256 expiry)
        public view returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(ORDER_TYPEHASH_V1, maker, price, size, isLong, nonce, expiry)));
    }

    function getOrderHash(address maker, uint256 price, uint256 size, uint256 nonce, uint256 expiry, bytes32 salt)
        public view override returns (bytes32)
    {
        return keccak256(abi.encode(address(this), maker, price, size, nonce, expiry, salt));
    }

    function submitFill(
        address taker,
        bool takerIsLong,
        uint256 price,
        uint256 size,
        bytes calldata makerOrder,
        bytes calldata signature
    ) external nonReentrant whenNotResolved {
        (
            address maker,
            uint256 makerPrice,
            uint256 makerSize,
            uint256 makerLongU,
            uint256 nonce,
            uint256 expiry,
            bytes32 salt
        ) = abi.decode(makerOrder, (address, uint256, uint256, uint256, uint256, uint256, bytes32));
        _submitFillCore(taker, takerIsLong, price, size, maker, makerPrice, makerSize, makerLongU != 0, nonce, expiry, salt, signature);
    }

    function submitFillV1(
        address taker,
        bool takerIsLong,
        uint256 price,
        uint256 size,
        bytes calldata makerOrder,
        bytes calldata signature
    ) external nonReentrant whenNotResolved {
        (
            address maker,
            uint256 makerPrice,
            uint256 makerSize,
            uint256 makerLongU,
            uint256 nonce,
            uint256 expiry
        ) = abi.decode(makerOrder, (address, uint256, uint256, uint256, uint256, uint256));
        _submitFillCore(taker, takerIsLong, price, size, maker, makerPrice, makerSize, makerLongU != 0, nonce, expiry, bytes32(0), signature);
    }

    function _submitFillCore(
        address taker,
        bool takerIsLong,
        uint256 price,
        uint256 size,
        address maker,
        uint256 makerPrice,
        uint256 makerSize,
        bool makerLong,
        uint256 nonce,
        uint256 expiry,
        bytes32 salt,
        bytes calldata signature
    ) internal {
        if (price == 0 || price > PRECISION) revert InvalidPrice();
        if (size == 0) revert InvalidSize();
        if (block.timestamp > expiry) revert OrderExpired();
        if (takerIsLong == makerLong) revert InvalidSize();
        if (taker == maker) revert InvalidSize();

        uint256 fillSize;
        if (salt == bytes32(0)) {
            if (nonces[maker] != nonce) revert InvalidSignature();
            fillSize = size <= makerSize ? size : makerSize;
            if (fillSize != makerSize) revert InvalidSize();
            nonces[maker] = nonce + 1;
        } else {
            bytes32 orderHash = getOrderHash(maker, makerPrice, makerSize, nonce, expiry, salt);
            uint256 alreadyFilled = filledAmount[orderHash];
            if (alreadyFilled >= makerSize) revert OrderFilledOrCanceled();
            fillSize = size <= (makerSize - alreadyFilled) ? size : (makerSize - alreadyFilled);
            if (fillSize == 0) revert InvalidSize();
            filledAmount[orderHash] = alreadyFilled + fillSize;
        }

        if (takerIsLong && makerPrice > price) revert InvalidPrice();
        if (!takerIsLong && makerPrice < price) revert InvalidPrice();
        if (salt == bytes32(0)) {
            if (ECDSA.recover(hashOrderV1(maker, makerPrice, makerSize, makerLong, nonce, expiry), bytes(signature)) != maker) revert InvalidSignature();
        } else {
            Order memory order = Order({
                maker: maker,
                price: makerPrice,
                size: makerSize,
                isLong: makerLong,
                nonce: nonce,
                expiry: expiry,
                salt: salt
            });
            if (ECDSA.recover(hashOrder(order), bytes(signature)) != maker) revert InvalidSignature();
        }

        _executeFill(taker, takerIsLong, maker, makerLong, price, fillSize);
        emit Fill(taker, maker, takerIsLong, price, fillSize);
    }

    function cancelOrder(uint256 price, uint256 size, uint256 nonce, uint256 expiry, bytes32 salt) external {
        bytes32 orderHash = getOrderHash(msg.sender, price, size, nonce, expiry, salt);
        uint256 alreadyFilled = filledAmount[orderHash];
        if (alreadyFilled >= size) revert OrderFilledOrCanceled();
        filledAmount[orderHash] = size;
        emit OrderCanceled(msg.sender, orderHash);
    }

    /// @dev Fill: transfer collateral and YES shares. Long = holds/buys YES, Short = holds/sells YES.
    /// Maker long + taker short => taker sells YES to maker; maker pays price*size to taker.
    /// Maker short + taker long => maker sells YES to taker; taker pays price*size to maker.
    function _executeFill(
        address taker,
        bool takerLong,
        address maker,
        bool makerLong,
        uint256 price,
        uint256 size
    ) internal {
        uint256 notional = (size * price) / PRECISION;
        uint256 takerFee = (notional * takerFeeBps) / 10000;
        uint256 makerFee = (notional * makerFeeBps) / 10000;

        if (makerLong && !takerLong) {
            // Maker buys YES, taker sells YES: maker pays notional, taker receives; taker's YES -> maker
            if (yesBalance[taker] < size) revert InsufficientShares();
            if (collateralBalance[maker] < notional + makerFee) revert InsufficientCollateral();
            collateralBalance[maker] -= (notional + makerFee);
            collateralBalance[taker] += (notional - takerFee);
            yesBalance[taker] -= size;
            yesBalance[maker] += size;
        } else {
            // Maker sells YES, taker buys YES
            if (yesBalance[maker] < size) revert InsufficientShares();
            if (collateralBalance[taker] < notional + takerFee) revert InsufficientCollateral();
            collateralBalance[taker] -= (notional + takerFee);
            collateralBalance[maker] += (notional - makerFee);
            yesBalance[maker] -= size;
            yesBalance[taker] += size;
        }
    }

    function resolve(bool _outcome) external onlyFactory {
        if (resolved) revert AlreadyResolved();
        resolved = true;
        outcome = _outcome;
        emit Resolved(_outcome);
    }

    /// @dev After resolution: redeem winning shares for 1:1 collateral.
    function redeem() external nonReentrant {
        if (!resolved) revert EventResolved();
        uint256 amount = outcome ? yesBalance[msg.sender] : noBalance[msg.sender];
        if (amount == 0) revert NothingToRedeem();
        if (outcome) {
            yesBalance[msg.sender] = 0;
        } else {
            noBalance[msg.sender] = 0;
        }
        _collateral.safeTransfer(msg.sender, amount);
        emit Redeem(msg.sender, outcome, amount);
    }
}
