# xGrid

> What if you could bet on Apple hitting $255.30 in the next 3.5 seconds, and the odds were priced by the same math that powers trillion-dollar options desks?

xGrid is a real-time prediction market for tokenized equities on Ink. You see a live stock price, a grid of multipliers, and a snake cursor racing across the screen. Click a cell, place a bet, and if the price touches your target before time runs out, you win.

Every multiplier on that grid is a live Black-Scholes barrier option, computed entirely on-chain in Solidity fixed-point math. No probability oracles. No off-chain pricing. Just Brownian motion and a 5-contract stack on Ink Sepolia.


## Inspiration

Prediction markets are boring. Binary yes/no questions, days-long resolution, zero adrenaline. Meanwhile traders stare at tick-by-tick charts making split-second calls about price direction all day.

We wanted to capture that energy and put it on-chain. The "aha" moment was realising every cell in a price-vs-time grid is mathematically a **touch digital option**: it pays out if the price *ever* hits a barrier within a time window. The pricing formula for that has existed since 1973. Black-Scholes. Geometric Brownian motion. We just had to cram it into Solidity.

xGrid is built for the Backed xStocks ecosystem. The tokenized equities (wQQQx, wSPYx) are real Backed assets. Winners can redeem gdUSD for USDC, then swap into actual xStock tokens via Backed's xChange. It's not a toy, it's infrastructure.


## What It Does

1. Pick a stock (AAPL, TSLA, QQQ, SPY, NVDA, COIN... 14 tokenized equities)
2. Pick a bet size (1, 5, 10, or 50 gdUSD)
3. Click a grid cell. Each cell = a price level + time window
4. A snake cursor sweeps across the grid following the live price
5. If price *touches* your row before the snake passes your column, you win the multiplier

Cells near the current price pay 1.5-2x (likely to hit). Cells far out pay 10-90x (long shots). The multipliers aren't arbitrary. They're the mathematically fair payout for the probability of a Brownian motion path touching that barrier, minus a 10% house edge.

The whole system: 5 smart contracts on Ink Sepolia, a React 19 frontend with silent Privy wallet signing (zero popups), real-time price feeds over Socket.io, and a unified gdUSD token where 1 gdUSD = 1 USDC always.


## How We Built It

**The on-chain math.** Stock prices follow Geometric Brownian Motion: `dS = mu*S*dt + sigma*S*dW`. For each grid cell we compute the barrier-touch probability using the reflection principle of Brownian motion:

```
P_touch = 2 * PHI(-|z|)

z = (ticks * tickSize / currentPrice) / sigma_window
sigma_window = sigma_annual * sqrt(bucketSeconds / 31536000)
multiplier = (1 / P_touch) * (1 - houseEdge)
```

The reflection principle says every Brownian path that hits a barrier and comes back has a mirror path that stays past it. That symmetry doubles the tail probability and gives you an exact closed-form answer. No Monte Carlo needed.

**Normal CDF in Solidity.** Computing PHI(x) without floating point is the hard part. We implemented Abramowitz & Stegun 26.2.17 in 18-decimal fixed-point: a 5th-degree rational polynomial, a 6-term Taylor series for exp(-x), and Babylonian sqrt. Max error < 7.5e-8. The whole thing lives in GridMath.sol, a pure stateless library.

**Market-hours volatility.** Real vol isn't constant. We scale sigma based on time of day (Tivnan et al.): 2.5x at market open (dislocation spike), 1.8x near close (rebalancing), 0.4x after hours, 0.2x weekends. The grid literally changes character depending on when you play.

**The frontend.** React 19 + Vite + wagmi 3 + Privy. A `useSnakeTrail` hook tracks the price path in real time. `useGridMatrix` fetches the full multiplier matrix from the contract every 15 seconds. Framer Motion handles cell animations, canvas-confetti fires on wins. Privy's embedded wallet with `showWalletUIs: false` means one-time approval then pure click-to-bet, no popups.

**The token model.** Single unified gdUSD (1:1 USDC backed) replaces per-stock grid tokens. Deposit USDC, get gdUSD, bet with it, redeem winnings back to USDC. An xStockVault lets you stake real xStock tokens at 70% LTV to mint gdUSD for betting. Liquidation at 78%.

**The stack:**

