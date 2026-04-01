/**
 * xStocksGrid Backend Server
 * 
 * Responsibilities:
 *   1. Maintain real-time price feed (WebSocket to Chainlink + Pyth)
 *   2. Compute grid matrix and push to frontend via WebSocket
 *   3. Keeper service: snapshot buckets + trigger resolutions
 *   4. REST API for bet placement, history, pool stats
 *   5. Vol surface updater: recalibrate σ from recent price data
 */

import Fastify from 'fastify';
import { WebSocketServer } from 'ws';
import { ethers } from 'ethers';
import { createClient } from 'redis';

// ─── Config ──────────────────────────────────────────────────────────────────

const CONFIG = {
  RPC_URL:          process.env.RPC_URL          || 'https://mainnet.base.org',
  GRID_CONTRACT:    process.env.GRID_CONTRACT     || '0x0000...',
  ORACLE_CONTRACT:  process.env.ORACLE_CONTRACT   || '0x0000...',
  KEEPER_PK:        process.env.KEEPER_PRIVATE_KEY || '',
  REDIS_URL:        process.env.REDIS_URL         || 'redis://localhost:6379',
  PORT:             parseInt(process.env.PORT     || '3001'),
  
  // xStock tokens (symbol → address)
  TOKENS: {
    'xAAPL': process.env.XAAPL_ADDRESS || '0x0000...',
    'xMSFT': process.env.XMSFT_ADDRESS || '0x0000...',
    'xGS':   process.env.XGS_ADDRESS   || '0x0000...',
    'xTSLA': process.env.XTSLA_ADDRESS || '0x0000...',
    'xJPM':  process.env.XJPM_ADDRESS  || '0x0000...',
  },

  // Grid parameters per token
  GRID_PARAMS: {
    'xAAPL': { annualVol: 0.25, tickSize: 0.05, bucketSeconds: 30, rows: 6, cols: 5, houseEdge: 0.10 },
    'xMSFT': { annualVol: 0.28, tickSize: 0.08, bucketSeconds: 30, rows: 6, cols: 5, houseEdge: 0.10 },
    'xGS':   { annualVol: 0.32, tickSize: 0.15, bucketSeconds: 60, rows: 6, cols: 5, houseEdge: 0.12 },
    'xTSLA': { annualVol: 0.65, tickSize: 0.20, bucketSeconds: 30, rows: 6, cols: 5, houseEdge: 0.12 },
    'xJPM':  { annualVol: 0.30, tickSize: 0.10, bucketSeconds: 60, rows: 6, cols: 5, houseEdge: 0.10 },
  },
};

// ─── Math Engine (mirrors GridMath.sol in JS) ─────────────────────────────────

class GridMathJS {
  static PRECISION = 1e18;
  static SECONDS_PER_YEAR = 31_536_000;

  /**
   * Normal CDF Φ(x) using Abramowitz & Stegun rational approximation.
   * Max error < 7.5e-8.
   */
  static normalCDF(x: number): number {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const poly = t * (0.254829592 +
      t * (-0.284496736 +
      t * (1.421413741 +
      t * (-1.453152027 +
      t * 1.061405429))));
    const cdf = 1 - poly * Math.exp(-x * x / 2);
    return x >= 0 ? cdf : 1 - cdf;
  }

  /**
   * Two-tailed probability that price moves |z| standard deviations.
   * P = 2 × Φ(-|z|)
   */
  static twoTailProb(z: number): number {
    return 2 * (1 - this.normalCDF(Math.abs(z)));
  }

  /**
   * Volatility scaling for market hours (Tivnan et al. model).
   */
  static marketHoursVolMultiplier(now: Date): number {
    const utcHour   = now.getUTCHours();
    const utcMin    = now.getUTCMinutes();
    const dayOfWeek = now.getUTCDay(); // 0=Sun, 6=Sat
    const totalMins = utcHour * 60 + utcMin;

    const OPEN_MIN  = 13 * 60 + 30; // 13:30 UTC = 9:30 ET
    const CLOSE_MIN = 20 * 60;       // 20:00 UTC = 16:00 ET
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    if (isWeekend) return 0.20;
    if (totalMins < OPEN_MIN || totalMins >= CLOSE_MIN) return 0.40; // after hours

    // Opening window (first 30 min) — Tivnan: 2.5× dislocation
    if (totalMins < OPEN_MIN + 30) return 2.50;

    // Closing window (last 30 min)
    if (totalMins >= CLOSE_MIN - 30) return 1.80;

    return 1.00; // normal hours
  }

