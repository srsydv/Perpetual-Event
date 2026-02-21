# Event Perpetuals

EventMarketUpgradeable impl: 0x76A6b904b05633d00415E31Ec7373b27fcDBd847
Market Beacon: 0xF0A7f29F5F7278339Af058F33f188C26A6F0765a
EventFactoryUpgradeable impl: 0x2f697DD5247f58982D79a6a0E3d50f81cE9C89E7
EventFactory proxy (use this): 0xE7bdA6634dC55F68e9a878fdf29C4b34DE2d2a03




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

## Where is leverage used? How do you get “extra” vs normal event protocols?

### Where leverage appears in the code

Leverage is **not** a separate “loan” — it comes from **margin rules**:

- **Initial margin** = 20% of **notional** (position size × price). So to open a position, the contract requires:  
  `equity >= getInitialMarginRequired(size, price)` = 20% of notional.
- That implies: **notional can be up to 5× your equity** (100% ÷ 20% = 5). So **max leverage = 5x**.
- This is enforced in **`_checkMargin`** in `EventMarket.sol`: when you **open or increase** a position (`addSize > 0`), it checks `equity >= getInitialMarginRequired(addSize, addPrice)`. If you don’t have enough margin, `InsufficientMargin` is reverted.
- **Maintenance margin** = 10% of notional. If your **equity** (collateral + unrealized PnL) falls below this, you can be **liquidated**. So you can stay in the trade until you’re “only” 10% of notional above water — that’s the downside of leverage.

So: **leverage = being allowed to open a notional that is 5× your collateral**, enforced by the initial-margin check. The variable `maxLeverage = 5` in the contract is the design choice; the actual limit is applied via `initialMarginBps = 2000` (20%).

### How you get “extra” money compared to normal event protocols

- **Normal event / prediction market** (e.g. buy YES/NO shares):  
  Usually **1:1** — you put **$100** to get **$100** of exposure. If the outcome goes your way, you might double (e.g. $100 → $200). So **no leverage**: same capital, same exposure.

- **Event perpetual with 5x leverage**:  
  You put **$100** as collateral. The contract allows you to open a position with **notional up to $500** (5×). So:
  - **Same $100** controls **$500** of exposure.
  - If price moves **10%** in your favor on that notional, your PnL is **10% × $500 = $50** on your **$100** → **50% return**.
  - In a normal 1:1 event, $100 exposure would give **10% × $100 = $10** → **10% return**.

So the “extra money” is **amplified PnL**: for the same amount of collateral you get **5× the exposure**, so **5× the profit** (and **5× the loss**) per percent move. You’re not “given” free money — you’re allowed to take a **bigger position** with the same cash, so gains and losses are both larger. That’s the trade-off vs normal event protocols.

---

## Long vs short: is there always a counterparty? What if no one shorts?

**Yes — every long is matched with an equal short.**  
In this protocol there is **no** AMM or pool that “takes the other side.” Every fill is **one long vs one short**, same size:

- If Alice **buys 100** (long 100 at 2x leverage), she is matched with someone who **sells 100** (short 100). That counterparty can also use leverage (e.g. 2x) on their side. So: **100 long (Alice) ↔ 100 short (maker)**. Open interest is balanced: total long size = total short size.
- The contract enforces this: in `submitFill`, taker and maker must be on **opposite** sides (`takerIsLong != makerLong`). If you try to match two longs (or two shorts), the call reverts. So there is **no** “single-sided” trade.

**What if no one wants to short?**  
Then the long order **cannot be filled**. There is no automatic counterparty. So:

- If you want to go **long** and nobody has placed a **sell (short)** order at your price (or better), your order has **no match** — it stays on the book or never executes until someone comes in to **short**.
- So **liquidity** depends on having both sides: people willing to go long **and** people willing to go short at various prices. Market makers / market takers provide that. If the market is one-sided (everyone wants long, no one short), longs will only get filled when someone is willing to take the short side — possibly at a worse price (e.g. you have to “pay up” to get filled).

So: **same size long and short always; no short = no fill for the long.**

