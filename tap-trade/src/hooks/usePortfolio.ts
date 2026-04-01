import { useReadContracts } from "wagmi";
import { type Address, formatUnits } from "viem";
import {
  CONTRACTS,
  COLLATERAL_TOKENS,
  GRID_TOKENS,
  ERC20_ABI,
  PRICE_FEED_ABI,
} from "../lib/contracts";

export interface AssetBalance {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  raw: bigint;
  formatted: number;          // token units
  usdValue: number;           // in USD
  priceUsd: number;           // per token
  gridToken: Address | null;  // the gdUSD token minted by staking this
}

export interface GdUsdBalance {
  address: Address;
  symbol: string;
  raw: bigint;
  formatted: number;          // 18-dec → float, 1 gdUSD = 1 USD
}

export interface Portfolio {
  assets: AssetBalance[];
  gdUsd: GdUsdBalance[];
  totalGdUsd: number;
  totalUsd: number;
  isLoading: boolean;
  refetch: () => void;
}

// price from PriceFeed is 6-dec USDC per token (18-dec)
function rawPriceToUsd(raw: bigint): number {
  return Number(formatUnits(raw, 6));
}

export function usePortfolio(address: Address | undefined): Portfolio {
  // ── Contracts to read ─────────────────────────────────────────────────────
  const contracts = address
    ? [
        // balanceOf for each collateral token
        ...COLLATERAL_TOKENS.map((t) => ({
          address: t.address,
          abi: ERC20_ABI,
          functionName: "balanceOf" as const,
          args: [address],
        })),
        // price from PriceFeed for each stock token (not USDC)
        ...COLLATERAL_TOKENS.filter((t) => t.address !== CONTRACTS.USDC).map((t) => ({
          address: CONTRACTS.priceFeed,
          abi: PRICE_FEED_ABI,
          functionName: "latestPrice" as const,
          args: [t.address],
        })),
        // balanceOf for each gdUSD token
        ...GRID_TOKENS.map((t) => ({
          address: t.address,
          abi: ERC20_ABI,
          functionName: "balanceOf" as const,
          args: [address],
        })),
      ]
    : [];

  const { data, isLoading, refetch } = useReadContracts({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contracts: contracts as any[],
    query: { enabled: !!address, refetchInterval: 6_000 },
  });

  if (!address || !data) {
    return { assets: [], gdUsd: [], totalGdUsd: 0, totalUsd: 0, isLoading, refetch };
  }

  const n = COLLATERAL_TOKENS.length;         // 3
  const stockCount = n - 1;                   // 2 (non-USDC)

  // parse balances
  const balances = COLLATERAL_TOKENS.map((t, i) => {
    const raw = (data[i]?.result as bigint | undefined) ?? 0n;
    return { token: t, raw };
  });

  // parse prices  (only stocks; USDC = $1)
  const prices: Record<string, number> = { [CONTRACTS.USDC]: 1 };
  for (let i = 0; i < stockCount; i++) {
    const raw = (data[n + i]?.result as bigint | undefined) ?? 0n;
    prices[COLLATERAL_TOKENS[i].address] = rawPriceToUsd(raw);
  }

  // parse gdUSD balances
  const gdUsd: GdUsdBalance[] = GRID_TOKENS.map((t, i) => {
    const raw = (data[n + stockCount + i]?.result as bigint | undefined) ?? 0n;
    const formatted = Number(formatUnits(raw, 18));
    return { address: t.address, symbol: t.symbol, raw, formatted };
  });

  // build asset rows
  const assets: AssetBalance[] = balances.map(({ token, raw }) => {
    const formatted = Number(formatUnits(raw, token.decimals));
    const priceUsd = prices[token.address] ?? 0;
    return {
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      raw,
      formatted,
      usdValue: formatted * priceUsd,
      priceUsd,
      gridToken: null,
    };
  });

  const totalGdUsd = gdUsd.reduce((s, g) => s + g.formatted, 0);
  const totalUsd = assets.reduce((s, a) => s + a.usdValue, 0) + totalGdUsd;

  return { assets, gdUsd, totalGdUsd, totalUsd, isLoading, refetch };
}