  /**
   * Calculate multiplier for a grid cell.
   * 
   * Algorithm:
   *   1. Compute effective σ = annualVol × volMultiplier × √(windowSeconds/SECONDS_PER_YEAR)
   *   2. Compute required move = |priceTicks × tickSize| / currentPrice
   *   3. Z-score = requiredMove / σ_window
   *   4. P = 2 × Φ(-|z|)          (two-tailed probability)
   *   5. fairMult = 1 / P
   *   6. displayMult = fairMult × (1 - houseEdge)
   */
  static calculateMultiplier(params: {
    priceTicks:    number;  // absolute ticks from current (positive)
    timeBuckets:   number;
    currentPrice:  number;  // USDC
    annualVol:     number;  // decimal (0.25 = 25%)
    tickSize:      number;  // USDC per tick
    bucketSeconds: number;
    houseEdge:     number;  // decimal (0.10 = 10%)
    now:           Date;
  }): { multiplier: number; probability: number; displayStr: string } {

    const { priceTicks, timeBuckets, currentPrice, annualVol,
            tickSize, bucketSeconds, houseEdge, now } = params;

    // 1. Market-hours adjusted volatility
    const volMult = this.marketHoursVolMultiplier(now);
    const effectiveVol = annualVol * volMult;

    // 2. σ for this time window
    const windowSeconds = timeBuckets * bucketSeconds;
    const sigmaWindow = effectiveVol * Math.sqrt(windowSeconds / this.SECONDS_PER_YEAR);

    if (sigmaWindow < 1e-10) {
      return { multiplier: 100, probability: 0.001, displayStr: 'x100' };
    }

    // 3. Required price move as fraction of current price
    const requiredMoveFrac = (priceTicks * tickSize) / currentPrice;

    // 4. Z-score
    const z = requiredMoveFrac / sigmaWindow;

    // 5. Two-tailed probability
    const probability = this.twoTailProb(z);

    // Guard against near-zero probability
    const pClamped = Math.max(probability, 0.001);

    // 6. Fair multiplier
    const fairMult = 1 / pClamped;

    // 7. Apply house edge
    const displayMult = fairMult * (1 - houseEdge);

    // 8. Floor at 1.1×, cap at 100×
    const clampedMult = Math.min(Math.max(displayMult, 1.1), 100);
    const roundedMult = Math.round(clampedMult * 10) / 10; // 1 decimal

    return {
      multiplier: roundedMult,
      probability: pClamped,
      displayStr: `x${roundedMult.toFixed(1)}`
    };
  }

  /**
   * Generate full grid matrix for a token.
   * Returns 2D array: grid[rowIndex][colIndex] = { multiplier, targetPrice, probability }
   */
  static generateGrid(params: {
    symbol:        string;
    currentPrice:  number;
    annualVol:     number;
    tickSize:      number;
    bucketSeconds: number;
    houseEdge:     number;
    rows:          number;   // rows above AND below (total = rows*2)
    cols:          number;   // number of time buckets
    now:           Date;
  }) {
    const { symbol, currentPrice, annualVol, tickSize,
            bucketSeconds, houseEdge, rows, cols, now } = params;

    const grid: GridCell[][] = [];
    const bucketMs = bucketSeconds * 1000;
    const bucketStart = Math.floor(Date.now() / bucketMs) * bucketMs;

    // Row index 0 = highest price (above current)
    for (let tick = rows; tick >= -rows; tick--) {
      if (tick === 0) continue; // skip current price row

      const rowCells: GridCell[] = [];
      const targetPrice = currentPrice + tick * tickSize;

      for (let col = 1; col <= cols; col++) {
        const expiryTs = bucketStart + col * bucketSeconds * 1000;

        const { multiplier, probability, displayStr } = this.calculateMultiplier({
          priceTicks:    Math.abs(tick),
          timeBuckets:   col,
          currentPrice,
          annualVol,
          tickSize,
          bucketSeconds,
          houseEdge,
          now
        });

        rowCells.push({
          priceTicks:   tick,
          timeBucket:   col,
          targetPrice:  parseFloat(targetPrice.toFixed(2)),
          multiplier,
          probability,
          displayStr,
          expiryTs,
          direction:    tick > 0 ? 'up' : 'down',
          cellKey:      `${symbol}:${tick}:${col}`,
        });
      }

      grid.push(rowCells);
    }

    return {
      symbol,
      currentPrice,
      grid,
      generatedAt:   Date.now(),
      bucketSeconds,
      marketState:   this.getMarketState(now),
    };
  }