---

## PnL and resolution

- **Unrealized PnL**: long → `(markPrice - entryPrice) * size / 1e18`, short → `(entryPrice - markPrice) * size / 1e18`.  
- **Resolution**:  
  - Outcome **true** → settlement price = 1e18 (longs win, shorts lose).  
  - Outcome **false** → settlement price = 0 (shorts win, longs lose).  
- After resolution, traders call `settleAndWithdraw()` to realize PnL and withdraw collateral.

---

## Deep example: Long in profit → selling to close

Walkthrough: **Alice opens a long, price goes up (she’s in profit), then she closes by “selling”**. Prices use **1e18** (e.g. 0.65 = 65% probability).

---

### Simple idea first

- **Long** = you’re betting the event **will happen** (price will go toward 1).  
- **Short** = you’re betting it **won’t** (price will go toward 0).  
- To **open** a long, someone must **sell** to you (you buy from them).  
- To **close** a long, you must **sell** to someone (they buy from you).

**What is “100” when we say “sell 100 at 0.60”?**  
- **100** = **size** = how many **units** of the bet you’re trading (like “100 shares” or “100 contracts”).  
- It’s the **quantity**, not the price. The **price** is 0.60 (60% probability).  
- **Notional** (exposure) = size × price. So 100 × 0.60 = **60** in the same units (e.g. 60 “dollar-equivalent” if 1 unit at price 1 = $1).  
- In the contract, size and price both use **1e18** scaling, so we’d say size = 100e18, price = 0.60e18. So “100” here just means **100 units** of the event contract.

---

### 1. Setup (the “table” and the players)

- **The market**: One event, e.g. “Will BTC > $100k by Dec 2026?”. The contract is like a single table for this question. You use **USDC** as collateral.
- **Alice**: She has **1,000 USDC** in the contract (she already deposited). She wants to **bet YES** (go long).
- **Bob**: We’ll use him later when Alice wants to close. For now he’s just there.

So: one event, one market, Alice has cash in, and she wants to open a **long** (bet YES).

---

### 2. How Alice opens a long (she buys from someone who is selling)

For Alice to go long, **someone else** must be on the other side: **selling** (betting NO or just exiting). Think of it like this:

- **Maker** = the person who **already put an order on the book**: “I’ll sell 100 contracts at 0.60 (60%)”. They signed that order and left it for others to hit.
- **Taker** = the person who **takes that order**: “I’ll buy at your 0.60”. That’s Alice.

So:

- **Maker**: “I sell 100 at 0.60” (short side of the trade).
- **Taker (Alice)**: “I buy 100 at 0.60” (long side of the trade).

In code we say:

- **Taker** = Alice  
- **takerIsLong** = **true** (Alice is **buying** = going long)  
- **price** = 0.60, **size** = 100  
- **Maker** = the one who signed the sell order (their order + signature are in `makerOrder` and `signature`).

When someone (e.g. a relayer) calls:

```text
submitFill(Alice, true, 0.60e18, 100e18, makerOrder, signature)
```

that means: “Alice (taker) is **buying** 100 at 0.60, matched with this maker’s **sell** order.”

**What actually happens on-chain:**

1. Funding is settled for both sides (if any time passed).
2. Alice’s position is created: **long 100 @ 0.60** (she “owns” 100 contracts at an entry of 60%).
3. The maker’s position: **short 100 @ 0.60** (they owe 100 contracts at 60%).
4. Small fees are taken from both (taker fee from Alice, maker fee from the maker).
5. The “mark price” for the market is set to 0.60 (last trade price).

**Alice after opening:**  
She still has roughly **1,000 USDC** minus the small taker fee. She now has a **position**: long 100 @ 0.60. So she’s betting YES at 60%; if the price goes up, she’s in profit; if it goes down, she’s in loss.

### 3. Price moves up — Alice is in profit

- **Mark price** moves to **0.72** (e.g. from other trades).
- **Unrealized PnL** (long): `(0.72 − 0.60) × 100 = 12` (in 1e18 units).
- **Equity** = collateral + 12 (plus/minus any funding).
- She wants to lock in profit by **selling** (closing the long).

