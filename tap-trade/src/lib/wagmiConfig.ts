import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { inkSepolia } from "viem/chains";

export const appChain = inkSepolia;

export const wagmiConfig = createConfig({
  chains: [inkSepolia],
  transports: {
    [inkSepolia.id]: http(),
  },
});