  static getMarketState(now: Date) {
    const utcHour   = now.getUTCHours();
    const utcMin    = now.getUTCMinutes();
    const dayOfWeek = now.getUTCDay();
    const totalMins = utcHour * 60 + utcMin;

    const OPEN_MIN  = 13 * 60 + 30;
    const CLOSE_MIN = 20 * 60;
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isOpen    = !isWeekend && totalMins >= OPEN_MIN && totalMins < CLOSE_MIN;
    const isOpening = isOpen && totalMins < OPEN_MIN + 30;
    const isClosing = isOpen && totalMins >= CLOSE_MIN - 30;

    return {
      isOpen,
      isOpening,
      isClosing,
      isAfterHours: !isOpen && !isWeekend,
      isWeekend,
      label: isWeekend ? 'Weekend' :
             !isOpen ? 'After Hours' :
             isOpening ? 'Opening (High Vol)' :
             isClosing ? 'Closing (High Vol)' : 'Regular Hours'
    };
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface GridCell {
  priceTicks:  number;
  timeBucket:  number;
  targetPrice: number;
  multiplier:  number;
  probability: number;
  displayStr:  string;
  expiryTs:    number;
  direction:   'up' | 'down';
  cellKey:     string;
}

interface PriceUpdate {
  symbol:      string;
  price:       number;
  timestamp:   number;
  change1m:    number;
  high1m:      number;
  low1m:       number;
}

// ─── Price Feed Service ───────────────────────────────────────────────────────

class PriceFeedService {
  private prices: Map<string, number> = new Map();
  private priceHistory: Map<string, { price: number; ts: number }[]> = new Map();
  private provider: ethers.JsonRpcProvider;
  private chainlinkFeeds: Map<string, string> = new Map();

  constructor(rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  addChainlinkFeed(symbol: string, feedAddress: string) {
    this.chainlinkFeeds.set(symbol, feedAddress);
  }

  async fetchPrice(symbol: string): Promise<number> {
    const feedAddr = this.chainlinkFeeds.get(symbol);
    if (!feedAddr) {
      // Fallback: return mock price for demo
      return this.getMockPrice(symbol);
    }

    try {
      const ABI = ['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)'];
      const feed = new ethers.Contract(feedAddr, ABI, this.provider);
      const [, answer, , updatedAt] = await feed.latestRoundData();

      const age = Date.now() / 1000 - Number(updatedAt);
      if (age > 60) throw new Error('Stale oracle');

      // Chainlink 8 decimals → USD float
      return Number(answer) / 1e8;
    } catch (err) {
      console.error(`Oracle error for ${symbol}:`, err);
      return this.getMockPrice(symbol);
    }
  }

  private getMockPrice(symbol: string): number {
    // Seed prices for demo — in production this never runs
    const seeds: Record<string, number> = {
      'xAAPL': 190.24, 'xMSFT': 415.80,
      'xGS': 492.10, 'xTSLA': 178.50, 'xJPM': 204.30
    };
    const base = seeds[symbol] || 100;
    // Add small random walk for realism in demo
    const cached = this.prices.get(symbol) || base;
    const drift = (Math.random() - 0.495) * 0.05; // slight upward drift
    return Math.max(base * 0.5, cached * (1 + drift / 100));
  }

  async updateAll(): Promise<PriceUpdate[]> {
    const updates: PriceUpdate[] = [];

    for (const symbol of Object.keys(CONFIG.TOKENS)) {
      const price = await this.fetchPrice(symbol);
      const now   = Date.now();

      // Update history (keep 60 seconds = 60 entries at 1/sec)
      const history = this.priceHistory.get(symbol) || [];
      history.push({ price, ts: now });
      const cutoff = now - 60_000;
      const filtered = history.filter(h => h.ts >= cutoff);
      this.priceHistory.set(symbol, filtered);
      this.prices.set(symbol, price);

      // Compute 1-minute stats
      const prices1m = filtered.map(h => h.price);
      const open1m   = prices1m[0] || price;
      const high1m   = Math.max(...prices1m);
      const low1m    = Math.min(...prices1m);

      updates.push({
        symbol,
        price,
        timestamp:  now,
        change1m:   ((price - open1m) / open1m) * 100,
        high1m,
        low1m,
      });
    }

    return updates;
  }

  getPrice(symbol: string): number {
    return this.prices.get(symbol) || 0;
  }

  get1mRange(symbol: string): { high: number; low: number } {
    const history = this.priceHistory.get(symbol) || [];
    const prices  = history.map(h => h.price);
    return {
      high: prices.length ? Math.max(...prices) : 0,
      low:  prices.length ? Math.min(...prices) : 0,
    };
  }
}

// ─── Grid State Manager ───────────────────────────────────────────────────────

class GridStateManager {
  private grids: Map<string, ReturnType<typeof GridMathJS.generateGrid>> = new Map();

  regenerateAll(prices: Map<string, number>): void {
    const now = new Date();

    for (const [symbol, params] of Object.entries(CONFIG.GRID_PARAMS)) {
      const currentPrice = prices.get(symbol) || 0;
      if (!currentPrice) continue;

      const grid = GridMathJS.generateGrid({
        symbol,
        currentPrice,
        annualVol:     params.annualVol,
        tickSize:      params.tickSize,
        bucketSeconds: params.bucketSeconds,
        houseEdge:     params.houseEdge,
        rows:          params.rows,
        cols:          params.cols,
        now,
      });

      this.grids.set(symbol, grid);
    }
  }

  getGrid(symbol: string) {
    return this.grids.get(symbol);
  }

  getAllGrids() {
    return Object.fromEntries(this.grids);
  }
}

// ─── Keeper Service ───────────────────────────────────────────────────────────

class KeeperService {
  private wallet: ethers.Wallet;
  private gridContract: ethers.Contract;
  private oracleContract: ethers.Contract;
  private pendingResolutions: Set<string> = new Set();

  constructor(rpcUrl: string, keeperPk: string) {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(keeperPk, provider);

    const GRID_ABI = [
      'function resolveBets(uint256[] calldata betIds) external',
      'function snapshotBucket(address token, uint256 bucketTs) external',
    ];
    const ORACLE_ABI = [
      'function recordPrice(address token) external returns (uint256)',
      'function snapshotBucket(address token, uint256 bucketTimestamp) external',
    ];

    this.gridContract   = new ethers.Contract(CONFIG.GRID_CONTRACT,   GRID_ABI,   this.wallet);
    this.oracleContract = new ethers.Contract(CONFIG.ORACLE_CONTRACT, ORACLE_ABI, this.wallet);
  }

  /**
   * Called every 5 seconds — records prices to oracle.
   */
  async heartbeat(): Promise<void> {
    for (const [symbol, address] of Object.entries(CONFIG.TOKENS)) {
      try {
        await this.oracleContract.recordPrice(address);
        console.log(`[Keeper] Price recorded: ${symbol}`);
      } catch (err) {
        console.error(`[Keeper] Error recording ${symbol}:`, err);
      }
    }
  }

  /**
   * Called at each bucket boundary — snapshots bucket and queues resolutions.
   */
  async onBucketExpiry(symbol: string, tokenAddress: string, bucketTs: number): Promise<void> {
    try {
      console.log(`[Keeper] Snapshotting bucket for ${symbol} at ${bucketTs}`);
      await this.oracleContract.snapshotBucket(tokenAddress, bucketTs);
    } catch (err) {
      console.error(`[Keeper] Snapshot error:`, err);
    }
  }

  /**
   * Batch resolve expired bets.
   * Called after snapshot to ensure oracle data is ready.
   */
  async resolveExpiredBets(betIds: number[]): Promise<void> {
    if (betIds.length === 0) return;

    console.log(`[Keeper] Resolving ${betIds.length} bets`);
    try {
      const tx = await this.gridContract.resolveBets(betIds);
      await tx.wait();
      console.log(`[Keeper] Resolved ${betIds.length} bets. Tx: ${tx.hash}`);
    } catch (err) {
      console.error('[Keeper] Resolution error:', err);
    }
  }
}

// ─── Vol Surface Updater ──────────────────────────────────────────────────────

class VolSurfaceUpdater {
  /**
   * Compute realized volatility from recent price history.
   * Uses Yang-Zhang volatility estimator (more efficient than close-to-close).
   */
  static computeRealizedVol(prices: { price: number; ts: number }[]): number {
    if (prices.length < 10) return 0;

    // Log returns
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push(Math.log(prices[i].price / prices[i-1].price));
    }

    // Annualized standard deviation of log returns
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
    const stdPerObs = Math.sqrt(variance);

    // Annualize: if observations are 1 second apart
    const observationsPerYear = this.SECONDS_PER_YEAR;
    return stdPerObs * Math.sqrt(observationsPerYear);
  }

  static SECONDS_PER_YEAR = 31_536_000;

  /**
   * Exponentially weighted moving average volatility.
   * λ = 0.94 (RiskMetrics standard for daily, use 0.99 for 1-second data)
   */
  static computeEWMAVol(
    prices: { price: number; ts: number }[],
    lambda = 0.99
  ): number {
    if (prices.length < 2) return 0.25; // default fallback

    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push(Math.log(prices[i].price / prices[i-1].price));
    }

    let ewmaVariance = returns[0] ** 2;
    for (let i = 1; i < returns.length; i++) {
      ewmaVariance = lambda * ewmaVariance + (1 - lambda) * returns[i] ** 2;
    }

    // Annualize
    return Math.sqrt(ewmaVariance * this.SECONDS_PER_YEAR);
  }
}

// ─── REST API Routes ──────────────────────────────────────────────────────────

function setupRoutes(app: ReturnType<typeof Fastify>, services: {
  priceFeed: PriceFeedService;
  gridState: GridStateManager;
}) {
  const { priceFeed, gridState } = services;

  // Health check
  app.get('/health', async () => ({ status: 'ok', ts: Date.now() }));

  // Current price for a token
  app.get<{ Params: { symbol: string } }>(
    '/price/:symbol',
    async (req) => {
      const { symbol } = req.params;
      const price = priceFeed.getPrice(symbol);
      if (!price) return app.httpErrors.notFound('Token not found');
      const range = priceFeed.get1mRange(symbol);
      return { symbol, price, ...range, ts: Date.now() };
    }
  );

  // Full grid matrix for a token
  app.get<{ Params: { symbol: string } }>(
    '/grid/:symbol',
    async (req) => {
      const { symbol } = req.params;
      const grid = gridState.getGrid(symbol);
      if (!grid) return app.httpErrors.notFound('Grid not available');
      return grid;
    }
  );

  // Preview multiplier (for hover UI)
  app.get<{
    Params: { symbol: string };
    Querystring: { ticks: string; buckets: string };
  }>(
    '/preview/:symbol',
    async (req) => {
      const { symbol } = req.params;
      const priceTicks  = parseInt(req.query.ticks);
      const timeBuckets = parseInt(req.query.buckets);

      if (!priceTicks || !timeBuckets) {
        return app.httpErrors.badRequest('ticks and buckets required');
      }

      const params = CONFIG.GRID_PARAMS[symbol as keyof typeof CONFIG.GRID_PARAMS];
      if (!params) return app.httpErrors.notFound();

      const currentPrice = priceFeed.getPrice(symbol);
      const result = GridMathJS.calculateMultiplier({
        priceTicks: Math.abs(priceTicks),
        timeBuckets,
        currentPrice,
        annualVol:     params.annualVol,
        tickSize:      params.tickSize,
        bucketSeconds: params.bucketSeconds,
        houseEdge:     params.houseEdge,
        now: new Date(),
      });

      const targetPrice = currentPrice + priceTicks * params.tickSize;

      return {
        symbol,
        priceTicks,
        timeBuckets,
        currentPrice,
        targetPrice: parseFloat(targetPrice.toFixed(2)),
        ...result,
        impliedEdge: (1 / result.multiplier) - result.probability,
        potentialPayout100: 100 * result.multiplier,
      };
    }
  );

  // Pool statistics
  app.get('/pool/stats', async () => {
    // In production: read from contract
    return {
      totalUsdc:     1_284_000,
      totalShares:   1_284_000,
      shareNav:      1.00,
      eulerYield:    0.047,        // 4.7% APY from Euler
      houseRevenue7d: 8_420,
      claims7d:       3_180,
      netRevenue7d:   5_240,
      estimatedApy:   0.082,       // 8.2% combined
      activeBets:     347,
    };
  });

  // Market state
  app.get('/market/state', async () => {
    return GridMathJS.getMarketState(new Date());
  });

  // Vol surface (for analytics)
  app.get<{ Params: { symbol: string } }>(
    '/vol/:symbol',
    async (req) => {
      const { symbol } = req.params;
      const params = CONFIG.GRID_PARAMS[symbol as keyof typeof CONFIG.GRID_PARAMS];
      if (!params) return app.httpErrors.notFound();

      const volMult = GridMathJS.marketHoursVolMultiplier(new Date());

      return {
        symbol,
        annualVol:        params.annualVol,
        effectiveVol:     params.annualVol * volMult,
        marketHoursMultiplier: volMult,
        vol30s:           params.annualVol * volMult * Math.sqrt(30 / 31_536_000),
        vol60s:           params.annualVol * volMult * Math.sqrt(60 / 31_536_000),
        vol5min:          params.annualVol * volMult * Math.sqrt(300 / 31_536_000),
        tickSize:         params.tickSize,
        expectedMove30s:  priceFeed.getPrice(symbol) * params.annualVol * volMult * Math.sqrt(30 / 31_536_000),
      };
    }
  );
}

// ─── WebSocket Server ─────────────────────────────────────────────────────────

interface WsClient {
  ws: any;
  subscribedTokens: Set<string>;
  id: string;
}

class WebSocketManager {
  private clients: Map<string, WsClient> = new Map();
  private wss: WebSocketServer;

