import { Mermaid } from "./Mermaid";

// ── Shared primitives ──────────────────────────────────────────────────────────

function H1({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="text-3xl font-bold text-white mb-3 leading-tight">
      {children}
    </h1>
  );
}
function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xl font-semibold text-white mt-10 mb-3 leading-snug flex items-center gap-2">
      {children}
    </h2>
  );
}
function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-base font-semibold text-[#ff3b8d] mt-7 mb-2">
      {children}
    </h3>
  );
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-slate-300 leading-7 mb-4 text-[15px]">{children}</p>;
}
function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-[13px] bg-[#1a2035] text-[#ff3b8d] px-1.5 py-0.5 rounded border border-[#ff3b8d]/20">
      {children}
    </code>
  );
}
function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre className="bg-[#0d1120] border border-[#ff3b8d]/15 rounded-xl p-5 text-[13px] font-mono text-slate-300 overflow-x-auto mb-5 leading-6">
      {children}
    </pre>
  );
}
function Callout({
  type = "info",
  children,
}: {
  type?: "info" | "warning" | "tip";
  children: React.ReactNode;
}) {
  const styles = {
    info:    "border-blue-500/40 bg-blue-900/10 text-blue-200",
    warning: "border-yellow-500/40 bg-yellow-900/10 text-yellow-200",
    tip:     "border-[#ff3b8d]/40 bg-[#ff3b8d]/5 text-pink-200",
  }[type];
  const icons = { info: "ℹ️", warning: "⚠️", tip: "💡" }[type];
  return (
    <div className={`border-l-4 rounded-r-xl px-5 py-4 mb-5 ${styles}`}>
      <span className="mr-2">{icons}</span>
      {children}
    </div>
  );
}
function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | React.ReactNode)[][];
}) {
  return (
    <div className="overflow-x-auto mb-6">
      <table className="w-full text-[14px] border-collapse">
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className="text-left text-[#ff3b8d] font-semibold px-4 py-2.5 border-b border-[#ff3b8d]/20 bg-[#0d1120]"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-white/5 hover:bg-white/3 transition-colors"
            >
              {row.map((cell, j) => (
                <td
                  key={j}
                  className="px-4 py-3 text-slate-300 font-mono text-[13px]"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Sections ───────────────────────────────────────────────────────────────────

export function GettingStarted() {
  return (
    <div>
      <H1>Getting Started</H1>
      <p className="text-slate-400 text-base mb-8">
        xStocks Grid is an on-chain prediction market where you bet on
        short-term price movements of tokenized stocks using <Code>gdUSD</Code>.
      </p>

      <Callout type="tip">
        xStocks Grid runs on <strong>Ink Sepolia</strong> testnet. You need a
        wallet with testnet ETH and some <Code>USDC</Code> or{" "}
        <Code>wQQQx / wSPYx</Code> tokens to get started.
      </Callout>

      <H2>Prerequisites</H2>
      <ul className="list-disc list-inside text-slate-300 space-y-2 mb-6 text-[15px] leading-7">
        <li>
          A browser wallet (or use the embedded Privy wallet — login with email,
          no extension needed)
        </li>
        <li>
          Some testnet ETH on Ink Sepolia for gas (
          <Code>chain ID 763373</Code>)
        </li>
        <li>
          <Code>USDC</Code>, <Code>wQQQx</Code>, or <Code>wSPYx</Code> on Ink
          Sepolia
        </li>
      </ul>

      <H2>Quick Start</H2>
      <div className="space-y-4 mb-8">
        {[
          ["1", "Log in", "Hit Launch App and sign in with your email. Privy creates an embedded wallet on Ink Sepolia automatically."],
          ["2", "Get gdUSD", "Go to Portfolio → Grid It. Deposit USDC 1:1 for gdUSD, or stake wQQQx / wSPYx to mint gdUSD at 70% LTV."],
          ["3", "Play the Grid", "Navigate to /gridding. Pick a stock (QQQ or SPY), choose HIGH or LOW, pick a price bucket and bet size."],
          ["4", "Win & Redeem", "If the price touches your target bucket before expiry, you win multiplied gdUSD. Redeem gdUSD → USDC anytime."],
        ].map(([num, title, desc]) => (
          <div key={num} className="flex gap-4 items-start">
            <div className="w-8 h-8 rounded-full bg-[#ff3b8d]/20 border border-[#ff3b8d]/50 flex items-center justify-center text-[#ff3b8d] font-bold text-sm shrink-0 mt-0.5">
              {num}
            </div>
            <div>
              <div className="text-white font-semibold text-[15px]">{title}</div>
              <div className="text-slate-400 text-[14px] mt-0.5">{desc}</div>
            </div>
          </div>
        ))}
      </div>

      <H2>Network Details</H2>
      <Table
        headers={["Parameter", "Value"]}
        rows={[
          ["Network", "Ink Sepolia"],
          ["Chain ID", "763373"],
          ["RPC", "https://rpc-gel-sepolia.inkonchain.com"],
          ["Currency", "ETH"],
        ]}
      />
    </div>
  );
}

export function HowToPlay() {
  return (
    <div>
      <H1>How to Play</H1>
      <P>
        xStocks Grid is a{" "}
        <strong className="text-white">touch-style prediction market</strong>.
        You bet that the price of a tokenized stock will <em>touch</em> a
        specific price level within a time window (a bucket). You don't need to
        predict the final price — just whether it will pass through a level.
      </P>

      <H2>The Grid</H2>
      <P>
        Each stock has a 5×12 grid. The Y-axis is price levels (ticks = $0.50
        apart). The X-axis is time buckets (30 seconds each). The current price
        sits in the middle row. Rows above = higher prices, rows below = lower.
      </P>

      <Mermaid
        chart={`
graph LR
  subgraph GRID["  Price Grid (wQQQx / $480)  "]
    direction TB
    R5["$481.00 ↑"]:::high
    R4["$480.50 ↑"]:::high
    R3["$480.00 ← current"]:::cur
    R2["$479.50 ↓"]:::low
    R1["$479.00 ↓"]:::low
  end
  classDef high fill:#1a2035,stroke:#22c55e,color:#86efac
  classDef cur  fill:#ff3b8d22,stroke:#ff3b8d,color:#ff3b8d
  classDef low  fill:#1a2035,stroke:#ef4444,color:#fca5a5
`}
      />

      <H2>Touch Mechanics</H2>
      <P>
        A bet wins if the price <strong className="text-white">ever touches</strong>{" "}
        the target bucket during the bucket window — not just at expiry. This is
        called <em>touch semantics</em> and means volatile moves work in your
        favour even if the price snaps back.
      </P>

      <Mermaid
        chart={`
sequenceDiagram
  participant U as User
  participant G as xStocksGrid
  participant P as PriceFeed

  U->>G: placeBet(wQQQx, bucket=+2, HIGH, 10 gdUSD)
  G->>P: latestPrice(wQQQx)
  P-->>G: $480.00
  G-->>U: Bet recorded, expiry = now + 30s

  loop Every 5s
    P->>G: setPrice(wQQQx, newPrice)
    G->>G: checkTouch(bucket=+2, $481.00?)
  end

  alt price touched $481.00 before expiry
    U->>G: claimWinnings(betId)
    G-->>U: payout = 10 gdUSD × multiplier
  else price never touched
    Note over G: Bet expires worthless
  end
`}
      />

      <H2>Multipliers</H2>
      <P>
        Multipliers are calculated from a Black-Scholes–style formula based on
        annualised volatility, time to expiry, and distance from current price.
        Further buckets = higher multiplier.
      </P>
      <Table
        headers={["Distance from price", "Approx multiplier (wQQQx 18% vol)"]}
        rows={[
          ["+1 tick ($0.50)", "~1.6×"],
          ["+2 ticks ($1.00)", "~2.5×"],
          ["+3 ticks ($1.50)", "~4.0×"],
          ["+4 ticks ($2.00)", "~6.5×"],
          ["+5 ticks ($2.50)", "~10×+"],
        ]}
      />

      <H2>Bet Limits</H2>
      <Table
        headers={["Parameter", "wQQQx", "wSPYx"]}
        rows={[
          ["Min bet", "$1 gdUSD", "$1 gdUSD"],
          ["Max bet", "$200 gdUSD", "$200 gdUSD"],
          ["Tick size", "$0.50", "$0.50"],
          ["Bucket duration", "30s", "30s"],
          ["House edge", "10%", "10%"],
        ]}
      />

      <Callout type="warning">
        Bets can only be placed when the market is <strong>open</strong>. The
        backend sets market state via <Code>PriceFeed.setPrice()</Code>. Check
        the status indicator on the grid.
      </Callout>

      <H2>Getting gdUSD to Play</H2>
      <P>
        There are two ways to get <Code>gdUSD</Code> (the grid play token):
      </P>
      <Mermaid
        chart={`
flowchart TD
  A([You]) --> B{Have USDC?}
  B -- yes --> C[depositUsdc in Portfolio]
  B -- no --> D{Have wQQQx / wSPYx?}
  D -- yes --> E[Stake via xStockVault]
  D -- no --> F[Buy USDC on Ink Sepolia]
  F --> C
  C --> G[1 USDC → 1 gdUSD]
  E --> H[Collateral × 70% LTV → gdUSD]
  G --> I([Play the Grid!])
  H --> I

  style G fill:#0d2a1a,stroke:#22c55e,color:#86efac
  style H fill:#1a1a2e,stroke:#c084fc,color:#e9d5ff
  style I fill:#2d0a1a,stroke:#ff3b8d,color:#ff3b8d
`}
      />
    </div>
  );
}

export function Architecture() {
  return (
    <div>
      <H1>Architecture</H1>
      <P>
        xStocks Grid is a fully on-chain prediction market with no off-chain
        settlement. All game logic, payouts, and token accounting live in
        Solidity contracts on Ink Sepolia.
      </P>

      <H2>System Overview</H2>
      <Mermaid
        chart={`
flowchart TB
  subgraph USER["  User  "]
    W[Wallet / Privy]
  end

  subgraph CONTRACTS["  Smart Contracts (Ink Sepolia)  "]
    PF[PriceFeed]
    GD[gdUSD Token]
    GRID[xStocksGrid]
    VAULT[xStockVault]
  end

  subgraph TOKENS["  Real-world Tokens  "]
    USDC[USDC]
    QQQ[wQQQx]
    SPY[wSPYx]
  end

  subgraph BACKEND["  Backend  "]
    BE[Price Oracle Service]
  end

  W -- stake/unstake --> VAULT
  W -- deposit/redeem USDC --> GRID
  W -- placeBet / claimWinnings --> GRID
  VAULT -- mint/burn --> GD
  GRID  -- mint/burn --> GD
  VAULT -- holds collateral --> QQQ
  VAULT -- holds collateral --> SPY
  GRID  -- holds reserves --> USDC
  BE  -- setPrice every 5s --> PF
  GRID -- reads price --> PF
  VAULT -- reads price --> PF

  style GD fill:#2d0a1a,stroke:#ff3b8d,color:#ff3b8d
  style GRID fill:#0d1a2d,stroke:#60a5fa,color:#93c5fd
  style VAULT fill:#1a0d2d,stroke:#c084fc,color:#e9d5ff
  style PF fill:#0d2a1a,stroke:#22c55e,color:#86efac
`}
      />

      <H2>Contract Roles</H2>
      <Table
        headers={["Contract", "Role"]}
        rows={[
          ["PriceFeed", "Stores latest price, market open/close state for each stock. Only the backend oracle can update it."],
          ["gdUSD (GridToken)", "ERC-20 play token. 1 gdUSD = 1 USDC always. Minted/burned by xStocksGrid and xStockVault."],
          ["xStocksGrid", "Core game contract. Manages LP pools, bet placement, touch detection, payouts, and USDC deposits."],
          ["xStockVault", "Accepts wQQQx/wSPYx as collateral, mints gdUSD at 70% LTV, handles liquidations."],
        ]}
      />

      <H2>Token Flow</H2>
      <Mermaid
        chart={`
flowchart LR
  USDC([USDC]) -- depositUsdc --> GRID[xStocksGrid]
  GRID -- mint --> GDUSD([gdUSD])
  GDUSD -- placeBet --> GRID
  GRID -- payout × multiplier --> GDUSD
  GDUSD -- redeemForUsdc --> GRID
  GRID -- burn + send USDC --> USDC2([USDC])

  STOCK([wQQQx / wSPYx]) -- stake --> VAULT[xStockVault]
  VAULT -- mint 70% LTV --> GDUSD2([gdUSD])
  GDUSD2 -- burn to unstake --> VAULT
  VAULT -- return collateral --> STOCK2([wQQQx / wSPYx])

  style GDUSD  fill:#2d0a1a,stroke:#ff3b8d,color:#ff3b8d
  style GDUSD2 fill:#2d0a1a,stroke:#ff3b8d,color:#ff3b8d
`}
      />

      <H2>Per-Stock Pool Accounting</H2>
      <P>
        Because a single <Code>gdUSD</Code> token is shared across all stocks,
        the grid contract tracks each stock's gdUSD holdings in a{" "}
        <Code>poolGdUsd[token]</Code> mapping rather than relying on{" "}
        <Code>balanceOf(address(this))</Code>, which would mix all pools
        together.
      </P>
      <Pre>{`// xStocksGrid state
mapping(address => uint256) public poolGdUsd;      // per-stock gdUSD held
mapping(address => uint256) public lockedGridTokens; // gdUSD locked in open bets

function _freePoolGT(address token) internal view returns (uint256) {
    uint256 bal = poolGdUsd[token];
    uint256 lkd = lockedGridTokens[token];
    return bal > lkd ? bal - lkd : 0;
}`}</Pre>
    </div>
  );
}

export function HowItWorks() {
  return (
    <div>
      <H1>How It Works</H1>

      <H2>Full User Journey</H2>
      <Mermaid
        chart={`
sequenceDiagram
  participant U as User
  participant V as xStockVault
  participant G as xStocksGrid
  participant T as gdUSD Token
  participant P as PriceFeed

  Note over U,P: Path A — stake real stock
  U->>V: stake(wQQQx, 1 token)
  V->>P: latestPrice(wQQQx) → $480
  V->>T: mint(user, 336 gdUSD)  [480 × 70%]
  V-->>U: 336 gdUSD received

  Note over U,P: Path B — deposit USDC
  U->>G: depositUsdc(wQQQx, 100 USDC)
  G->>T: mint(user, 100 gdUSD)
  G-->>U: 100 gdUSD received

  Note over U,P: Placing a bet
  U->>G: placeBet(wQQQx, bucket+2, HIGH, 10 gdUSD)
  G->>T: transferFrom(user→grid, 10 gdUSD)
  G->>G: lockedGridTokens[wQQQx] += 10 × maxPayout
  G-->>U: betId returned

  Note over U,P: Winning
  P-->>G: price crosses $481.00
  U->>G: claimWinnings(betId)
  G->>G: lockedGridTokens[wQQQx] -= locked
  G->>T: mint(user, payout gdUSD)
  G-->>U: payout received

  Note over U,P: Cash out
  U->>G: redeemForUsdc(wQQQx, 50 gdUSD)
  G->>T: burn(user, 50 gdUSD)
  G-->>U: 50 USDC sent
`}
      />

      <H2>Staking & LTV</H2>
      <P>
        When you stake a real tokenized stock (e.g. <Code>wQQQx</Code>), the
        vault reads the current price from <Code>PriceFeed</Code>, calculates
        the USDC value of your collateral, and mints{" "}
        <strong className="text-white">70%</strong> of that value as{" "}
        <Code>gdUSD</Code>.
      </P>
      <Pre>{`// Stake 1 wQQQx @ $480
collateralUsdc  = 1 × 480_000_000  = 480_000_000   (6 dec)
stakeUsdc       = 480_000_000 × 70% = 336_000_000   (6 dec)
gdUSD minted    = 336_000_000 × 1e12 = 336e18        (18 dec)`}</Pre>

      <H2>Liquidation</H2>
      <P>
        If the price of your collateral drops enough that your outstanding{" "}
        <Code>gdUSD</Code> debt exceeds 78% of collateral value, the position
        becomes liquidatable.
      </P>
      <Mermaid
        chart={`
flowchart TD
  A[Collateral value drops] --> B{gdUSD debt > collateral × 78%?}
  B -- no --> C[Position healthy ✓]
  B -- yes --> D[Position under-collateralised]
  D --> E[Liquidator calls liquidate()]
  E --> F[Liquidator repays all gdUSD debt]
  F --> G[Liquidator receives collateral + 5% bonus]
  G --> H[Position closed]

  style C fill:#0d2a1a,stroke:#22c55e,color:#86efac
  style D fill:#2d0a0a,stroke:#ef4444,color:#fca5a5
  style G fill:#1a0d2d,stroke:#c084fc,color:#e9d5ff
`}
      />
      <Table
        headers={["Parameter", "Value", "Description"]}
        rows={[
          ["STAKE_LTV_BPS", "7000 (70%)", "gdUSD minted at this fraction of collateral value"],
          ["LIQ_THRESHOLD_BPS", "7800 (78%)", "Liquidation triggered when debt/collateral > 78%"],
          ["LIQ_BONUS_BPS", "500 (5%)", "Extra collateral the liquidator receives"],
        ]}
      />

      <H2>Price Feed & Market State</H2>
      <P>
        The backend oracle calls <Code>PriceFeed.setPrice()</Code> every ~5
        seconds. Each call includes price plus boolean flags for market state.
      </P>
      <Pre>{`priceFeed.setPrice(
  wQQQx,
  480_000_000,   // price  (6 dec USDC per token)
  true,          // isOpen
  false,         // isOpeningWindow
  false,         // isClosingWindow
  false,         // afterHours
  false          // isHoliday
);`}</Pre>
      <P>
        Bets can only be placed when <Code>isOpen = true</Code>. The grid UI
        reads market state in real time and disables betting outside market
        hours.
      </P>

      <H2>Multiplier Formula</H2>
      <P>
        Multipliers are computed in <Code>GridMath.sol</Code> using a
        closed-form normal CDF approximation. The formula calculates the
        probability that the price touches a level using the reflection
        principle:
      </P>
      <Pre>{`// Probability of touching target given:
//   σ  = annualVolBps / 10_000
//   T  = bucketSeconds / (365 × 86400)
//   d  = |tickDistance| × tickSizeUsdc / currentPrice
//
// P(touch) ≈ 2 × Φ(−d / (σ√T))
//
// multiplier = (1 − houseEdge) / P(touch)`}</Pre>
      <Callout type="info">
        The house edge is applied on top of the theoretical fair multiplier.
        With a 10% edge, a theoretical 2.0× bet pays out 1.8×.
      </Callout>
    </div>
  );
}

export function Contracts() {
  return (
    <div>
      <H1>Contracts</H1>
      <P>All contracts are deployed on Ink Sepolia (chain ID 763373).</P>

      <H2>Deployed Addresses</H2>
      <Table
        headers={["Contract", "Address"]}
        rows={[
          ["PriceFeed", "0x19f634aCF5B2AAC5bb913F83951053dcA1E22174"],
          ["gdUSD (GridToken)", "0x1F27B2974edA52DC7AdDCCa1d34B23f4bB961E2B"],
          ["xStocksGrid", "0x63DA0B8B7904a843c0AC67c37484248dAe1294dc"],
          ["xStockVault", "0x714458e7664608589649bf305cdC4798a42b21a4"],
          ["USDC", "0x6b57475467cd854d36Be7FB614caDa5207838943"],
          ["wQQQx (Backed QQQ)", "0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9"],
          ["wSPYx (Backed SPY)", "0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e"],
        ]}
      />

      <H2>GridToken (gdUSD)</H2>
      <P>
        Minimal ERC-20 with a minter whitelist. Only{" "}
        <Code>xStocksGrid</Code> and <Code>xStockVault</Code> are minters. 1
        gdUSD is always redeemable for 1 USDC via the grid contract.
      </P>
      <Pre>{`function mint(address to, uint256 amount) external onlyMinter
function burn(address from, uint256 amount) external onlyMinter
function addMinter(address m) external  // owner only`}</Pre>

      <H2>xStocksGrid</H2>
      <H3>Key state</H3>
      <Pre>{`IERC20    public immutable usdc;
PriceFeed public priceFeed;
GridToken public gdUSD;
mapping(address => TokenConfig)  public tokenConfigs;
mapping(address => uint256)      public poolGdUsd;
mapping(address => uint256)      public lockedGridTokens;
mapping(bytes32  => Bet)         public bets;`}</Pre>

      <H3>User-facing functions</H3>
      <Table
        headers={["Function", "Description"]}
        rows={[
          ["depositUsdc(token, usdcAmount)", "Deposit USDC, mint gdUSD 1:1"],
          ["redeemForUsdc(token, gtAmount)", "Burn gdUSD, receive USDC 1:1"],
          ["placeBet(token, bucket, dir, gtAmount)", "Place a HIGH/LOW touch bet"],
          ["claimWinnings(betId)", "Claim payout if bet won"],
          ["claimMultiple(betIds[])", "Batch claim wins"],
        ]}
      />

      <H3>LP / admin functions</H3>
      <Table
        headers={["Function", "Description"]}
        rows={[
          ["depositLiquidity(token, usdcAmount)", "Owner seeds the house pool"],
          ["withdrawLiquidity(token, usdcAmount)", "Owner withdraws from pool"],
          ["configureToken(token, vol, tick, ...)", "Add/update a stock on the grid"],
        ]}
      />

      <H2>xStockVault</H2>
      <H3>Key state</H3>
      <Pre>{`PriceFeed  public priceFeed;
GridToken  public gdUSD;
xStocksGrid public grid;
mapping(address => bool) public supportedTokens;
// user => token => Position
mapping(address => mapping(address => Position)) public positions;

struct Position {
    uint256 collateral;       // xStock tokens locked (18 dec)
    uint256 gridTokensMinted; // gdUSD minted against this (18 dec)
}`}</Pre>

      <H3>User-facing functions</H3>
      <Table
        headers={["Function", "Description"]}
        rows={[
          ["stake(token, amount)", "Lock xStock collateral, mint gdUSD at 70% LTV"],
          ["unstake(token, gtAmount)", "Burn gdUSD proportionally, unlock collateral"],
          ["liquidate(user, token)", "Anyone can liquidate an unhealthy position"],
        ]}
      />

      <H3>View functions</H3>
      <Table
        headers={["Function", "Returns"]}
        rows={[
          ["getHealthFactor(user, token)", "BPS value; ≥10000 = safe"],
          ["getAvailableGridTokens(user, token)", "Additional gdUSD mintable"],
          ["getCollateralValue(user, token)", "Current USD value of locked collateral"],
        ]}
      />

      <H2>PriceFeed</H2>
      <P>
        Simple oracle contract. Only the designated updater (backend) can call{" "}
        <Code>setPrice</Code>. Consumers call <Code>latestPrice</Code> (returns
        6-dec USDC) or <Code>marketState</Code> for open/close flags.
      </P>
      <Pre>{`function setPrice(
    address token,
    uint256 price,          // USDC per token, 6 dec
    bool isOpen,
    bool isOpeningWindow,
    bool isClosingWindow,
    bool afterHours,
    bool isHoliday
) external onlyUpdater

function latestPrice(address token) external view returns (uint256)
function marketState(address token) external view returns (MarketState memory)`}</Pre>

      <H2>Decimal Conventions</H2>
      <Table
        headers={["Value", "Decimals", "Example"]}
        rows={[
          ["xStock token amount", "18", "1 wQQQx = 1e18"],
          ["USDC amount", "6", "$1 = 1_000_000"],
          ["Price (USDC/token)", "6", "$480 = 480_000_000"],
          ["gdUSD amount", "18", "1 gdUSD = 1e18"],
          ["BPS rates", "0", "70% = 7000"],
        ]}
      />
      <Callout type="tip">
        The bridge between 18-dec gdUSD and 6-dec USDC uses{" "}
        <Code>GT_TO_USDC = 1e12</Code>. gdUSD ÷ 1e12 = USDC value.
      </Callout>
    </div>
  );
}
