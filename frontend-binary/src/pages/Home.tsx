import { useReadContract } from "wagmi";
import { Link } from "react-router-dom";
import { DEPLOYED } from "@/config";
import { BINARY_FACTORY_ABI } from "@/abis/binaryFactory";
import { BINARY_MARKET_ABI } from "@/abis/binaryMarket";

function MarketCard({ marketId }: { marketId: number }) {
  const marketAddress = (DEPLOYED.markets[String(marketId)] || "") as `0x${string}` | undefined;
  const { data: resolved } = useReadContract({
    address: marketAddress,
    abi: BINARY_MARKET_ABI,
    functionName: "resolved",
  });
  const { data: outcome } = useReadContract({
    address: marketAddress,
    abi: BINARY_MARKET_ABI,
    functionName: "outcome",
  });

  if (!marketAddress || marketAddress === "0x0000000000000000000000000000000000000000") return null;

  return (
    <Link
      to={`/market/${marketId}`}
      className="block rounded-xl border border-polymarket-border bg-polymarket-card p-5 transition hover:border-polymarket-blue/50"
    >
      <h3 className="font-medium text-white">Binary Market #{marketId}</h3>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-gray-500">YES / NO</span>
        {resolved && (
          <span className={`text-sm font-medium ${outcome ? "text-polymarket-green" : "text-polymarket-red"}`}>
            Resolved: {outcome ? "YES" : "NO"}
          </span>
        )}
      </div>
    </Link>
  );
}

export default function Home() {
  const { data: count } = useReadContract({
    address: DEPLOYED.binaryMarketFactory,
    abi: BINARY_FACTORY_ABI,
    functionName: "marketCount",
  });
  const n = count != null ? Number(count) : 0;
  const hasConfigured = Object.keys(DEPLOYED.markets).length > 0;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-white">Binary Markets (Polymarket-style)</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {hasConfigured && Array.from({ length: Math.max(n, 1) }, (_, i) => (
          <MarketCard key={i} marketId={i} />
        ))}
      </div>
      {(!hasConfigured || n === 0) && (
        <p className="rounded-xl border border-polymarket-border bg-polymarket-card p-8 text-center text-gray-500">
          No markets configured. Deploy with <code className="text-gray-400">npx hardhat run scripts/deploy-binary.js --network sepolia</code> and set VITE_BINARY_MARKET_0 / VITE_BINARY_FACTORY in .env.
        </p>
      )}
    </div>
  );
}
