# xStocks Grid — Prediction Market for xStocks Tokenized Equities

A Chart.win-style binary prediction grid built **on top of** the xStocks platform.

Users bring real xStocks tokens (xAAPL, xTSLA, xNVDA, …) — tokenized equities issued 1:1 against the underlying share by xStocks. They bet those tokens on price-level cells in a time/price grid. Win → receive more of the same xStocks token. Lock winnings as collateral → borrow USDC to play the next round without selling.

We don't mint or issue any stock tokens. xStocks handles that. We're the prediction game layer.

---

## How xStocks tokens work (relevant to us)

- xAAPL, xTSLA, etc. are real ERC-20s deployed by xStocks on EVM chains (Ethereum, Mantle, Ink, …)
- Each token is backed 1:1 by the underlying share
- `balanceOf()` already returns the correct adjusted balance (rebasing handles splits/dividends)
- Users acquire them via the xStocks platform (xChange RFQ, market flow, etc.) — not through us
- Contract addresses per token per chain: available from xStocks Assets API

Prices for our grid come from the xStocks API:
- `/public/assets/{symbol}/price-data` — price from Nasdaq + onchain providers
- Our backend fetches this and pushes it on-chain to `PriceFeed.sol`

---

## Architecture

```
 xStocks API
 /public/assets/{symbol}/price-data
         │
         │  (backend polls every tick)
         ▼
   Backend (Node / Socket.IO)
         │
         │  pushes prices + market state + resolution data on-chain
         ▼
    PriceFeed.sol              ◀── backend hot wallet writes here
    /         \
   ▼           ▼
xStocksGrid   xStockVault
   ▲               ▲
   │               │
   └── real xStocks ERC-20s (xAAPL, xTSLA, …) ──┘
       (user wallets hold these, not us)
```

---

## Mathematical Model

### Geometric Brownian Motion

Stock prices follow GBM:
```
dS = μS dt + σS dW
```

Log returns are normally distributed:
```
ln(S_T / S_0) ~ N(μT, σ²T)
```

### Probability of Touching a Price Level (TOUCH semantics)

A bet wins if the price ever reaches the target during the bucket — not just at bucket close.
The probability uses barrier semantics:

```
P(touch) = 2 · Φ(-|z|)

where:
  z = requiredMove / σ_window
  requiredMove = |priceTicks × tickSize| / currentPrice
  σ_window = σ_annual × √(windowSeconds / SECONDS_PER_YEAR)
  Φ = cumulative standard normal CDF
```

### Multiplier Formula

```
1. Z-score:
   z = (|priceTicks| × tickSize / currentPrice) / σ_window

2. Probability (two-tailed touch):
   P = 2 × Φ(-|z|)

3. Fair multiplier:
   mult_fair = 1 / P

4. Display multiplier (after house edge h):
   mult_display = mult_fair × (1 - h)

5. Clamped to [1.1x, 100x]
```

Uses Abramowitz & Stegun 26.2.17 rational approximation (max error < 7.5e-8) for Φ.

### Volatility Scaling

Annual volatility → time-window volatility:
```
σ_window = σ_annual × √(window_seconds / SECONDS_PER_YEAR)

Example: xAAPL (σ=25%), 30-second bucket
σ_30s = 0.25 × √(30/31536000) = 0.000244  (0.0244% per 30s)
```

### Market Hours Adjustments (Tivnan et al.)

From the paper: dislocation segments cluster at open/close periods.
```
Opening 30min:  σ_effective = σ × 2.5  (high dislocation)
Normal:         σ_effective = σ × 1.0
Closing 30min:  σ_effective = σ × 1.8
After-hours:    σ_effective = σ × 0.4
Weekend:        σ_effective = σ × 0.2
```

Higher effective vol → price more likely to reach targets → **lower multipliers** during open/close.

Market hours also affect bet limits:

| State          | Min bet      | Max bet      |
|----------------|-------------|--------------|
| Normal         | config min   | config max   |
| Opening 30min  | 3× min       | max ÷ 2      |
| After-hours    | config min   | max ÷ 2      |
| Weekend        | config min   | $10          |

---

## Token Calibration

| Token | Annual σ | Tick size | Bucket | Nearest cell (T+1, 1 tick) |
|-------|----------|-----------|--------|---------------------------|
| xAAPL | 25%      | $0.05     | 30s    | ≈1.4x                     |
| xMSFT | 28%      | $0.08     | 30s    | ≈1.4x                     |
| xGS   | 32%      | $0.15     | 60s    | ≈1.4x                     |
| xTSLA | 65%      | $0.20     | 30s    | ≈1.5x                     |
| xJPM  | 30%      | $0.10     | 60s    | ≈1.4x                     |