### 4. Alice “sells” to close — she’s the taker on the sell side

To close a **long**, you must **sell** the same (or less) size. So:

- **Taker** = Alice, **takerIsLong = false** (sell = short side of this trade).
- **Maker** = Bob, with a signed **buy (long)** order, e.g. 100 @ 0.71.
- Relayer calls:
  ```text
  submitFill(Alice, false, 0.71e18, 100e18, bobMakerOrder, bobSignature)
  ```

**What the contract does (order of steps):**

1. **updateFunding()** — advance funding index if a period has passed.
2. **settleFunding(Alice)** and **settleFunding(Bob)** — apply accrued funding to collateral, update `lastFundingIndex`.
3. **Checks**: Bob’s signature/nonce/expiry; Alice (sell) vs Bob (buy) = opposite sides ✓.
4. **_executeFill**:
   - **Alice (taker, short side)**  
     - Current: long 100 @ 0.60. Incoming: short 100 @ 0.71 (same size, opposite).  
     - Contract: “reducing/closing” → **realize PnL** on 100: `(0.71 − 0.60) × 100 = 11` → **credit 11 to Alice’s collateral**. Then set position to **flat** (size 0).
   - **Bob (maker, long side)**  
     - Incoming: long 100 @ 0.71 → Bob now has **long 100 @ 0.71**.
   - **Fees**: notional = 100 × 0.71; taker fee (Alice), maker fee (Bob) deducted; to insurance fund.
   - **markPrice** = 0.71.

**Alice after close:**

- **Position**: 0 (flat).
- **Collateral**: 1000 − open_fee − close_fee **+ 11** (realized PnL).
- She can **withdraw** the extra 11 (minus any funding paid) as profit.

So the full path is: **deposit → open long (submitFill buy) → mark moves up → close by selling (submitFill sell) → PnL realized into balance → withdraw.**

---

## Edge cases (long in profit, then sell)

### 1. Partial close

- Alice is **long 100 @ 0.60**, mark = 0.72. She sells **40** (taker, takerIsLong = false, size = 40).
- Contract: realizes PnL on **40** only: `(0.72 − 0.60) × 40 = 4.8` → added to her collateral. Position becomes **long 60 @ 0.60** (entry unchanged).
- Remaining unrealized PnL on 60: `(mark − 0.60) × 60`.

### 2. Fees push equity below maintenance right after close

- Margin is checked **before** fees are applied in the same fill. So: after position update and PnL credit, `_checkMargin` passes; then taker fee is deducted.
- **Edge case**: If her balance was barely above maintenance and the **taker fee** is large, after the fill she could be **below maintenance** with **no position** (flat). She can’t be liquidated (no position), but next time she opens, she might need to add collateral or open smaller. No revert on close.

### 3. Slippage / worse fill price

- Alice expects to close at ~0.72 but the fill is at **0.68** (maker’s limit).
- Realized PnL = `(0.68 − 0.60) × 100 = 8` (still profit, but less). So “selling” doesn’t guarantee mark price — it’s the **fill price** that matters. Frontend should show “close at market” as an estimate and/or use limit “sell” orders.

### 4. Event resolves before she closes

- If the **oracle resolves** (e.g. TRUE) before Alice submits her sell:
  - Market is **resolved**; `submitFill` reverts (`EventResolved`).
  - She can only **settleAndWithdraw()**: settlement price = 1 (outcome true), so her long 100 @ 0.60 gets PnL `(1 − 0.60) × 100 = 40` credited on settlement. So she still gets the profit, but at **resolution price**, not at the last mark.

### 5. She gets liquidated before closing

- If mark **drops** so much that equity < maintenance margin, someone can call **liquidate(Alice)**.
  - Position is closed at **mark** (not at her desired sell price). **Liquidation penalty** (e.g. 5%) is applied; liquidator gets a reward; rest to insurance (or from insurance if balance is short).
  - So “in profit” can turn into “liquidated” if she doesn’t close or add collateral in time when price moves against her.

