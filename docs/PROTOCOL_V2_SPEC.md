# Event Perpetuals V2 — Protocol Specification

This document defines the V2 protocol: order schema, pricing/index/funding formulas, liquidation rules, and invariants for production readiness. It is the single source of truth for contract and matcher implementation.

---

## 1. Order Schema

### 1.1 Canonical Order (EIP-712 and on-chain)

**Type name:** `Order`

**Fields:**

| Field       | Type      | Description |
|------------|-----------|-------------|
| maker      | address   | Order placer (signer). |
| market     | address   | EventMarket contract address (verifyingContract in domain). |
| side       | bool      | true = Long (YES), false = Short (NO). |
| limitPrice | uint256   | Limit price in 1e18 (0 to 1e18). |
| size       | uint256   | Order size in collateral units (18 decimals). |
| remainingSize | uint256 | Remaining fillable size; must equal size at creation; decremented on partial fills. |
| nonce      | uint256   | Maker's per-market nonce; must match contract `nonces(maker)`. |
| expiry     | uint256   | Unix timestamp after which order is invalid. |
| salt       | bytes32   | Unique per order (e.g. orderId); used for cancel and idempotency. |

**EIP-712 domain:** `name = "EventPerpetual", version = "2", chainId, verifyingContract = market`.

**On-chain encoding for submitFill:** `abi.encode(maker, limitPrice, size, remainingSize, sideAsUint, nonce, expiry, salt)`. Contract may use `orderHash = keccak256(abi.encode(...))` for tracking fill/cancel state.

**Order lifecycle:** Created (signed) → Live → Partially filled (remainingSize reduced) → Filled (remainingSize = 0) or Canceled. Cancellation is off-chain (signature invalidated by nonce increment) or on-chain cancel of orderHash.

### 1.2 Matcher / API Order Representation

For API and off-chain book:

```json
{
  "orderId": "0x...",
  "maker": "0x...",
  "market": "0x...",
  "side": "long",
  "limitPrice": "0.5e18",
  "size": "100e18",
  "remainingSize": "100e18",
  "nonce": "0",
  "expiry": 1735689600,
  "salt": "0x...",
  "signature": "0x...",
  "createdAt": 1733000000
}
```

`orderId` = `keccak256(abi.encodePacked(market, maker, salt))` or similar deterministic id. Matcher must reconcile `remainingSize` with on-chain fill events.

---

## 2. Pricing and Index

### 2.1 Price Scale

- All prices use **PRECISION = 1e18**. Valid range [0, 1e18].
- Probability (YES) = price / 1e18; (NO) = 1 - price/1e18.

### 2.2 Mark Price (per market)

**Update rule on fill:** Hybrid EMA + optional index clamp.

1. **EMA:**  
   `nextMark = (markPrice * (10000 - alphaBps) + tradePrice * alphaBps) / 10000`  
   - `alphaBps` in basis points (e.g. 2000 = 20% weight to last trade).  
   - If `markPrice == 0`, `nextMark = tradePrice`.

2. **Index clamp (when indexPrice > 0 and maxMarkDeviationBps > 0):**  
   - `upper = indexPrice * (10000 + maxMarkDeviationBps) / 10000`  
   - `lower = indexPrice * (10000 - maxMarkDeviationBps) / 10000`  
   - `nextMark = clamp(nextMark, lower, upper)`.

3. **Optional (V2):** Min notional for mark impact; max price step per block; TWAP window for funding. Specified in market config.

### 2.3 Index Price

- **Source:** Set by factory/oracle via `setIndexPrice(eventId, indexPrice)`.
- **Staleness:** If index is not updated within `indexStalenessSeconds`, market may enter **close-only mode** (no new opens; funding may freeze).
- **Valid range:** [0, 1e18]. Invalid/zero can trigger close-only or funding freeze per config.

### 2.4 Funding

**Per-interval rate (premium):**  
`rate = clamp(markPrice - indexPrice, rateFloor, rateCap)`  
- `rateFloor`, `rateCap` in 1e18 units per period (e.g. -0.01 to +0.01).

**Cumulative funding index:**  
`fundingIndex += rate * periods` (signed).  
Period length = `fundingPeriod` (e.g. 1 hour).

**Settlement per trader:**  
`accrued = (fundingIndex - pos.lastFundingIndex) * pos.size / PRECISION`  
- Long: pays when accrued > 0 (mark > index).  
- Short: receives when accrued > 0.  
Then `collateralBalance` adjusted; `pos.lastFundingIndex = fundingIndex`.

