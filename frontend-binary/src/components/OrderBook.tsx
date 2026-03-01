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

  return (
    <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-4">
      <h3 className="mb-3 text-sm font-medium text-white">Order book</h3>
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