### 6. Funding erodes profit

- Before she closes, **funding** is settled (e.g. mark > index → longs pay). So her **collateral** may already be reduced by funding payments. Her “sell to close” still realizes **trading PnL** at the fill price; total profit = trading PnL − funding paid (and fees). So the **net** profit can be less than (mark − entry) × size if funding was heavy.

### 7. Maker order size smaller than her position

- Alice wants to close 100, but the matched maker order is only **50**.
  - **fillSize** = min(100, 50) = **50**. So she closes **50** only: PnL on 50 credited; position becomes long **50** @ 0.60. She needs another fill (or multiple) to close the remaining 50.

### 8. Mark price not updated yet

- **Mark** is set to the **last fill price**. If no one has traded for a while, mark might be stale. So:
  - **Equity** (and liquidation) use this stale mark.
  - Her **fill price** when she sells can be different from the displayed mark (e.g. from an off-chain order book). So “sell at market” can differ from the last mark; the actual realized PnL is **fill price − entry**, not mark − entry.

---

## Build & test

**Foundry:**
```bash
forge build
forge test
```

**Hardhat** (for compile + deploy):
```bash
npm install
npx hardhat compile
```

---

## Deploy (Hardhat)

Deployment uses **Hardhat**. Set `.env` with `SEPOLIA_RPC_URL` and `PRIVATE_KEY`. Optional: `COLLATERAL`, `ADMIN` (defaults: collateral `0x799a5570318c0C5Fcfd09b0f573335B5aa8d85Ff`, admin = deployer).

**Deploy upgradeable contracts to Sepolia:**
```bash
npm run deploy:sepolia
# or
npx hardhat run scripts/deploy-upgradeable.js --network sepolia
```

After a successful deploy, **`deploy-addresses.sepolia.json`** is written with `chainId`, `collateral`, `eventFactoryProxy`, `marketBeacon`, and implementation addresses. Use **`eventFactoryProxy`** as the factory address in your frontend.

### Which address is which?

| What you need | JSON key | Meaning |
|---------------|----------|--------|
| **EventFactoryUpgradeable (use this)** | `eventFactoryProxy` | The factory you call: `createEvent()`, `resolveEvent()`, `getEvent()`, etc. This is the **proxy**; use it in the frontend. |
| EventFactoryUpgradeable (logic only) | `eventFactoryImplementation` | Implementation contract; used for upgrades, not for normal calls. |
| **EventMarketUpgradeable (logic only)** | `eventMarketImplementation` | Single implementation for all event markets. Not a “market” by itself. |
| Each event market | from `factory.createEvent()` | Each event has its **own** market address (a BeaconProxy). Call `createEvent(...)` and use the returned `market` address for that event (deposit, submitFill, etc.). |

So: **EventFactoryUpgradeable contract address** = **`eventFactoryProxy`**. **EventMarketUpgradeable** has one shared **implementation** address = **`eventMarketImplementation`**; each **event market** address comes from **`factory.createEvent()`** (different per event).

### Verify on Sepolia Etherscan

