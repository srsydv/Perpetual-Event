# Event Perpetuals

On-chain **event perpetual** order-book protocol: trade probability (0–1) of binary events with margin, funding, and oracle resolution.

- **Price = probability** (e.g. 0.65 = 65% implied chance)
- **Perpetual-style** mechanics: no fixed expiry until oracle resolves
- **Order book**: off-chain matching + on-chain settlement (EIP-712 signed orders)
- **Margin**: USDC collateral, 5x max leverage, initial/maintenance margin
- **Funding**: mark vs index to align perp with external probability
- **Resolution**: oracle sets outcome (true/false) → final price 1 or 0

---

## Architecture

| Module | Contract | Purpose |
|--------|----------|---------|
| **1. Event Factory** | `EventFactory.sol` | Create events, set oracle, resolve, pause |
| **2. Order Book** | `EventMarket.sol` | Submit fills (signed maker + taker), update mark |
| **3. Margin Engine** | `EventMarket.sol` | Deposit/withdraw USDC, positions, equity, IM/MM |
| **4. Liquidation** | `EventMarket.sol` | Liquidate when equity < maintenance margin |
| **5. Funding** | `EventMarket.sol` | Funding rate = mark − index; longs pay shorts when mark > index |
| **6. Oracle Resolution** | `EventFactory.sol` → `EventMarket.resolve()` | Set outcome; traders settle & withdraw |

---

## Contracts

- **`EventFactory`**  
  - `createEvent(name, resolutionTime, oracle)` → eventId, market  
  - `resolveEvent(eventId, outcome)` (oracle only, after `resolutionTime`)  
  - `pauseEvent` / `unpauseEvent` (admin)  
  - `setMarketIndexPrice(eventId, indexPrice)` (admin/oracle, for funding)

- **`EventMarket`** (per event)  
  - **Margin**: `deposit(amount)`, `withdraw(amount)`  
  - **Trading**: `submitFill(taker, takerIsLong, price, size, makerOrder, signature)`  
  - **Liquidation**: `liquidate(trader)`  
  - **Funding**: `updateFunding()` (anyone); index set by factory  
  - **Resolution**: `resolve(outcome)` (factory only)  
  - **Settlement**: `settleAndWithdraw()` after resolution  

---

## Order flow (off-chain + on-chain)

1. **Maker** signs an order (EIP-712): `Order(maker, price, size, isLong, nonce, expiry)`  
2. **Relayer** matches with a taker off-chain.  
3. **Anyone** calls `submitFill(taker, takerIsLong, price, size, makerOrder, signature)` with the signed maker order and fill (price, size).  
4. Contract checks signature, nonce, expiry; updates positions, fees, mark price.

Order typehash:

```text
Order(address maker,uint256 price,uint256 size,bool isLong,uint256 nonce,uint256 expiry)
```

`makerOrder` is `abi.encode(maker, price, size, isLong, nonce, expiry)`; `signature` is ECDSA (r,s,v) of `hashOrder(Order)`.

---

## Parameters (in `EventMarket`)

| Parameter | Default | Meaning |
|-----------|--------|---------|
| Max leverage | 5x | Notional / collateral |
| Initial margin | 20% | Required to open |
| Maintenance margin | 10% | Below → liquidatable |
| Maker fee | 0.02% | Of notional |
| Taker fee | 0.05% | Of notional |
| Liquidation penalty | 5% | Of position notional |
| Liquidator reward | 2% | Of penalty |
| Funding period | 1 hour | Funding accrual interval |

Price and probability use **1e18** scale (0 to 1e18).

---

## PnL and resolution

- **Unrealized PnL**: long → `(markPrice - entryPrice) * size / 1e18`, short → `(entryPrice - markPrice) * size / 1e18`.  
- **Resolution**:  
  - Outcome **true** → settlement price = 1e18 (longs win, shorts lose).  
  - Outcome **false** → settlement price = 0 (shorts win, longs lose).  
- After resolution, traders call `settleAndWithdraw()` to realize PnL and withdraw collateral.

---

## Build & test

```bash
# Install deps (OpenZeppelin already via forge install)
forge build
forge test
```

---

## Frontend hooks (for your UI)

- **Order book UI**: use off-chain order book; on submit use `submitFill` with maker order + signature.  
- **Probability chart**: use `markPrice` (and optionally `indexPrice`) / 1e18.  
- **Funding**: next funding time from `lastFundingTime` + `fundingPeriod`; rate from (mark − index).  
- **Liquidation price**: for long, `liqPrice = entryPrice - (collateral - maintenanceMargin) * 1e18 / size` (simplified; exact formula depends on fees/funding).  
- **Open interest**: extend `EventMarket` with OI counters if needed (currently `getOpenInterest()` is a stub).

---

## Risk notes

- **Oracle**: resolution is trusted; use a secure oracle (e.g. UMA, Chainlink, or multisig).  
- **Volatility near resolution**: consider circuit breakers or resolution delay.  
- **Insurance fund**: used for liquidation shortfalls; ensure it is funded (fees, penalties).
