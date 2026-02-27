import { useReadContract } from "wagmi";
import { Link } from "react-router-dom";
import { DEPLOYED } from "@/config";
import { EVENT_FACTORY_ABI } from "@/abis/factory";
import { EVENT_MARKET_ABI } from "@/abis/market";

function EventCard({ eventId }: { eventId: number }) {
  const { data: eventInfo } = useReadContract({
    address: DEPLOYED.eventFactoryProxy,
    abi: EVENT_FACTORY_ABI,
    functionName: "getEvent",
    args: [BigInt(eventId)],
  });

  const { data: markData } = useReadContract({
    address: eventInfo?.market as `0x${string}` | undefined,
    abi: EVENT_MARKET_ABI,
    functionName: "getMarkPrice",
  });

  if (!eventInfo) return null;
  const { name, resolutionTime, resolved, outcome, paused } = eventInfo;
  const resolutionDate = new Date(Number(resolutionTime) * 1000);
  const prob = markData != null ? Number(markData) / 1e18 : 0.5;

  return (
    <Link
      to={`/market/${eventId}`}
      className="block rounded-xl border border-polymarket-border bg-polymarket-card p-5 transition hover:border-polymarket-blue/50"
    >
      <h3 className="font-medium text-white">{name}</h3>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-polymarket-green">
            {Math.round(prob * 100)}%
          </span>
          <span className="text-gray-500">YES</span>
        </div>
        <span className="text-sm text-gray-500">
          Resolves {resolutionDate.toLocaleDateString()}
        </span>
      </div>
      {resolved && (
        <p className="mt-2 text-sm text-gray-400">
          Resolved: {outcome ? "YES" : "NO"}
        </p>
      )}
      {paused && <p className="mt-1 text-amber-500 text-sm">Paused</p>}
    </Link>
  );
}

export default function Home() {
  const { data: count } = useReadContract({
    address: DEPLOYED.eventFactoryProxy,
    abi: EVENT_FACTORY_ABI,
    functionName: "eventCount",
  });
  const n = count != null ? Number(count) : 0;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-white">Markets</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: n }, (_, i) => (
          <EventCard key={i} eventId={i} />
        ))}
      </div>
      {n === 0 && (
        <p className="rounded-xl border border-polymarket-border bg-polymarket-card p-8 text-center text-gray-500">
          No events yet. Connect wallet and create one (admin only).
        </p>
      )}
    </div>
  );
}
