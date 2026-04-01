# xStocks Grid — Technical Documentation

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      FRONTEND (React)                        │
│  Grid UI  │  Price Chart  │  Bet History  │  Pool Stats      │
└─────────────────────────────────────────────────────────────┘
                    │ WebSocket (1s updates)   │ REST API
┌─────────────────────────────────────────────────────────────┐
│                   BACKEND (Node.js)                          │
│  PriceFeedService │ GridStateManager │ KeeperService         │
│  VolSurfaceUpdater │ WebSocketManager │ REST Routes           │
└─────────────────────────────────────────────────────────────┘
          │ recordPrice()          │ resolveBets()
          │ snapshotBucket()       │ depositLiquidity()
┌─────────────────────────────────────────────────────────────┐
│                   SMART CONTRACTS                            │
│                                                              │
│  ┌──────────────┐    ┌─────────────┐    ┌───────────────┐   │
│  │  xStocksGrid │    │ GridOracle  │    │   GridMath    │   │
│  │  (core game) │───▶│ (price data)│    │  (library)    │   │
│  └──────────────┘    └─────────────┘    └───────────────┘   │
│          │                                                    │
│          ▼                                                    │
│  ┌──────────────┐    ┌─────────────────────────────────────┐ │
│  │  USDC Pool   │───▶│      Euler Lending Market           │ │
│  │  (LP funds)  │    │  (yield on idle capital)            │ │
│  └──────────────┘    └─────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
          │
┌─────────────────────────────────────────────────────────────┐
│               PRICE SOURCES (Oracle Aggregation)             │
│   Chainlink     │     Pyth Network    │   Uniswap TWAP       │
│   (primary)     │     (secondary)     │   (manipulation-safe)│
└─────────────────────────────────────────────────────────────┘
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

### Probability of Touching a Price Level

For a price level L, the probability that price touches L within time T:
```
P(touch) = 2 · Φ(-|d|)

where:
  d = ln(L/S₀) / (σ√T)
  Φ = cumulative standard normal CDF

For small T (intraday):
  d ≈ (L - S₀) / (S₀ · σ · √T)
    = (priceTicks × tickSize) / (currentPrice × σ_window)
```

Note: We use "touch" (barrier) semantics rather than "end price" semantics.
This matches chart.win's UX and is more intuitive for users.

### Volatility Scaling

Annual volatility → time-window volatility:
```
σ_window = σ_annual × √(window_seconds / SECONDS_PER_YEAR)

Example: xAAPL (σ=25%), 30-second bucket
σ_30s = 0.25 × √(30/31536000)
      = 0.25 × 0.000975
      = 0.000244  (0.0244% per 30 seconds)

Expected price move = $190 × 0.000244 = $0.046 per 30s
```

### Market Hours Adjustment (Tivnan et al.)

From the paper: dislocation segments cluster at:
- Opening 30 min: 2.5× normal dislocation rate
- FOMC meetings: 1.8× rate
- Closing 30 min: 1.8× rate
- After hours: 0.4× rate

We use this to adjust σ_effective = σ_annual × vol_multiplier:
```
Opening:    σ_effective = σ × 2.5
Normal:     σ_effective = σ × 1.0
Closing:    σ_effective = σ × 1.8
After-hours:σ_effective = σ × 0.4
Weekend:    σ_effective = σ × 0.2
```

Higher effective vol → price more likely to reach targets → **lower multipliers** during open/close.

### Multiplier Formula

```
1. Z-score:
   z = requiredMove / σ_window
   requiredMove = |priceTicks × tickSize| / currentPrice

2. Probability (two-tailed touch):
   P = 2 × Φ(-|z|)

3. Fair multiplier:
   mult_fair = 1 / P

4. Display multiplier (after house edge h):
   mult_display = mult_fair × (1 - h)

5. Clamped:
   mult = clamp(mult_display, 1.1, 100.0)
```

### Normal CDF Approximation

Uses Abramowitz & Stegun 26.2.17 rational approximation (max error < 7.5e-8):
```
Φ(x) ≈ 1 - φ(x)(b₁t + b₂t² + b₃t³ + b₄t⁴ + b₅t⁵)
  where t = 1/(1 + px), p = 0.3275911
  φ(x) = (1/√2π)e^(-x²/2)

Coefficients:
  b₁ = 0.254829592
  b₂ = -0.284496736
  b₃ = 1.421413741
  b₄ = -1.453152027
  b₅ = 1.061405429
```

---

## Token Calibration Table

| Token | Annual σ | Tick Size | Bucket | Expected 30s Move | Nearest Cell Mult |
|-------|----------|-----------|--------|-------------------|-------------------|
| xAAPL | 25%      | $0.05     | 30s    | $0.046            | ≈1.4×             |
| xMSFT | 28%      | $0.08     | 30s    | $0.064            | ≈1.4×             |
| xGS   | 32%      | $0.15     | 60s    | $0.109            | ≈1.4×             |
| xTSLA | 65%      | $0.20     | 30s    | $0.122            | ≈1.5×             |
| xJPM  | 30%      | $0.10     | 60s    | $0.088            | ≈1.4×             |

Tick size is calibrated so the nearest cell (1 tick, T+1) 
is approximately 1.4× during normal market hours.
This keeps the grid engaging — not too easy, not too hard.

