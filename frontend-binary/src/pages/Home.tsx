import { useEffect, useState, useCallback } from "react";
import { useReadContract, usePublicClient } from "wagmi";
import { Link } from "react-router-dom";
import { DEPLOYED } from "@/config";
import { BINARY_FACTORY_ABI } from "@/abis/binaryFactory";
import { BINARY_MARKET_ABI } from "@/abis/binaryMarket";

export type MarketInfo = { marketId: number; address: `0x${string}` };

function MarketCard({ market }: { market: MarketInfo }) {
  const { data: resolved } = useReadContract({
    address: market.address,
    abi: BINARY_MARKET_ABI,
    functionName: "resolved",
    chainId: DEPLOYED.chainId,
  });
  const { data: outcome } = useReadContract({
    address: market.address,
    abi: BINARY_MARKET_ABI,
    functionName: "outcome",
    chainId: DEPLOYED.chainId,
  });

  return (
    <Link
      to={`/market/${market.marketId}`}
      className="block rounded-xl border border-polymarket-border bg-polymarket-card p-5 transition hover:border-polymarket-blue/50"
    >
      <h3 className="font-medium text-white">Binary Market #{market.marketId}</h3>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-gray-500">YES / NO</span>
        {resolved != null && (
          <span className={`text-sm font-medium ${outcome ? "text-polymarket-green" : "text-polymarket-red"}`}>
            Resolved: {outcome ? "YES" : "NO"}
          </span>
        )}
      </div>
    </Link>
  );
}

export default function Home() {
  const factoryAddress = DEPLOYED.binaryMarketFactory;
  const hasFactory = factoryAddress !== "0x0000000000000000000000000000000000000000";
  const publicClient = usePublicClient({ chainId: DEPLOYED.chainId });

  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMarkets = useCallback(async () => {
    if (!hasFactory) {
      setLoading(false);
      return;
    }
    if (!publicClient) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const count = await publicClient.readContract({
        address: factoryAddress,
        abi: BINARY_FACTORY_ABI,
        functionName: "marketCount",
      });
      const n = Number(count);
      const list: MarketInfo[] = [];
      for (let i = 0; i < n; i++) {
        const address = await publicClient.readContract({
          address: factoryAddress,
          abi: BINARY_FACTORY_ABI,
          functionName: "markets",
          args: [BigInt(i)],
        });
        list.push({ marketId: i, address });
      }
      setMarkets(list);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setMarkets([]);
    } finally {
      setLoading(false);
    }
  }, [hasFactory, publicClient, factoryAddress]);

  useEffect(() => {
    loadMarkets();
  }, [loadMarkets]);

  if (!hasFactory) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold text-white">Binary Markets (Polymarket-style)</h1>
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-6 text-amber-200">
          Factory not configured. Set <code className="text-amber-100">VITE_BINARY_FACTORY</code> in .env (or run{" "}
          <code className="text-amber-100">npm run sync-deploy</code> after deploy) and restart the app.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">Binary Markets (Polymarket-style)</h1>
        <button
          type="button"
          onClick={() => loadMarkets()}
          disabled={loading}
          className="rounded-lg border border-polymarket-border bg-polymarket-card px-3 py-1.5 text-sm text-gray-300 hover:bg-polymarket-border/50 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      <p className="mb-4 text-sm text-gray-500">
        Markets: <strong className="text-gray-300">{loading ? "—" : markets.length}</strong>
        {" · "}
        Factory: <code className="break-all text-xs text-gray-400">{factoryAddress.slice(0, 10)}…{factoryAddress.slice(-8)}</code>
      </p>
      {error && (
        <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          Failed to load from chain: {error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {markets.map((market) => (
          <MarketCard key={market.marketId} market={market} />
        ))}
      </div>
      {!loading && !error && markets.length === 0 && (
        <p className="rounded-xl border border-polymarket-border bg-polymarket-card p-8 text-center text-gray-500">
          No markets yet. Connect as <strong>admin</strong> and go to{" "}
          <Link to="/admin" className="text-polymarket-blue underline">
            Admin
          </Link>{" "}
          to create a market.
        </p>
      )}
    </div>
  );
}
