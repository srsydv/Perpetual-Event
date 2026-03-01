/**
 * Public client for reading BinaryMarketFactory on Sepolia.
 * Use this to always read from chain regardless of wallet connection.
 */
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { BINARY_FACTORY_ABI } from "@/abis/binaryFactory";

const env = typeof import.meta !== "undefined" ? (import.meta as unknown as { env?: Record<string, string> }).env : undefined;
const rpcUrl = env?.VITE_SEPOLIA_RPC_URL ?? "https://rpc.sepolia.org";

export const binaryPublicClient = createPublicClient({
  chain: sepolia,
  transport: http(rpcUrl),
});

export type MarketInfo = { marketId: number; address: `0x${string}` };

/**
 * Read marketCount and all market addresses from the factory on Sepolia.
 */
export async function fetchMarketsFromChain(
  factoryAddress: `0x${string}`
): Promise<{ count: number; markets: MarketInfo[] }> {
  const count = await binaryPublicClient.readContract({
    address: factoryAddress,
    abi: BINARY_FACTORY_ABI,
    functionName: "marketCount",
  });
  const n = Number(count);
  const markets: MarketInfo[] = [];
  for (let i = 0; i < n; i++) {
    const address = await binaryPublicClient.readContract({
      address: factoryAddress,
      abi: BINARY_FACTORY_ABI,
      functionName: "markets",
      args: [BigInt(i)],
    });
    markets.push({ marketId: i, address });
  }
  return { count: n, markets };
}
