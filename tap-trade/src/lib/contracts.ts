import { type Address } from "viem";

// ── Ink Sepolia deployment ────────────────────────────────────────────────────

export const CONTRACTS = {
  USDC:        "0x6b57475467cd854d36Be7FB614caDa5207838943" as Address,
  wQQQx:       "0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9" as Address,
  wSPYx:       "0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e" as Address,
  gdUSD:       "0x1F27B2974edA52DC7AdDCCa1d34B23f4bB961E2B" as Address,
  priceFeed:   "0x19f634aCF5B2AAC5bb913F83951053dcA1E22174" as Address,
  xStocksGrid: "0x63DA0B8B7904a843c0AC67c37484248dAe1294dc" as Address,
  xStockVault: "0x714458e7664608589649bf305cdC4798a42b21a4" as Address,
} as const;

// ── Token metadata ─────────────────────────────────────────────────────────────

export const COLLATERAL_TOKENS = [
  { address: CONTRACTS.wQQQx, symbol: "wQQQx", name: "xQQQ", decimals: 18 },
  { address: CONTRACTS.wSPYx, symbol: "wSPYx", name: "xSPY", decimals: 18 },
  { address: CONTRACTS.USDC,  symbol: "USDC",  name: "USD Coin", decimals: 6 },
] as const;

// Single unified gdUSD grid token
export const GRID_TOKENS = [
  { address: CONTRACTS.gdUSD, symbol: "gdUSD" },
] as const;

// ── Minimal ABIs ───────────────────────────────────────────────────────────────

export const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const PRICE_FEED_ABI = [
  {
    name: "latestPrice",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const VAULT_ABI = [
  {
    name: "stake",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "gridTokensMinted", type: "uint256" }],
  },
  {
    name: "unstake",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }, { name: "gridTokenAmount", type: "uint256" }],
    outputs: [{ name: "collateralOut", type: "uint256" }],
  },
  {
    name: "positions",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }, { name: "token", type: "address" }],
    outputs: [
      { name: "collateral", type: "uint256" },
      { name: "gridTokensMinted", type: "uint256" },
    ],
  },
  {
    name: "getHealthFactor",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }, { name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const GRID_ABI = [
  {
    name: "depositUsdc",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }, { name: "usdcAmount", type: "uint256" }],
    outputs: [{ name: "gridTokensMinted", type: "uint256" }],
  },
  {
    name: "redeemForUsdc",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }, { name: "gridTokenAmount", type: "uint256" }],
    outputs: [{ name: "usdcOut", type: "uint256" }],
  },
] as const;
