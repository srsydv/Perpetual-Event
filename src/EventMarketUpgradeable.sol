// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IEventMarket} from "./interfaces/IEventMarket.sol";
import {EventPerpMath} from "./libraries/EventPerpMath.sol";
import {EIP712Initializable} from "./upgradeable/EIP712Initializable.sol";

/// @title EventMarket (Upgradeable)
/// @notice Per-event perpetual market behind BeaconProxy; use initialize() for proxy init
contract EventMarketUpgradeable is IEventMarket, Initializable, ReentrancyGuard, EIP712Initializable {
    using SafeERC20 for IERC20;

    bytes32 public constant ORDER_TYPEHASH_V1 = keccak256(
        "Order(address maker,uint256 price,uint256 size,bool isLong,uint256 nonce,uint256 expiry)"
    );
    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,uint256 price,uint256 size,bool isLong,uint256 nonce,uint256 expiry,bytes32 salt)"
    );

    IERC20 public collateral;
    address public factory;
    uint256 public eventId;

    uint256 public constant PRECISION = 1e18;
    uint256 public maxLeverage = 5;
    uint256 public initialMarginBps = 2000;
    uint256 public maintenanceMarginBps = 1000;
    uint256 public makerFeeBps = 2;
    uint256 public takerFeeBps = 5;
    uint256 public liquidationPenaltyBps = 500;
    uint256 public liquidatorRewardBps = 200;
    /// @dev Max fraction of position to liquidate per call in bps (0 = full liquidation only)
    uint256 public maxLiquidationSizeBps = 0;

    uint256 public markPrice;
    uint256 public indexPrice;
    uint256 public markEmaAlphaBps;
    uint256 public maxMarkDeviationBps;
    uint256 public fundingIndex;
    uint256 public lastFundingTime;
    uint256 public fundingPeriod = 1 hours;
    int256 public fundingRateCap = int256(1e17);
    int256 public fundingRateFloor = -int256(1e17);

    uint256 public insuranceFund;
    bool public resolved;
    bool public outcome;
    /// @dev When true, only reduce/close and withdraw allowed (no new opens)
    bool public closeOnly;

    mapping(address => uint256) public collateralBalance;
    mapping(address => Position) public positions;
    mapping(address => uint256) public nonces;
    /// @dev V2: filled amount per orderHash for partial fills (orderHash => filled amount)
    mapping(bytes32 => uint256) public filledAmount;

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event Fill(address indexed taker, address indexed maker, bool takerLong, uint256 price, uint256 size);
    event Liquidate(address indexed trader, address indexed liquidator, uint256 size, uint256 penalty);
    event FundingUpdated(uint256 newFundingIndex, int256 fundingRate);
    event Resolved(bool outcome);
    event MarkPriceUpdated(uint256 markPrice);
    event IndexPriceUpdated(uint256 indexPrice);
    event MarkMicrostructureUpdated(uint256 alphaBps, uint256 maxDeviationBps);
    event OrderCanceled(address indexed maker, bytes32 orderHash);

    error Unauthorized();
    error EventPaused();
    error EventResolved();
    error InsufficientMargin();
    error InsufficientCollateral();
    error InvalidPrice();
    error InvalidSize();
    error InvalidSignature();
    error OrderExpired();
    error NotLiquidatable();
    error AlreadyResolved();
    error InvalidConfig();
    error CloseOnly();
    error OrderFilledOrCanceled();

    modifier onlyFactory() {
        if (msg.sender != factory) revert Unauthorized();
        _;
    }

    modifier whenNotResolved() {
        if (resolved) revert EventResolved();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _collateral, address _factory, uint256 _eventId) external initializer {
        collateral = IERC20(_collateral);
        factory = _factory;
        eventId = _eventId;
        markEmaAlphaBps = 2000; // 20% new trade, 80% previous mark
        maxMarkDeviationBps = 3000; // clamp mark within +/-30% of index when index is set
        lastFundingTime = block.timestamp;
        fundingPeriod = 1 hours;
        __EIP712_init_unchained("EventPerpetual", "1");
    }

    // ─────────── Margin Engine ───────────

    function deposit(uint256 amount) external nonReentrant whenNotResolved {
        if (amount == 0) return;
        collateral.safeTransferFrom(msg.sender, address(this), amount);
        collateralBalance[msg.sender] += amount;
        emit Deposit(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant whenNotResolved {
        if (amount == 0) return;
        updateFunding();
        settleFunding(msg.sender);
        _checkMargin(msg.sender, 0, 0, false);
        if (collateralBalance[msg.sender] < amount) revert InsufficientCollateral();
        collateralBalance[msg.sender] -= amount;
        collateral.safeTransfer(msg.sender, amount);
        emit Withdraw(msg.sender, amount);
    }

    function getEquity(address trader) public view returns (uint256) {
        uint256 col = collateralBalance[trader];
        Position memory pos = positions[trader];
        if (pos.size == 0) return col;
        uint256 exitPrice = resolved ? (outcome ? PRECISION : 0) : markPrice;
        int256 uPnL = EventPerpMath.pnl(
            pos.isLong ? int256(pos.size) : -int256(pos.size),
            pos.entryPrice,
            exitPrice,
            pos.isLong
        );
        if (uPnL >= 0) return col + uint256(uPnL);
        return col > uint256(-uPnL) ? col - uint256(-uPnL) : 0;
    }

    function getInitialMarginRequired(uint256 size, uint256 price) public view returns (uint256) {
        return (size * price * initialMarginBps) / (PRECISION * 10000);
    }

    function getMaintenanceMargin(uint256 size, uint256 price) public view returns (uint256) {
        return (size * price * maintenanceMarginBps) / (PRECISION * 10000);
    }

    function _checkMargin(address trader, uint256 addSize, uint256 addPrice, bool /* isLong */) internal view {
        Position memory pos = positions[trader];
        uint256 newSize = pos.size + addSize;
        if (newSize == 0) return;
        uint256 entry = pos.size == 0 ? addPrice : (pos.entryPrice * pos.size + addPrice * addSize) / newSize;
        uint256 maint = getMaintenanceMargin(newSize, entry);
        uint256 equity = getEquity(trader);
        if (addSize > 0) {
            uint256 initReq = getInitialMarginRequired(addSize, addPrice);
            if (equity < initReq) revert InsufficientMargin();
        }
        if (equity < maint) revert InsufficientMargin();
    }

    // ─────────── Order Book Settlement ───────────

    struct Order {
        address maker;
        uint256 price;
        uint256 size;
        bool isLong;
        uint256 nonce;
        uint256 expiry;
        bytes32 salt;
    }

    function getPosition(address trader) external view returns (Position memory) {
        return positions[trader];
    }

    function getMarkPrice() external view returns (uint256) {
        return markPrice;
    }

    function getIndexPrice() external view returns (uint256) {
        return indexPrice;
    }

    function hashOrder(Order memory order) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ORDER_TYPEHASH,
                    order.maker,
                    order.price,
                    order.size,
                    order.isLong,
                    order.nonce,
                    order.expiry,
                    order.salt
                )
            )
        );
    }

    function hashOrderV1(address maker, uint256 price, uint256 size, bool isLong, uint256 nonce, uint256 expiry)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(ORDER_TYPEHASH_V1, maker, price, size, isLong, nonce, expiry))
        );
    }

    /// @dev Unique order id for partial fill tracking (maker, price, size, nonce, expiry, salt)
    function getOrderHash(address maker, uint256 price, uint256 size, uint256 nonce, uint256 expiry, bytes32 salt)
        public
        view
        returns (bytes32)
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

    /// @dev V1 backward compat: 6-param order without salt (single fill, nonce increment)
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
        if (closeOnly) revert CloseOnly();
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

        updateFunding();
        settleFunding(taker);
        settleFunding(maker);
        _executeFill(taker, takerIsLong, maker, makerLong, price, fillSize);
    }

    /// @dev Cancel order (maker only); marks order as fully filled for remaining size
    function cancelOrder(uint256 price, uint256 size, uint256 nonce, uint256 expiry, bytes32 salt) external {
        bytes32 orderHash = getOrderHash(msg.sender, price, size, nonce, expiry, salt);
        uint256 alreadyFilled = filledAmount[orderHash];
        if (alreadyFilled >= size) revert OrderFilledOrCanceled();
        filledAmount[orderHash] = size;
        emit OrderCanceled(msg.sender, orderHash);
    }

    function _executeFill(
        address taker,
        bool takerLong,
        address maker,
        bool makerLong,
        uint256 price,
        uint256 size
    ) internal {
        _updatePosition(taker, takerLong, price, size, true);
        _updatePosition(maker, makerLong, price, size, true);

        uint256 notional = (size * price) / PRECISION;
        uint256 takerFee = (notional * takerFeeBps) / 10000;
        uint256 makerFee = (notional * makerFeeBps) / 10000;
        collateralBalance[taker] -= takerFee;
        collateralBalance[maker] -= makerFee;
        insuranceFund += takerFee + makerFee;

        _updateMarkPrice(price);
        emit Fill(taker, maker, takerLong, price, size);
    }

    function _updateMarkPrice(uint256 tradePrice) internal {
        uint256 nextMark;
        if (markPrice == 0) {
            nextMark = tradePrice;
        } else {
            uint256 prevWeight = 10000 - markEmaAlphaBps;
            nextMark = (markPrice * prevWeight + tradePrice * markEmaAlphaBps) / 10000;
        }

        if (indexPrice > 0 && maxMarkDeviationBps > 0) {
            uint256 upper = (indexPrice * (10000 + maxMarkDeviationBps)) / 10000;
            uint256 lower = (indexPrice * (10000 - maxMarkDeviationBps)) / 10000;
            if (nextMark > upper) nextMark = upper;
            if (nextMark < lower) nextMark = lower;
        }

        markPrice = nextMark;
        emit MarkPriceUpdated(nextMark);
    }

    function _updatePosition(address trader, bool isLong, uint256 price, uint256 size, bool /* isIncrease */) internal {
        Position storage pos = positions[trader];
        if (pos.size == 0) {
            pos.size = size;
            pos.entryPrice = price;
            pos.isLong = isLong;
            pos.lastFundingIndex = fundingIndex;
        } else if (pos.isLong == isLong) {
            pos.entryPrice = (pos.entryPrice * pos.size + price * size) / (pos.size + size);
            pos.size += size;
        } else {
            uint256 closeSize = size >= pos.size ? pos.size : size;
            int256 rPnL = EventPerpMath.pnl(
                pos.isLong ? int256(closeSize) : -int256(closeSize),
                pos.entryPrice,
                price,
                pos.isLong
            );
            if (rPnL > 0) collateralBalance[trader] += uint256(rPnL);
            else collateralBalance[trader] -= uint256(-rPnL);

            if (size >= pos.size) {
                pos.size = size - pos.size;
                pos.entryPrice = price;
                pos.isLong = isLong;
                pos.lastFundingIndex = fundingIndex;
            } else {
                pos.size -= size;
            }
        }
        _checkMargin(trader, 0, 0, false);
    }

    // ─────────── Liquidation Engine ───────────

    function liquidate(address trader) external nonReentrant whenNotResolved {
        updateFunding();
        settleFunding(trader);
        Position storage pos = positions[trader];
        if (pos.size == 0) revert NotLiquidatable();
        uint256 maint = getMaintenanceMargin(pos.size, pos.entryPrice);
        if (getEquity(trader) >= maint) revert NotLiquidatable();

        uint256 liqSize = pos.size;
        if (maxLiquidationSizeBps > 0 && maxLiquidationSizeBps < 10000) {
            liqSize = (pos.size * maxLiquidationSizeBps) / 10000;
            if (liqSize == 0) liqSize = 1;
        }

        uint256 closePrice = markPrice;
        int256 pnl = EventPerpMath.pnl(
            pos.isLong ? int256(liqSize) : -int256(liqSize),
            pos.entryPrice,
            closePrice,
            pos.isLong
        );
        if (pnl > 0) collateralBalance[trader] += uint256(pnl);
        else collateralBalance[trader] -= uint256(-pnl);

        uint256 penalty = (liqSize * pos.entryPrice * liquidationPenaltyBps) / (PRECISION * 10000);
        uint256 reward = (penalty * liquidatorRewardBps) / (liquidationPenaltyBps);
        uint256 fromTrader = penalty <= collateralBalance[trader] ? penalty : collateralBalance[trader];
        collateralBalance[trader] -= fromTrader;
        collateralBalance[msg.sender] += reward;
        if (fromTrader >= reward) {
            insuranceFund += (fromTrader - reward);
        } else {
            insuranceFund -= (reward - fromTrader);
        }

        if (liqSize >= pos.size) {
            delete positions[trader];
        } else {
            pos.size -= liqSize;
        }
        emit Liquidate(trader, msg.sender, liqSize, penalty);
    }

    // ─────────── Funding Engine ───────────

    function setIndexPrice(uint256 _indexPrice) external onlyFactory {
        indexPrice = _indexPrice;
        emit IndexPriceUpdated(_indexPrice);
    }

    function setMarkMicrostructure(uint256 _alphaBps, uint256 _maxDeviationBps) external onlyFactory {
        if (_alphaBps == 0 || _alphaBps > 10000) revert InvalidConfig();
        if (_maxDeviationBps > 10000) revert InvalidConfig();
        markEmaAlphaBps = _alphaBps;
        maxMarkDeviationBps = _maxDeviationBps;
        emit MarkMicrostructureUpdated(_alphaBps, _maxDeviationBps);
    }

    function setCloseOnly(bool _closeOnly) external onlyFactory {
        closeOnly = _closeOnly;
    }

    function setFundingRateCaps(int256 _fundingRateCap, int256 _fundingRateFloor) external onlyFactory {
        fundingRateCap = _fundingRateCap;
        fundingRateFloor = _fundingRateFloor;
    }

    function setMaxLiquidationSizeBps(uint256 _maxLiquidationSizeBps) external onlyFactory {
        if (_maxLiquidationSizeBps > 10000) revert InvalidConfig();
        maxLiquidationSizeBps = _maxLiquidationSizeBps;
    }

    function updateFunding() public whenNotResolved {
        uint256 elapsed = block.timestamp - lastFundingTime;
        if (elapsed < fundingPeriod) return;
        uint256 periods = elapsed / fundingPeriod;
        lastFundingTime += periods * fundingPeriod;
        int256 rate = int256(markPrice) - int256(indexPrice);
        if (rate > fundingRateCap) rate = fundingRateCap;
        if (rate < fundingRateFloor) rate = fundingRateFloor;
        fundingIndex += uint256(rate * int256(periods));
        emit FundingUpdated(fundingIndex, rate);
    }

    function settleFunding(address trader) internal {
        Position storage pos = positions[trader];
        if (pos.size == 0) return;
        int256 accrued = (int256(fundingIndex) - int256(pos.lastFundingIndex)) * int256(pos.size) / int256(PRECISION);
        if (pos.isLong) {
            if (accrued > 0) collateralBalance[trader] -= uint256(accrued);
            else collateralBalance[trader] += uint256(-accrued);
        } else {
            if (accrued > 0) collateralBalance[trader] += uint256(accrued);
            else collateralBalance[trader] -= uint256(-accrued);
        }
        pos.lastFundingIndex = fundingIndex;
    }

    // ─────────── Oracle Resolution ───────────

    function resolve(bool _outcome) external onlyFactory {
        if (resolved) revert AlreadyResolved();
        resolved = true;
        outcome = _outcome;
        emit Resolved(_outcome);
    }

    function settleAndWithdraw() external nonReentrant {
        if (!resolved) revert EventResolved();
        Position memory pos = positions[msg.sender];
        if (pos.size == 0) {
            collateral.safeTransfer(msg.sender, collateralBalance[msg.sender]);
            collateralBalance[msg.sender] = 0;
            return;
        }
        uint256 exitPrice = outcome ? PRECISION : 0;
        int256 pnl = EventPerpMath.pnl(
            pos.isLong ? int256(pos.size) : -int256(pos.size),
            pos.entryPrice,
            exitPrice,
            pos.isLong
        );
        if (pnl > 0) collateralBalance[msg.sender] += uint256(pnl);
        else collateralBalance[msg.sender] -= uint256(-pnl);
        delete positions[msg.sender];
        collateral.safeTransfer(msg.sender, collateralBalance[msg.sender]);
        collateralBalance[msg.sender] = 0;
    }

    function getOpenInterest() external pure returns (uint256 longOi, uint256 shortOi) {
        return (0, 0);
    }
}
