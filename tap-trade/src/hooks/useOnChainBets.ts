import { useRef, useCallback } from "react";
import { useWriteContract, useConfig } from "wagmi";
import { readContract, waitForTransactionReceipt } from "@wagmi/core";
import { parseUnits, maxUint256, type Address } from "viem";
import { CONTRACTS, ERC20_ABI, GRID_ABI } from "../lib/contracts";

/**
 * Handles silent on-chain bet placement.
 *
 * - Approves gdUSD for xStocksGrid once (maxUint256), silently.
 * - Fires placeBet() in the background — no popup, no blocking UX.
 * - `noPromptOnSignature: true` in Privy config makes this truly silent.
 */
export function useOnChainBets(
  userAddress: Address | undefined,
  onBalanceChange: () => void,
  onTxSent?: (hash: string) => void,
) {
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();
  const approvedRef = useRef(false);
  const approvingRef = useRef(false);

  // Ensure gdUSD is approved for xStocksGrid (runs at most once per session)
  const ensureApproval = useCallback(async () => {
    if (approvedRef.current || approvingRef.current || !userAddress) return;
    approvingRef.current = true;
    try {
      const allowance = await readContract(config, {
        address: CONTRACTS.gdUSD,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [userAddress, CONTRACTS.xStocksGrid],
      }) as bigint;

      if (allowance >= parseUnits("1000000", 18)) {
        // Already has a large allowance — no need to approve
        approvedRef.current = true;
        return;
      }

      const tx = await writeContractAsync({
        address: CONTRACTS.gdUSD,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACTS.xStocksGrid, maxUint256],
      });
      await waitForTransactionReceipt(config, { hash: tx });
      approvedRef.current = true;
    } catch {
      // Approval failed — bets will fail on-chain but local UX continues
    } finally {
      approvingRef.current = false;
    }
  }, [config, writeContractAsync, userAddress]);

  /**
   * Fire a bet on-chain silently.
   * @param tokenAddress  xStock contract address
   * @param priceTicks    signed row offset from current price (+1 = one tick above, -2 = two ticks below)
   * @param timeBuckets   how many 30s buckets ahead (1–8)
   * @param gdUsdAmount   bet size in gdUSD (whole number, e.g. 10)
   */
  const placeBetOnChain = useCallback(
    (
      tokenAddress: Address,
      priceTicks: number,
      timeBuckets: number,
      gdUsdAmount: number,
    ) => {
      if (!userAddress) return;

      const ticks = Math.max(-127, Math.min(127, priceTicks)) as number;
      const buckets = Math.max(1, Math.min(8, timeBuckets)) as number;
      const amount = parseUnits(gdUsdAmount.toString(), 18);

      console.log("[onChainBet] placing:", { tokenAddress, ticks, buckets, gdUsdAmount });

      // Fire and forget — don't await, don't block UX
      void (async () => {
        await ensureApproval();
        console.log("[onChainBet] approval OK, sending placeBet tx…");
        try {
          const txHash = await writeContractAsync({
            address: CONTRACTS.xStocksGrid,
            abi: GRID_ABI,
            functionName: "placeBet",
            args: [tokenAddress, ticks, buckets, amount],
          });
          console.log("[onChainBet] ✅ tx sent:", txHash);
          onTxSent?.(txHash);
          onBalanceChange();
        } catch (err) {
          console.error("[onChainBet] ❌ tx failed:", err);
        }
      })();
    },
    [ensureApproval, writeContractAsync, userAddress, onBalanceChange, onTxSent],
  );

  return { placeBetOnChain, ensureApproval };
}
