// Binary (Polymarket-style) - match deploy-addresses-binary.json after running scripts/deploy-binary.js
const env = (typeof import.meta !== "undefined" ? (import.meta as unknown as { env?: Record<string, string> }).env : undefined) ?? {};
const loadBinaryAddresses = (): { binaryMarketFactory: string; markets: Record<string, string>; collateral: string } => {
  try {
    const raw = env.VITE_BINARY_DEPLOY_JSON;
    if (raw) return JSON.parse(raw) as { binaryMarketFactory: string; markets: Record<string, string>; collateral: string };
  } catch {}
  return {
    binaryMarketFactory: env.VITE_BINARY_FACTORY ?? "",
    markets: { "0": env.VITE_BINARY_MARKET_0 ?? "" },
    collateral: env.VITE_COLLATERAL ?? "0x799a5570318c0C5Fcfd09b0f573335B5aa8d85Ff",
  };
};
const loaded = loadBinaryAddresses();

export const DEPLOYED = {
  chainId: 11155111 as number,
  collateral: (loaded.collateral || "0x799a5570318c0C5Fcfd09b0f573335B5aa8d85Ff") as `0x${string}`,
  binaryMarketFactory: (loaded.binaryMarketFactory || "0x0000000000000000000000000000000000000000") as `0x${string}`,
  /** marketId -> address */
  markets: loaded.markets as Record<string, string>,
};

export const PRECISION = 1e18;

/** EIP-712 domain name for BinaryMarket (must match contract) */
export const BINARY_DOMAIN_NAME = "BinaryMarket";
export const BINARY_DOMAIN_VERSION = "1";

export const MATCHER_API = env.VITE_MATCHER_API ?? "";
