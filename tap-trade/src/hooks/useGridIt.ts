import { useState } from "react";
import { useWriteContract, useReadContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits, type Address, maxUint256 } from "viem";
import { CONTRACTS, ERC20_ABI, VAULT_ABI, GRID_ABI } from "../lib/contracts";

type Step = "idle" | "approving" | "staking" | "depositing" | "done" | "error";

interface UseGridItReturn {
  step: Step;
  txHash: `0x${string}` | undefined;
  error: string | null;
  /** Stake a collateral token (wQQQx / wSPYx) → mints gdUSD */
  stakeToken: (tokenAddress: Address, amount: string, decimals: number) => Promise<void>;
  /** Deposit USDC → mints gdUSD 1:1 for the given stock's grid */
  depositUsdc: (stockToken: Address, usdcAmount: string) => Promise<void>;
  reset: () => void;
}

export function useGridIt(onSuccess?: () => void): UseGridItReturn {
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();

  const { writeContractAsync } = useWriteContract();

  // Wait for the last tx
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: !!txHash && (step === "staking" || step === "depositing") },
  });

  if (txConfirmed && step !== "done") {
    setStep("done");
    onSuccess?.();
  }

  const stakeToken = async (tokenAddress: Address, amount: string, decimals: number) => {
    setError(null);
    try {
      const amountWei = parseUnits(amount, decimals);

      // 1. Check allowance, approve if needed
      setStep("approving");
      const approveTx = await writeContractAsync({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACTS.xStockVault, maxUint256],
      });
      // Wait for approval
      setTxHash(approveTx);
      await new Promise<void>((res) => {
        const poll = setInterval(async () => {
          clearInterval(poll);
          res();
        }, 2000);
        void poll;
      });

      // 2. Stake
      setStep("staking");
      const stakeTx = await writeContractAsync({
        address: CONTRACTS.xStockVault,
        abi: VAULT_ABI,
        functionName: "stake",
        args: [tokenAddress, amountWei],
      });
      setTxHash(stakeTx);
    } catch (e) {
      setStep("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const depositUsdc = async (stockToken: Address, usdcAmount: string) => {
    setError(null);
    try {
      const amountWei = parseUnits(usdcAmount, 6);

      // 1. Approve USDC to xStocksGrid
      setStep("approving");
      await writeContractAsync({
        address: CONTRACTS.USDC,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACTS.xStocksGrid, maxUint256],
      });

      // 2. Deposit USDC → gdUSD
      setStep("depositing");
      const depositTx = await writeContractAsync({
        address: CONTRACTS.xStocksGrid,
        abi: GRID_ABI,
        functionName: "depositUsdc",
        args: [stockToken, amountWei],
      });
      setTxHash(depositTx);
    } catch (e) {
      setStep("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const reset = () => {
    setStep("idle");
    setError(null);
    setTxHash(undefined);
  };

  return { step, txHash, error, stakeToken, depositUsdc, reset };
}

// Read staked position for a token
export function useVaultPosition(user: Address | undefined, tokenAddress: Address) {
  return useReadContract({
    address: CONTRACTS.xStockVault,
    abi: VAULT_ABI,
    functionName: "positions",
    args: user ? [user, tokenAddress] : undefined,
    query: { enabled: !!user, refetchInterval: 8_000 },
  });
}