| Layer | Tech |
|-------|------|
| Contracts | Solidity 0.8.24, Foundry, OpenZeppelin |
| Chain | Ink Sepolia |
| Frontend | React 19, Vite, TypeScript |
| Web3 | wagmi 3, viem, Privy embedded wallet |
| Animation | Framer Motion, Canvas Confetti |
| Charts | Lightweight Charts (TradingView) |
| Real-time | Socket.io, 500ms price polling |


## Challenges We Ran Into

**The sign bug.** The A&S polynomial has alternating signs: `a1*t - a2*t^2 + a3*t^3 - a4*t^4 + a5*t^5`. Solidity is unsigned. Our first version added every term positively. The contract compiled, deployed, ran, and returned "valid" looking multipliers. They were all 100x. Every single cell. It took hours to figure out that the probability was near-zero because the polynomial was wrong. Fix: split into positive and negative accumulators, subtract at the end.

**The sqrt(2) nobody mentions.** The A&S coefficients everyone copies from Stack Overflow are for the error function, not the normal CDF. They need the input divided by sqrt(2). Without it, PHI(1.0) comes out as 0.87 instead of 0.84. We only caught this when our frontend multipliers didn't match options pricing tables.

**Pool bootstrap.** The grid needs gdUSD in the pool to pay winners. gdUSD can only be minted by the grid or vault. Chicken and egg. We added `ownerFundPool()` to mint directly into the pool for testnet seeding.

**Double popup hell.** Privy prompted twice per bet (approve + send). Fixed by pre-warming the approval on mount, checking existing allowance first, waiting for the receipt before the bet tx, and killing the wallet UI entirely.

**Nonce wars.** Deploying 5 contracts + 6 config transactions in rapid succession on Ink Sepolia. Every other tx hit `nonce too low`. Had to manually fetch and pass nonces with `cast nonce`.


## Accomplishments That We're Proud Of

Black-Scholes barrier-touch probability running fully on-chain in fixed-point Solidity. No oracles for probability, no off-chain pricing engine. GridMath.sol is a pure stateless library that computes the normal CDF from first principles every time a bet is placed.

The reflection principle of Brownian motion, implemented in uint256 arithmetic. A beautiful piece of stochastic calculus, working inside the EVM.

5 contracts, 2500+ lines of Solidity. GridMath, xStocksGrid, xStockVault, PriceFeed, gdUSD. A complete prediction market with LP pools, risk limits, and market-hours awareness.

14 stocks live with individually calibrated volatility. AAPL, NVDA, TSLA, MSFT, GOOG, AMZN, META, SPY, QQQ, IWM, JPM, GS, COIN, PLTR.

Zero-popup betting. Privy silent signing turns on-chain transactions into game clicks.

The snake. It turns a DeFi protocol into something people actually want to stare at.


## What We Learned

Fixed-point math is an art form. Implementing exp(-x), sqrt(x), and PHI(x) in uint256 taught us more about numerical analysis than university ever did.

The reflection principle is one of the most elegant results in probability theory. One symmetry argument gives you exact barrier probabilities without simulation.

UX matters more than math. The Black-Scholes engine is cool but what makes people stay is the snake animation, confetti on wins, and the fact that betting feels like one click.

Unsigned arithmetic is treacherous. One missing sign in a polynomial took us from a working market to "100x everywhere" and Solidity didn't complain once.

Testnet scaffolding isn't optional. Mock tokens, faucet functions, adjustable exposure limits. The boring stuff is what lets you iterate fast.


## What's Next for xGrid

Mainnet on Ink with real xStock tokens from Backed's xChange. Backend price feed polling Backed's API at 500ms with TOUCH resolution (high/low per bucket). LP yield dashboard showing share NAV in real time. Cross-stock spread betting (QQQ vs SPY in one grid). Mobile PWA because the snake is already touch-friendly. Tournament mode with weekly leaderboards and prize pools.


## Contracts (Ink Sepolia)

| Contract | Address |
|----------|---------|
| USDC | `0x6b57475467cd854d36Be7FB614caDa5207838943` |
| gdUSD | `0x6bc52778d12AB1D80b7b6C7A004864648090b7a9` |
| PriceFeed | `0x822872d3E57d7787f9078A869448fE481c37fcbC` |
| xStocksGrid | `0x338B6a94e8317A7BF5d00224F2e2c7c7B6BBe981` |
| xStockVault | `0xba016f01adc29022B72032F1e532BDeaaC7Cb1D3` |