Tick size is calibrated so the nearest cell is ≈1.4x during normal hours — engaging but not trivial.

---

## Risk Controls

### Pool Exposure Limits

```
Single bet potential payout  ≤ 30% of free pool balance
Bucket total potential payout ≤ 30% of pool balance
Single bet USDC equivalent   ≤ 5% of pool USDC value
```

### Minimum Pool

Bets revert if the free pool balance is too small to cover potential payouts.

### Oracle Safety

- Backend requires fresh price before pushing (staleness check recommended off-chain)
- Resolution data (price, high, low) pushed only after `bucketExpiry <= block.timestamp`
- `high >= price >= low` enforced on-chain in PriceFeed

---

## What's built (v1)

| Layer | Status | Notes |
|---|---|---|
| **Frontend** | Done (demo) | TradingView-style charting — candles, watchlist, symbol switcher |
| **Backend** | Scaffold done | Socket.IO server wired for `price:update` / `grid:update` — xStocks API polling pending |
| **Smart contracts** | Done | 4 contracts below |
| **Backend → PriceFeed wiring** | Pending | Backend calls `priceFeed.setPrice()` on every tick |
| **Frontend ↔ contract wiring** | Pending | Grid overlay on chart, bet UI via viem |

---

## Smart contracts

```
contracts/
├── GridMath.sol       GBM-based multiplier math library (pure functions)
├── PriceFeed.sol      Stores prices + market state + resolution data from xStocks API
├── xStocksGrid.sol    Grid prediction market — accepts real xStocks ERC-20s
└── xStockVault.sol    70% LTV USDC borrowing against real xStocks ERC-20 collateral
```

### Deploy order

```
1. PriceFeed(backendWalletAddress)
2. xStocksGrid(usdcAddress, priceFeedAddress)
3. xStockVault(usdcAddress, priceFeedAddress)

Post-deploy setup:
  # Register each xStocks token on the grid
  grid.configureToken(
    xAAPL_address,
    annualVolBps=2500,     # 25%
    tickSizeUsdc=50000,    # $0.05 (6 dec)
    bucketSeconds=30,
    houseEdgeBps=1000,     # 10%
    minBetUsdc=1_000_000,  # $1
    maxBetUsdc=500_000_000,# $500
    gridWidth=5,
    gridHalfHeight=6
  )

  # LPs seed the house pool with real xAAPL tokens
  xAAPL.approve(gridAddress, seedAmount)
  grid.depositLiquidity(xAAPL_address, seedAmount)

  # Register collateral tokens for the vault
  vault.addSupportedToken(xAAPL_address)

  # Seed the USDC lending pool
  usdc.approve(vaultAddress, poolAmount)
  vault.fundPool(poolAmount)

  # Backend pushes first price from xStocks API
  priceFeed.setPrice(xAAPL_address, 190_240_000, isOpen=true, ...)
```

---

## Full user flow

Two entry paths, one outcome — payout is always in xStock tokens.

### Path A — Enter with USDC (no xStock tokens needed)

```
Step 1: User has USDC only.

Step 2: Frontend calls grid.previewMultiplier(xAAPL, +3, 2)
        → multiplier=x2.2, targetPrice=$190.39, payout for $100 = $220

Step 3: User picks a cell, bets USDC
        usdc.approve(gridAddress, 100_000_000)   [= $100]
        grid.placeBetWithUSDC(xAAPL_address, +3, 2, 100_000_000)

        Contract converts USDC → xAAPL token-equivalent:
          spot = $190.24 → tokenEquiv = $100 / $190.24 = 0.526 xAAPL
        GridMath computes GBM-based multiplier (e.g. 2.2x)
        Potential payout: 0.526 × 2.2 = 1.157 xAAPL tokens

Step 4: Bucket closes (60s later)
        Backend: priceFeed.setResolutionData(xAAPL, expiry, close, high, low)
        Anyone:  grid.resolveBet(betId)    ← TOUCH: wins if high >= $190.39

Step 5a WIN: grid.claimWinnings(betId) → 1.157 xAAPL tokens
             User now has stock exposure without ever owning xAAPL first

Step 5b LOSE: $100 USDC stays in usdcCollected[xAAPL]
              Admin withdraws → buys xAAPL → deposits back as LP
```

### Path B — Enter with xStocks tokens

```
Step 1: User already holds xAAPL (from xStocks platform)
        xAAPL.approve(gridAddress, 0.5e18)
        grid.placeBet(xAAPL_address, +3, 2, 0.5e18)

WIN:  Receive 0.5 × 2.2 = 1.1 xAAPL from the LP pool
LOSE: 0.5 xAAPL stays in pool (grows LP share NAV directly)
```