  constructor(port: number) {
    this.wss = new WebSocketServer({ port });
    this.wss.on('connection', (ws) => this.handleConnection(ws));
    console.log(`[WS] Server listening on port ${port}`);
  }

  private handleConnection(ws: any) {
    const clientId = Math.random().toString(36).slice(2);
    const client: WsClient = {
      ws,
      subscribedTokens: new Set(['xAAPL']), // default subscription
      id: clientId,
    };
    this.clients.set(clientId, client);

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.handleClientMessage(client, msg);
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      }
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
    });

    // Send welcome with current state
    ws.send(JSON.stringify({
      type:      'connected',
      clientId,
      message:   'xStocks Grid connected. Send { type: "subscribe", tokens: ["xAAPL"] } to start.',
    }));
  }

  private handleClientMessage(client: WsClient, msg: any) {
    switch (msg.type) {
      case 'subscribe':
        if (Array.isArray(msg.tokens)) {
          client.subscribedTokens.clear();
          for (const t of msg.tokens) {
            if (CONFIG.TOKENS[t as keyof typeof CONFIG.TOKENS]) {
              client.subscribedTokens.add(t);
            }
          }
          client.ws.send(JSON.stringify({
            type: 'subscribed',
            tokens: Array.from(client.subscribedTokens),
          }));
        }
        break;

      case 'unsubscribe':
        client.subscribedTokens.clear();
        break;

      case 'ping':
        client.ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        break;
    }
  }

  /**
   * Broadcast grid update to all subscribed clients.
   */
  broadcastGridUpdate(symbol: string, gridData: any, priceUpdate: PriceUpdate) {
    const payload = JSON.stringify({
      type:      'gridUpdate',
      symbol,
      grid:      gridData,
      price:     priceUpdate,
      ts:        Date.now(),
    });

    for (const client of this.clients.values()) {
      if (client.subscribedTokens.has(symbol) && client.ws.readyState === 1) {
        client.ws.send(payload);
      }
    }
  }

  /**
   * Broadcast bet resolution event.
   */
  broadcastResolution(betId: number, won: boolean, payout: number, symbol: string) {
    const payload = JSON.stringify({
      type:   'betResolved',
      betId,
      won,
      payout,
      symbol,
      ts:     Date.now(),
    });

    for (const client of this.clients.values()) {
      if (client.ws.readyState === 1) {
        client.ws.send(payload);
      }
    }
  }

  broadcastAlert(message: string, severity: 'info' | 'warning' | 'error') {
    const payload = JSON.stringify({ type: 'alert', message, severity, ts: Date.now() });
    for (const client of this.clients.values()) {
      if (client.ws.readyState === 1) client.ws.send(payload);
    }
  }

  get clientCount() { return this.clients.size; }
}