**Invariant:** Sum of all funding payments (signed) across traders equals zero (longs pay shorts).

---

## 3. Margin and Risk

### 3.1 Equity

`equity(trader) = collateralBalance[trader] + unrealizedPnL(markPrice)`  
Unrealized PnL: long `size * (mark - entry) / PRECISION`, short `size * (entry - mark) / PRECISION`.

### 3.2 Initial Margin (open/increase)

`initialMarginRequired = size * price * initialMarginBps / (PRECISION * 10000)`.  
Required to open or add: `equity >= initialMarginRequired` for the new exposure.

### 3.3 Maintenance Margin (liquidation threshold)

`maintenanceMargin = size * entryPrice * maintenanceMarginBps / (PRECISION * 10000)`.  
Liquidatable when `equity < maintenanceMargin`.

### 3.4 Close-Only Mode

When enabled (e.g. stale index, admin pause): no new opens; only reduce/close and withdraw allowed.

---

## 4. Liquidation

### 4.1 Condition

`getEquity(trader) < getMaintenanceMargin(pos.size, pos.entryPrice)` and market not resolved.

### 4.2 Flow (deterministic)

1. **Settle funding** for trader.
2. **Realize PnL** at current mark: update `collateralBalance` with PnL.
3. **Penalty:** `penalty = pos.size * pos.entryPrice * liquidationPenaltyBps / (PRECISION * 10000)`.
4. **Reward:** `reward = penalty * liquidatorRewardBps / liquidationPenaltyBps`.
5. Deduct from trader: `fromTrader = min(penalty, collateralBalance[trader])`; `collateralBalance[trader] -= fromTrader`.
6. Credit liquidator: `collateralBalance[liquidator] += reward`.
7. Remainder to insurance fund: `insuranceFund += (fromTrader - reward)` (or draw from insurance if reward > fromTrader).
8. **Delete position** for trader.

### 4.3 Partial Liquidation (V2 optional)

Liquidate up to a cap (e.g. 50% of position) per call so multiple liquidators can share; repeat until position closed or equity >= maintenance.

### 4.4 Invariants

- Total collateral in contract = sum of `collateralBalance` + insuranceFund (no leaks).
- Liquidation penalty/reward accounting: `fromTrader >= reward` in normal case; shortfall covered by insuranceFund.

---

## 5. Resolution and Settlement

- **Resolution:** Factory calls `resolve(outcome)` on market; `outcome` true = YES, false = NO.
- **Settlement price:** 1e18 if YES, 0 if NO.
- **Settle and withdraw:** Each trader calls `settleAndWithdraw()`; PnL at settlement price applied to balance; full balance transferred out; position cleared.

---

## 6. Invariants (must hold at all times)

1. **Collateral conservation:** Sum of all `collateralBalance` + `insuranceFund` = total collateral held by market contract (no mint/burn of collateral).
2. **Long/short balance:** Sum of long position sizes = sum of short position sizes (open interest balanced).
3. **Funding zero-sum:** Sum over traders of funding payments (signed) = 0 each period.
4. **Nonce monotonicity:** For each maker, nonce only increases; each used once per fill/cancel.
5. **Order validity:** Fills only when signature valid, nonce matches, expiry > now, remainingSize >= fill size, maker != taker, opposite sides.
6. **Margin:** After every state change, every trader with open position has `equity >= maintenanceMargin` or is liquidatable (then liquidation restores safety).

---

## 7. Migration from V1

- V1 orders use single-use nonce (no remainingSize). V2 introduces optional remainingSize and orderHash tracking; backward compatibility: V2 contract can still accept V1-style orders (full fill, nonce increment) until migration cutover.
- Mark: V1 last-trade; V2 EMA + clamp. Deploy with same proxy/beacon; upgrade implementation only.
- No change to collateral or position structure; only order encoding and mark/funding/liquidation logic extended.

---

## 8. Event Schemas (for indexer / matcher)

**Fill:** `Fill(taker, maker, takerLong, price, size)`  
**OrderCanceled:** (V2) `OrderCanceled(maker, orderHash)`  
**FundingUpdated:** `FundingUpdated(newFundingIndex, rate)`  
**MarginUpdated:** (V2 optional) `MarginUpdated(trader, balanceDelta)`  
**Liquidate:** `Liquidate(trader, liquidator, size, penalty)`  
**Resolved:** `Resolved(outcome)`

---

*Document version: 1.0. Last updated: per plan.*