---

## Risk Management

### Pool Exposure Limits

```
Per-token exposure ≤ 30% of pool
Single bet ≤ 5% of pool  
Single cell ≤ 50 × maxBet
```

### Market Hours Bet Limits

| State        | Min Bet    | Max Bet      | Why                              |
|-------------|------------|--------------|----------------------------------|
| Normal       | $1         | $500         | Full operation                   |
| Opening 30m  | $3         | $250         | High vol → higher house exposure |
| Closing 30m  | $1         | $500         | Normal                           |
| After-hours  | $1         | $250         | Thin oracle data                 |
| Weekend      | $1         | $10          | Oracle unreliable                |

### Oracle Safety

- 3-source consensus required (Chainlink, Pyth, Uniswap TWAP)
- Max 1% deviation between any two sources
- Max 60-second staleness
- If any source deviates: fall back to Chainlink only
- If Chainlink fails: REVERT — no trading with bad data

---

## Contract Events for Frontend

```solidity
// New bet placed — add to pending bets list
event BetPlaced(betId, player, token, targetPrice, expiryTs, multiplier, amount, direction, priceTicks, timeBuckets);

// Bet outcome determined — show win/loss animation
event BetResolved(betId, won, payout);

// LP activity
event LiquidityDeposited(lp, amount, shares);
event LiquidityWithdrawn(lp, amount, shares);

// Safety events
event OracleDeviation(token, cl, pyth, twap);  // Show warning to user
event EmergencyPause(paused);                   // Stop all UI interactions
```

---

## WebSocket Protocol

### Client → Server

```json
// Subscribe to tokens
{ "type": "subscribe", "tokens": ["xAAPL", "xMSFT"] }

// Unsubscribe
{ "type": "unsubscribe" }

// Ping
{ "type": "ping" }
```

### Server → Client

```json
// Grid update (every 1 second)
{
  "type": "gridUpdate",
  "symbol": "xAAPL",
  "price": { "price": 190.24, "change1m": 0.08, "high1m": 190.30, "low1m": 190.18 },
  "grid": {
    "currentPrice": 190.24,
    "grid": [
      // Row 0: +5 ticks above
      [
        { "priceTicks": 5, "timeBucket": 1, "targetPrice": 190.49, "multiplier": 5.8, "displayStr": "x5.8", "expiryTs": 1705340430000 },
        { "priceTicks": 5, "timeBucket": 2, "targetPrice": 190.49, "multiplier": 4.1, "displayStr": "x4.1", "expiryTs": 1705340460000 },
        // ... cols 3,4,5
      ],
      // Row 1: +4 ticks, etc.
    ]
  }
}

// Bet resolved
{ "type": "betResolved", "betId": 142, "won": true, "payout": 320000, "symbol": "xAAPL" }

// System alert
{ "type": "alert", "message": "Oracle deviation detected for xGS", "severity": "warning" }
```

---

## Frontend Integration Guide

### Placing a Bet (ethers.js)

```typescript
import { ethers } from 'ethers';

const GRID_ABI = [
  'function placeBet(address token, int256 priceTicks, uint256 timeBuckets, uint256 amount) returns (uint256 betId, uint256 multiplier, uint256 targetPrice)',
  'function previewMultiplier(address token, int256 priceTicks, uint256 timeBuckets) view returns (uint256 multiplier, uint256 probability, uint256 targetPrice, uint256 potentialPayout100USDC)',
];

const grid = new ethers.Contract(GRID_ADDRESS, GRID_ABI, signer);

// Preview before bet (call, no gas)
const preview = await grid.previewMultiplier(XAAPL, 3n, 2n);
console.log(`Multiplier: ${Number(preview.multiplier)/100}×`);

// Approve USDC first
await usdc.approve(GRID_ADDRESS, betAmount);

// Place bet (+3 ticks, T+2 bucket, $100)
const tx = await grid.placeBet(
  XAAPL,        // token address
  3n,           // 3 ticks up
  2n,           // T+2 bucket
  100_000_000n  // $100 (6 decimals)
);
const receipt = await tx.wait();
// Parse BetPlaced event for betId
```

### Resolving & Claiming

```typescript
// Resolve (after expiry — anyone can call)
await grid.resolveBet(betId);

// Claim winnings
await grid.claimWinnings(betId);

// Batch operations (gas efficient)
await grid.resolveBets([1, 2, 3, 4, 5]);
await grid.claimMultiple([1, 3, 5]);
```

---

## Hackathon Track Alignment

### Frontend Track ✓
- Grid UI: single-click betting, no order books
- Real-time price chart overlay (like chart.win)
- Bet history with win/loss animations
- Pool stats and LP dashboard

### Strategy Track ✓  
- "Streak" smart account: auto-reinvest winnings on consecutive wins
- "Grid Scanner": automated position across multiple cells based on vol signal
- Macro-aware betting: avoid bets during FOMC windows (Tivnan paper insight)

### Borrow/Lend Track ✓
- LP deposits earn yield via Euler during idle periods
- LP token (roc-xAAPL) is an ERC-4626 vault → borrowable collateral
- Combined yield: house edge revenue + Euler APY = ~8% estimated