// ─── Main Application ─────────────────────────────────────────────────────────

async function main() {
  console.log('[Boot] Starting xStocks Grid server...');

  // Services
  const priceFeed  = new PriceFeedService(CONFIG.RPC_URL);
  const gridState  = new GridStateManager();
  const wsManager  = new WebSocketManager(CONFIG.PORT + 1);

  let keeper: KeeperService | null = null;
  if (CONFIG.KEEPER_PK) {
    keeper = new KeeperService(CONFIG.RPC_URL, CONFIG.KEEPER_PK);
    console.log('[Boot] Keeper service initialized');
  }

  // ── Price + Grid Update Loop (every 1 second) ─────────────────────────────
  const prices = new Map<string, number>();

  setInterval(async () => {
    const updates = await priceFeed.updateAll();

    for (const update of updates) {
      prices.set(update.symbol, update.price);
    }

    // Regenerate grids with fresh prices
    gridState.regenerateAll(prices);

    // Broadcast to WebSocket clients
    for (const update of updates) {
      const grid = gridState.getGrid(update.symbol);
      if (grid) {
        wsManager.broadcastGridUpdate(update.symbol, grid, update);
      }
    }
  }, 1_000);

  // ── Keeper Heartbeat (every 5 seconds) ───────────────────────────────────
  if (keeper) {
    setInterval(() => keeper!.heartbeat(), 5_000);
  }

  // ── Bucket Boundary Checker (every second) ───────────────────────────────
  let lastBucketTs: Record<string, number> = {};
  setInterval(() => {
    const now = Date.now();

    for (const [symbol, addr] of Object.entries(CONFIG.TOKENS)) {
      const params = CONFIG.GRID_PARAMS[symbol as keyof typeof CONFIG.GRID_PARAMS];
      const bucketMs = params.bucketSeconds * 1000;
      const currentBucket = Math.floor(now / bucketMs) * bucketMs;

      if (lastBucketTs[symbol] && lastBucketTs[symbol] < currentBucket) {
        // Bucket just rolled over — trigger snapshot
        console.log(`[Bucket] ${symbol} bucket expired at ${lastBucketTs[symbol]}`);
        if (keeper) {
          keeper.onBucketExpiry(symbol, addr, lastBucketTs[symbol] / 1000);
        }
      }

      lastBucketTs[symbol] = currentBucket;
    }
  }, 1_000);

  // ── HTTP Server ───────────────────────────────────────────────────────────
  const app = Fastify({ logger: false });
  await app.register(import('@fastify/cors'), { origin: '*' });

  setupRoutes(app, { priceFeed, gridState });

  await app.listen({ port: CONFIG.PORT, host: '0.0.0.0' });
  console.log(`[HTTP] Server on port ${CONFIG.PORT}`);
  console.log(`[WS]   Server on port ${CONFIG.PORT + 1}`);
  console.log('[Boot] xStocks Grid ready');
}

main().catch(console.error);

export { GridMathJS, PriceFeedService, GridStateManager, WebSocketManager, VolSurfaceUpdater };
export type { GridCell, PriceUpdate };
