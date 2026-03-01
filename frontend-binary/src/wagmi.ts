import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { sepolia } from "wagmi/chains";
import { http } from "wagmi";

// Set VITE_WALLETCONNECT_PROJECT_ID in .env (get free at https://cloud.walletconnect.com) to avoid 403 errors
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "event-perpetuals-app";

export const config = getDefaultConfig({
  appName: "Event Perpetuals",
  projectId,
  chains: [sepolia],
  transports: {
    [sepolia.id]: http(import.meta.env.VITE_SEPOLIA_RPC_URL || "https://rpc.sepolia.org"),
  },
});