### After winning — borrow to keep playing

```
Step 6: User won xAAPL and wants USDC to play another round
        without selling

        xAAPL.approve(vaultAddress, wonAmount)
        vault.depositAndBorrow(xAAPL_address, wonAmount, borrowAmt)
          Locks xAAPL as collateral
          Borrows up to 70% of (xAAPL × $190.24) in USDC
          0.5% borrow fee deducted

Step 7: Borrowed USDC → placeBetWithUSDC() → loop
```

---

## Contract details

### GridMath.sol

Pure math library — no state, no imports. Used by xStocksGrid.

- `calculateMultiplier(priceTicks, timeBuckets, currentPrice, volParams, marketState)` → `(multiplier ×100, probability)`
- `computePayout(betAmount, multiplier)` → `payout`
- Implements: `_sigmaForWindow`, `_twoTailProbability`, `_normalPDF`, `_expNeg`, `_sqrt`

### PriceFeed.sol

Backend hot wallet writes here. xStocksGrid and xStockVault read here.

All prices are **6-decimal USDC** (e.g. `190_240_000` = $190.24).

- `setPrice(token, price, isOpen, isOpeningWindow, isClosingWindow, isAfterHours, isWeekend)` — price + market state in one call
- `setPriceBatch(tokens[], prices[])` — batch price updates (state unchanged)
- `setResolutionData(token, expiry, price, high, low)` — TOUCH data after bucket closes
- `setResolutionDataBatch(...)` — catch-up after downtime
- `getMarketState(token)` → `(isOpen, isOpeningWindow, isClosingWindow, isAfterHours, isWeekend)`
- `getResolutionData(token, expiry)` → `(price, high, low, available)`
- `feeder` role = backend hot wallet, rotatable by owner

### xStocksGrid.sol

- Works with any registered xStocks ERC-20 — just `configureToken(address, ...)`
- `placeBet(token, priceTicks, timeBuckets, amount)` — bet with xStocks tokens
- `placeBetWithUSDC(token, priceTicks, timeBuckets, usdcAmount)` — bet with USDC; payout always in xStock tokens
- `resolveBet(betId)` — TOUCH resolution (high ≥ target for up bets; low ≤ target for down bets)
- `resolveBets(betIds[])` — batch resolve, skips unresolvable
- `claimWinnings(betId)` — claim xStock tokens
- `claimMultiple(betIds[])` — batch claim (same token)
- `previewMultiplier(token, priceTicks, timeBuckets)` → `(multiplier, probability, targetPrice, payout100USDC)`
- `getGridMatrix(token)` → `(multipliers[][], prices[], currentPrice)` — one call to render full grid
- `depositLiquidity(token, amount)` — LP deposits xStock tokens, earns from losing bets
- `withdrawLiquidity(token, shares)` — LP redeems shares for tokens + accrued revenue
- `shareNAV(token)` — current LP share NAV in token units

### xStockVault.sol

- Collateral = real xStocks ERC-20 tokens, debt = USDC
- `deposit(token, amount)` / `borrow(token, usdcAmount)` — or combined `depositAndBorrow`
- `repay(token, usdcAmt)` — reduce debt to unlock collateral
- `withdraw(token, amt)` — pull back collateral (LTV check enforced)
- `liquidate(user, token)` — open to anyone when health < 78% threshold
- `getHealthFactor(user, token)` — BPS, ≥ 10_000 = safe
- `getMaxBorrow(user, token)` — max USDC borrowable right now
- SCALE = 1e18: `tokenAmount(18dec) × price(6dec) / 1e18 = usdcValue(6dec)`

---

## Backend integration

```typescript
// On every price tick from xStocks API
const { price, marketState } = await fetchXStocksPrice('AAPL')

await priceFeed.setPrice(
  xAAPL_address,
  toUsdc6Dec(price),        // e.g. 190_240_000 for $190.24
  marketState.isOpen,
  marketState.isOpeningWindow,
  marketState.isClosingWindow,
  marketState.isAfterHours,
  marketState.isWeekend
)

// When a bucket closes: push high/low for TOUCH resolution
const { close, high, low } = await fetchBucketRange('AAPL', fromTs, toTs)
await priceFeed.setResolutionData(xAAPL_address, bucketExpiry, close, high, low)

// Batch resolve expired bets (backend keeper)
await grid.resolveBets([...expiredBetIds])
```

---

## Build & deploy

```bash
cd contracts
forge build

# Deploy to target chain
forge script script/Deploy.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  --private-key $DEPLOYER_KEY
```

Supported chains (xStocks is live on): Ethereum, Mantle, Ink, and others.
