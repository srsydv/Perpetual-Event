import { useQuery } from "@tanstack/react-query";
import { MATCHER_API } from "@/config";

function shortenAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function fetchBook(market: string): Promise<{ bids: Array<{ maker: string; side: string; limitPrice: string; remainingSize: string }>; asks: Array<{ maker: string; side: string; limitPrice: string; remainingSize: string }> }> {
  if (!MATCHER_API) return { bids: [], asks: [] };
  const res = await fetch(`${MATCHER_API.replace(/\/$/, "")}/book?market=${encodeURIComponent(market)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function OrderBook({ marketAddress }: { marketAddress: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["orderBook", marketAddress],
    queryFn: () => fetchBook(marketAddress),
    enabled: !!MATCHER_API && !!marketAddress,
    refetchInterval: 5000,
  });

  if (!MATCHER_API) {
    return (
      <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-4">
        <h3 className="mb-2 text-sm font-medium text-gray-400">Order book</h3>
        <p className="text-xs text-gray-500">Set VITE_MATCHER_API to show live order book.</p>
      </div>
    );
  }

  if (isLoading) return <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-4 text-sm text-gray-500">Loading book…</div>;
  if (error) return <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">Failed to load book: {String(error)}</div>;

  const bids = data?.bids ?? [];
  const asks = data?.asks ?? [];

  const bestBidPct = bids.length > 0 ? (Number(bids[0].limitPrice) / 1e18) * 100 : null;
  const bestAskPct = asks.length > 0 ? (Number(asks[0].limitPrice) / 1e18) * 100 : null;
  const midPct =
    bestBidPct != null && bestAskPct != null
      ? (bestBidPct + bestAskPct) / 2
      : bestBidPct ?? bestAskPct;

  return (
    <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-4">
      <h3 className="mb-3 text-sm font-medium text-white">Order book</h3>
      <div className="mb-4 rounded-lg border border-polymarket-border/60 bg-polymarket-bg/50 p-3">
        <p className="text-xs text-gray-500">Market price (from order book)</p>
        {midPct != null ? (
          <p className="mt-1 text-lg font-semibold text-white">
            YES <span className="text-polymarket-green">{midPct.toFixed(1)}%</span>
            {" · "}
            NO <span className="text-polymarket-red">{(100 - midPct).toFixed(1)}%</span>
          </p>
        ) : (
          <p className="mt-1 text-sm text-gray-400">No orders yet — place or fill orders to discover price.</p>
        )}
        {bestBidPct != null && (
          <p className="mt-0.5 text-xs text-gray-500">Best bid: {bestBidPct.toFixed(1)}%</p>
        )}
        {bestAskPct != null && (
          <p className="text-xs text-gray-500">Best ask: {bestAskPct.toFixed(1)}%</p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4 text-xs">
        <div>
          <p className="mb-1 font-medium text-polymarket-green">Bids (Long)</p>
          <div className="space-y-0.5">
            {bids.slice(0, 8).map((o, i) => (
              <div key={i} className="flex justify-between text-gray-300">
                <span>{Number(o.limitPrice) / 1e18 * 100}%</span>
                <span>{o.remainingSize}</span>
                <span className="text-gray-500">{shortenAddress(o.maker)}</span>
              </div>
            ))}
            {bids.length === 0 && <p className="text-gray-500">No bids</p>}
          </div>
        </div>
        <div>
          <p className="mb-1 font-medium text-polymarket-red">Asks (Short)</p>
          <div className="space-y-0.5">
            {asks.slice(0, 8).map((o, i) => (
              <div key={i} className="flex justify-between text-gray-300">
                <span>{Number(o.limitPrice) / 1e18 * 100}%</span>
                <span>{o.remainingSize}</span>
                <span className="text-gray-500">{shortenAddress(o.maker)}</span>
              </div>
            ))}
            {asks.length === 0 && <p className="text-gray-500">No asks</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
