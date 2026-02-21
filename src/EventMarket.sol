// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IEventMarket} from "./interfaces/IEventMarket.sol";
import {EventPerpMath} from "./libraries/EventPerpMath.sol";

/// @title EventMarket
/// @notice Per-event perpetual market: margin, positions, order-book settlement, liquidation, funding, resolution
contract EventMarket is IEventMarket, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,uint256 price,uint256 size,bool isLong,uint256 nonce,uint256 expiry)"
    );

    IERC20 public immutable collateral;
    address public factory;
    uint256 public eventId;

    uint256 public constant PRECISION = 1e18;
    uint256 public maxLeverage = 5; // 5x
    uint256 public initialMarginBps = 2000; // 20%
    uint256 public maintenanceMarginBps = 1000; // 10%
    uint256 public makerFeeBps = 2; // 0.02%
    uint256 public takerFeeBps = 5; // 0.05%
    uint256 public liquidationPenaltyBps = 500; // 5%
    uint256 public liquidatorRewardBps = 200; // 2%

    uint256 public markPrice; // 0 to PRECISION (probability)
    uint256 public indexPrice; // oracle/index for funding
    uint256 public fundingIndex; // cumulative funding
    uint256 public lastFundingTime;
    uint256 public fundingPeriod = 1 hours;

    uint256 public insuranceFund;
    bool public resolved;
    bool public outcome; // true = 1, false = 0

    mapping(address => uint256) public collateralBalance;
    mapping(address => Position) public positions;
    mapping(address => uint256) public nonces;

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event Fill(address indexed taker, address indexed maker, bool takerLong, uint256 price, uint256 size);
    event Liquidate(address indexed trader, address indexed liquidator, uint256 size, uint256 penalty);
    event FundingUpdated(uint256 newFundingIndex, int256 fundingRate);
    event Resolved(bool outcome);
    event MarkPriceUpdated(uint256 markPrice);
    event IndexPriceUpdated(uint256 indexPrice);

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

    modifier onlyFactory() {
        if (msg.sender != factory) revert Unauthorized();
        _;
    }

    modifier whenNotResolved() {
        if (resolved) revert EventResolved();
        _;
    }

    constructor(address _collateral, address _factory, uint256 _eventId) EIP712("EventPerpetual", "1") {
        collateral = IERC20(_collateral);
        factory = _factory;
        eventId = _eventId;
        lastFundingTime = block.timestamp;
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

    /// @dev Equity = collateral + unrealized PnL (mark-to-market)
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

    /// @dev Initial margin required to open: notional / leverage
    function getInitialMarginRequired(uint256 size, uint256 price) public view returns (uint256) {
        return (size * price * initialMarginBps) / (PRECISION * 10000);
    }

    /// @dev Maintenance margin: equity must stay above this
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

    // ─────────── Order Book Settlement (off-chain match + on-chain verify) ───────────

    struct Order {
        address maker;
        uint256 price;
        uint256 size;
        bool isLong;
        uint256 nonce;
        uint256 expiry;
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
                    order.expiry
                )
            )
        );
    }

    /// @param makerOrder abi-encoded (maker, price, size, isLong, nonce, expiry)
    /// @param signature ECDSA signature (r,s,v) of hashOrder(Order)
    function submitFill(
        address taker,
        bool takerIsLong,
        uint256 price,
        uint256 size,
        bytes calldata makerOrder,
        bytes calldata signature
    ) external nonReentrant whenNotResolved {
        if (price == 0 || price > PRECISION) revert InvalidPrice();
        if (size == 0) revert InvalidSize();
        (
            address maker,
            uint256 makerPrice,
            uint256 makerSize,
            uint256 makerLongU,
            uint256 nonce,
            uint256 expiry
        ) = abi.decode(makerOrder, (address, uint256, uint256, uint256, uint256, uint256));
        bool makerLong = makerLongU != 0;
        if (block.timestamp > expiry) revert OrderExpired();
        if (takerIsLong == makerLong) revert InvalidSize(); // must be opposite side
        uint256 fillSize = size <= makerSize ? size : makerSize;
        if (takerIsLong && makerPrice > price) revert InvalidPrice();
        if (!takerIsLong && makerPrice < price) revert InvalidPrice();
        Order memory order = Order({
            maker: maker,
            price: makerPrice,
            size: makerSize,
            isLong: makerLong,
            nonce: nonce,
            expiry: expiry
        });
        if (ECDSA.recoverCalldata(hashOrder(order), signature) != maker) revert InvalidSignature();
        if (nonces[maker] != nonce) revert InvalidSignature();
        nonces[maker] = nonce + 1;

        updateFunding();
        settleFunding(taker);
        settleFunding(maker);
        _executeFill(taker, takerIsLong, maker, makerLong, price, fillSize);
    }

    /// @dev Simple on-chain fill: two parties (taker long vs maker short or vice versa) at one price/size
    function _executeFill(
        address taker,
        bool takerLong,
        address maker,
        bool makerLong,
        uint256 price,
        uint256 size
    ) internal {
        // Update positions
        _updatePosition(taker, takerLong, price, size, true);
        _updatePosition(maker, makerLong, price, size, true);

        uint256 notional = (size * price) / PRECISION;
        uint256 takerFee = (notional * takerFeeBps) / 10000;
        uint256 makerFee = (notional * makerFeeBps) / 10000;
        collateralBalance[taker] -= takerFee;
        collateralBalance[maker] -= makerFee;
        insuranceFund += takerFee + makerFee;

        markPrice = price; // simple: last trade = mark (in production use TWAP or mid)
        emit Fill(taker, maker, takerLong, price, size);
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
            // Reducing or closing: opposite side — realize PnL on the closed amount
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
        Position memory pos = positions[trader];
        if (pos.size == 0) revert NotLiquidatable();
        uint256 maint = getMaintenanceMargin(pos.size, pos.entryPrice);
        if (getEquity(trader) >= maint) revert NotLiquidatable();

        uint256 closePrice = markPrice;
        int256 pnl = EventPerpMath.pnl(
            pos.isLong ? int256(pos.size) : -int256(pos.size),
            pos.entryPrice,
            closePrice,
            pos.isLong
        );
        if (pnl > 0) collateralBalance[trader] += uint256(pnl);
        else collateralBalance[trader] -= uint256(-pnl);

        uint256 penalty = (pos.size * pos.entryPrice * liquidationPenaltyBps) / (PRECISION * 10000);
        uint256 reward = (penalty * liquidatorRewardBps) / (liquidationPenaltyBps);
        uint256 fromTrader = penalty <= collateralBalance[trader] ? penalty : collateralBalance[trader];
        collateralBalance[trader] -= fromTrader;
        collateralBalance[msg.sender] += reward;
        if (fromTrader >= reward) {
            insuranceFund += (fromTrader - reward);
        } else {
            insuranceFund -= (reward - fromTrader); // insurance covers liquidator reward shortfall
        }

        delete positions[trader];
        emit Liquidate(trader, msg.sender, pos.size, penalty);
    }

    // ─────────── Funding Engine ───────────

    function setIndexPrice(uint256 _indexPrice) external onlyFactory {
        indexPrice = _indexPrice;
        emit IndexPriceUpdated(_indexPrice);
    }

    function updateFunding() public whenNotResolved {
        uint256 elapsed = block.timestamp - lastFundingTime;
        if (elapsed < fundingPeriod) return;
        uint256 periods = elapsed / fundingPeriod;
        lastFundingTime += periods * fundingPeriod;
        // funding rate = (mark - index) per period; longs pay shorts if mark > index
        int256 rate = int256(markPrice) - int256(indexPrice);
        fundingIndex += uint256(rate * int256(periods));
        emit FundingUpdated(fundingIndex, rate);
    }

    function settleFunding(address trader) internal {
        Position storage pos = positions[trader];
        if (pos.size == 0) return;
        // funding payment = size * (currentIndex - lastIndex) / PRECISION; long pays when index rises
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

    /// @dev After resolution, traders can settle and withdraw
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

    // ─────────── View helpers ───────────

    function getOpenInterest() external pure returns (uint256 longOi, uint256 shortOi) {
        // Track in state or iterate positions for full OI; stub for interface
        return (0, 0);
    }
}
