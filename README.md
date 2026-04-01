# xStocks — Grid Prediction Market for Synthetic Stocks

A Chart.win-style binary prediction grid where users bet on xStock token price levels using the same xStock tokens as their wager currency. Win → receive more xStock tokens. Lock those tokens as collateral → borrow USDC to play again. Stay in the ecosystem.

---

## What's built (v1)

| Layer | Status | Notes |
|---|---|---|
| **Frontend** | Done (demo) | TradingView-style charting UI — candles, watchlist, symbol switcher |
| **Backend** | Scaffold done | Socket.IO server wired for `price:update` / `grid:update` — core lib modules pending |
| **Smart contracts** | Done (v1) | See below |
| **Contract ↔ frontend wiring** | Pending | v2 |
| **Live oracle / keeper** | Pending | v2 — swap `MockOracle` for Pyth/Chainlink adapter |

---

## Smart contracts

```
contracts/
├── interfaces/
│   └── IOracle.sol          Oracle interface (Chainlink-compatible, 8-decimal prices)
├── mocks/
│   └── MockOracle.sol       Writable oracle for local dev / testnet
├── xStockToken.sol          USDC-backed ERC-20 synthetic stock (xAAPL, xTSLA, …)
├── xStocksGrid.sol          Grid prediction market — core betting engine
└── xStockVault.sol          70 % LTV USDC borrowing against xStock collateral
```

### Deploy order

```
1. MockOracle       (or production oracle adapter)
2. xStockToken      per synthetic stock  (e.g. xAAPL, xTSLA, xNVDA …)
3. xStocksGrid      (pass oracle address)
4. xStockVault      (pass USDC + oracle addresses)

Post-deploy:
  grid.setGridConfig(xAAPL, { tickSize, bucketSeconds, … })
  grid.fundReserve(xAAPL, reserveAmount)         ← transfer xAAPL to prize pool
  vault.addSupportedToken(xAAPL)
  vault.fundPool(usdcAmount)                     ← USDC lending pool
  xAAPL.setAuthorizedProtocol(gridAddress, true) ← only if grid needs protocolMint
```

---

