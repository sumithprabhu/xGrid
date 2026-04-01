import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import type { ReactNode } from "react";
import { privyConfig } from "../lib/privyConfig";
import { wagmiConfig } from "../lib/wagmiConfig";

const queryClient = new QueryClient();

const privyAppId = import.meta.env.VITE_PRIVY_APP_ID?.trim() ?? "";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider appId={privyAppId} config={privyConfig}>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
