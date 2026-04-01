import type { PrivyClientConfig } from "@privy-io/react-auth";
import { inkSepolia } from "viem/chains";

/**
 * Privy dashboard: https://dashboard.privy.io — create an app, set allowed domains,
 * enable login methods (email / Google / etc.) to match your product.
 */
export const privyConfig: PrivyClientConfig = {
  defaultChain: inkSepolia,
  supportedChains: [inkSepolia],
  loginMethods: ["email"],
  embeddedWallets: {
    ethereum: {
      createOnLogin: "users-without-wallets",
    },
  },
  appearance: {
    theme: "dark",
    accentColor: "#ff3b8d",
    logo: undefined,
  },
};