## Full user flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 1  │  User has USDC                                               │
│          │  calls xAAPL.mint(190_000_000)                               │
│          │  → deposits $190 USDC, receives 1e18 xAAPL (= 1 share)      │
└──────────┴─────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 2  │  Frontend shows the grid                                     │
│          │  10 columns (time buckets, e.g. 30 s each)                  │
│          │  12 rows (price levels, e.g. $0.05 tick spacing)             │
│          │  Each cell shows a multiplier: x2 … x20                     │
└──────────┴─────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 3  │  User picks a cell and places a bet                          │
│          │  approve xAAPL to grid contract                              │
│          │  grid.placeBet(xAAPL, +2, 3, 5e17)                          │
│          │    priceLevels = +2  → target = currentPrice + 2 ticks      │
│          │    timeBuckets = 3   → expires in 3×30 s = 90 s             │
│          │    amount      = 0.5 xAAPL                                   │
│          │  Contract locks 0.5 xAAPL from user.                        │
│          │  Multiplier calculated: distScore = 2×3 = 6 → x5           │
│          │  Potential payout: 0.5 × 5 = 2.5 xAAPL                     │
└──────────┴─────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 4  │  Time bucket closes                                          │
│          │  Keeper calls oracle.setResolutionPrice(xAAPL, expiry, P)   │
│          │  Keeper calls grid.resolveCell(cellId)                       │
│          │  Contract checks: |P − target| ≤ tickSize/2                 │
└──────────┴─────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 5a │  WIN                                                         │
│          │  grid.claimWinnings(betId)                                   │
│          │  User receives 2.5 xAAPL from the house reserve             │
└──────────┴─────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 6  │  User now holds xAAPL (has stock exposure)                   │
│          │  Wants USDC to play the next game without selling            │
│          │  approve xAAPL to vault contract                             │
│          │  vault.depositAndBorrow(xAAPL, 2.5e18, maxBorrow)           │
│          │    Deposits 2.5 xAAPL as collateral                         │
│          │    Borrows up to 70 % × (2.5 × $190) = $332.50 USDC        │
│          │    0.5 % borrow fee deducted                                 │
│          │    Net USDC ≈ $330.83 sent to user                          │
└──────────┴─────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 7  │  User mints more xAAPL with borrowed USDC → plays again     │
│          │  xAAPL.mint(borrowedUsdc)                                    │
│          │  Loop back to Step 2                                         │
└──────────┴─────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 5b │  LOSE                                                        │
│          │  Bet amount stays in contract (grows house reserve)          │
│          │  User can mint more xAAPL or exit to USDC via redeem()      │
└──────────┴─────────────────────────────────────────────────────────────┘
```

---

## Contract details

### xStockToken

- ERC-20 backed 1:1 by USDC at oracle price
- `mint(usdcAmount)` → tokens at current oracle price
- `redeem(tokenAmount)` → USDC at current oracle price
- Admin tops up USDC reserve if price appreciation creates shortfall (v1 limitation; production uses delta-hedged treasury)
- `setAuthorizedProtocol(grid, true)` enables the grid to call `protocolMint` / `protocolBurn` for reward payouts

### xStocksGrid

- Grid is configured per token via `setGridConfig` (tick size, bucket duration, house edge %)
- `placeBet(token, priceLevels, timeBuckets, amount)` — bets xStock tokens
- Win condition: oracle resolution price within `tickSize/2` of target level
- Multiplier model (v1 — distance score):

  | Distance score | Displayed | Stored (`mult100`) |
  |---|---|---|
  | 1 | x2 | 180 after 10% edge |
  | 2–3 | x3 | 270 |
  | 4–6 | x5 | 450 |
  | 7–10 | x8 | 720 |
  | 11–15 | x12 | 1080 |
  | 16+ | x20 | 1800 |

- `getGridSnapshot(token)` returns the full multiplier matrix in one call — used by the frontend to render the grid without N² RPC calls
- `resolveCell(cellId)` is permissionless — anyone can call it once the bucket closes and the oracle has the resolution price
- House reserve tracked via `pendingPayouts[token]`; new bets revert if reserve is insufficient

### xStockVault

- 70% max LTV, 78% liquidation threshold, 5% liquidation bonus
- 0.5% one-time borrow fee per borrow call
- `deposit` / `borrow` / `repay` / `withdraw` — standard CDP flow
- `depositAndBorrow` — convenience: deposit collateral + borrow in one transaction
- `liquidate(user, token)` — permissionless; liquidator repays debt, receives collateral + 5% bonus
- `getHealthFactor(user, token)` — returns BPS value (≥10_000 = safe)
- `getMaxBorrow(user, token)` — returns how much USDC the user can still borrow

---

## Grid parameters (recommended per token)

| Token | Annual σ | Tick size | Bucket | Notes |
|---|---|---|---|---|
| xAAPL | 25% | $0.05 | 30 s | Nearest cell ≈ x2 |
| xMSFT | 28% | $0.05 | 30 s | |
| xTSLA | 65% | $0.10 | 30 s | Higher vol → wider ticks |
| xNVDA | 55% | $0.10 | 30 s | |
| xGS | 32% | $0.15 | 30 s | Higher price → larger tick |

---

## Build & deploy

```bash
# Install Foundry (one-time)
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Install OpenZeppelin
cd contracts
forge install OpenZeppelin/openzeppelin-contracts --no-commit

# Compile
forge build

# Run tests (once written)
forge test -vvv

# Deploy to Base Sepolia (example)
forge script script/Deploy.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC \
  --broadcast \
  --private-key $DEPLOYER_KEY
```

---

## What's coming in v2

- **Live oracle adapter** — Pyth Network feeds for xStock prices (real-time synthetic stock prices on-chain)
- **Chainlink Automation keeper** — auto-posts resolution prices and calls `resolveCell` without manual intervention
- **Z-score multiplier model** — replaces distance-score tiers with the full GBM-derived probability calculation for accurate risk pricing
- **Range-based win condition** — "price touched the level during the bucket" instead of "price at end of bucket"
- **Frontend ↔ contract integration** — Socket.IO backend pipes live prices into frontend; grid overlaid on the TradingView chart; bet UI wired to contracts via viem
- **Correlated grid** — side-by-side grids for two tokens, bet on relative performance with correlation-adjusted multipliers
- **Earnings surprise cells** — special high-multiplier cells around earnings dates using implied vol from options markets
- **Compound flow helper** — single-click `claimAndBorrow(betId, 70%)`: claims winnings, deposits to vault, borrows USDC, all in one transaction