Add **`ETHERSCAN_API_KEY`** to `.env` (get one at [etherscan.io/myapikey](https://etherscan.io/myapikey)).

**Option A – Verify all (run after deploy):**
```bash
npx hardhat run scripts/verify-sepolia.js --network sepolia
```

**Option B – Verify one by one:** (replace `YOUR_ADMIN_ADDRESS` with the admin/deployer address used when you deployed)
```bash
# EventMarketUpgradeable implementation (no constructor args)
npx hardhat verify --network sepolia 0x76A6b904b05633d00415E31Ec7373b27fcDBd847

# UpgradeableBeacon (beaconAddress, implementation, owner) — 2 args: implementation, owner
npx hardhat verify --network sepolia 0xF0A7f29F5F7278339Af058F33f188C26A6F0765a 0x76A6b904b05633d00415E31Ec7373b27fcDBd847 YOUR_ADMIN_ADDRESS

# EventFactoryUpgradeable implementation (no constructor args)
npx hardhat verify --network sepolia 0x2f697DD5247f58982D79a6a0E3d50f81cE9C89E7

# Factory proxy needs encoded initData; use "npm run verify:sepolia" for the proxy.
```

Use addresses from your **`deploy-addresses.sepolia.json`** if you redeployed (they will differ). For UpgradeableBeacon, `YOUR_ADMIN_ADDRESS` is the same as the deployer/admin (e.g. `0xf69F75EB0c72171AfF58D79973819B6A3038f39f` if that was your deployer).

---

## Upgradeable contracts

The protocol can be deployed in an **upgradeable** way so that factory and market logic can be upgraded without migrating state.

### Layout

| Contract | Role | Upgrade mechanism |
|----------|------|-------------------|
| **EventFactoryUpgradeable** | Factory logic | UUPS proxy: upgrade via `upgradeToAndCall(newImpl, data)` (admin only) |
| **EventMarketUpgradeable** | Market logic for all events | Beacon: one implementation, many proxies; upgrade via `UpgradeableBeacon.upgradeTo(newImpl)` (beacon owner) |

- **Factory**: Use an **ERC1967Proxy** pointing to `EventFactoryUpgradeable`. Call `initialize(collateral, admin, marketBeacon)` in the proxy constructor. Interact with the **proxy** address as the factory. Only **admin** can call `upgradeToAndCall` to point the proxy to a new factory implementation.
- **Markets**: Each event is a **BeaconProxy** that delegatecalls to the implementation set in **UpgradeableBeacon**. Deploy one `EventMarketUpgradeable` implementation, deploy a **Beacon(implementation, owner)**. Factory’s `createEvent` deploys `new BeaconProxy(beacon, initData)` and passes `EventMarketUpgradeable.initialize(collateral, factory, eventId)` as `initData`. To upgrade **all** markets at once, the beacon owner calls `beacon.upgradeTo(newEventMarketImpl)`.

### Deploy (upgradeable)

Use **Hardhat** (see **Deploy (Hardhat)** above) or **Foundry**:

1. Deploy **EventMarketUpgradeable** (implementation, no state).
2. Deploy **UpgradeableBeacon**(marketImpl, admin).
3. Deploy **EventFactoryUpgradeable** (implementation).
4. Deploy **ERC1967Proxy**(factoryImpl, initialize(collateral, admin, beacon)).
5. Use **address(proxy)** as the factory.

**Foundry** (optional): `./script/deploy-sepolia.sh` or `forge script script/DeployUpgradeable.s.sol:DeployUpgradeableScript --rpc-url $SEPOLIA_RPC_URL --broadcast`

### Upgrade

- **Upgrade factory**: Deploy new `EventFactoryUpgradeable` impl, then as admin call `factory.upgradeToAndCall(newFactoryImpl, "")`. Existing event IDs and market addresses are unchanged; only factory logic (e.g. access control, createEvent) changes.
- **Upgrade all markets**: Deploy new `EventMarketUpgradeable` impl, then as beacon owner call `beacon.upgradeTo(newMarketImpl)`. Every BeaconProxy (each event market) will use the new implementation on the next call. **Do not change storage layout** between versions (append only, or use a storage gap).

### Files

- `src/EventFactoryUpgradeable.sol` — UUPS-upgradeable factory; creates markets via BeaconProxy.
- `src/EventMarketUpgradeable.sol` — Market implementation for BeaconProxy; use `initialize()` (no constructor state).
- `src/upgradeable/EIP712Initializable.sol` — EIP-712 domain for upgradeable market (set in initializer).
- **Hardhat**: `scripts/deploy-upgradeable.js` — Deploy script; writes `deploy-addresses.sepolia.json`.
- **Foundry**: `script/DeployUpgradeable.s.sol`, `script/deploy-sepolia.sh`.
- `test/EventPerpetualUpgradeable.t.sol` — Foundry tests for upgradeable flow.

Non-upgradeable versions remain: **EventFactory** and **EventMarket** (constructor-based, for simple deployments).

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
