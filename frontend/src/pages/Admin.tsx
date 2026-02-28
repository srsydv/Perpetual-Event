import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useState } from "react";
import { DEPLOYED, PRECISION } from "@/config";
import { EVENT_FACTORY_ABI } from "@/abis/factory";
import { EVENT_MARKET_ABI } from "@/abis/market";

function MarketParams({ eventId, marketAddress }: { eventId: number; marketAddress: `0x${string}` }) {
  const { data: indexPrice } = useReadContract({
    address: marketAddress,
    abi: EVENT_MARKET_ABI,
    functionName: "getIndexPrice",
  });
  const { data: closeOnly } = useReadContract({
    address: marketAddress,
    abi: EVENT_MARKET_ABI,
    functionName: "closeOnly",
  });
  const { data: markEmaAlphaBps } = useReadContract({
    address: marketAddress,
    abi: EVENT_MARKET_ABI,
    functionName: "markEmaAlphaBps",
  });
  const { data: maxMarkDeviationBps } = useReadContract({
    address: marketAddress,
    abi: EVENT_MARKET_ABI,
    functionName: "maxMarkDeviationBps",
  });
  const { data: resolved } = useReadContract({
    address: marketAddress,
    abi: EVENT_MARKET_ABI,
    functionName: "resolved",
  });

  const [indexPriceInput, setIndexPriceInput] = useState("");
  const { writeContract: setIndexPrice, data: tx1 } = useWriteContract();
  const { writeContract: setCloseOnly, data: tx2 } = useWriteContract();
  const { writeContract: resolveEvent, data: tx3 } = useWriteContract();
  useWaitForTransactionReceipt({ hash: tx1 });
  useWaitForTransactionReceipt({ hash: tx2 });
  useWaitForTransactionReceipt({ hash: tx3 });

  const indexPct = indexPrice != null ? (Number(indexPrice) / PRECISION) * 100 : null;

  return (
    <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-4 text-sm">
      <h4 className="font-medium text-white mb-2">Event #{eventId} — Market params</h4>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-400">
        <dt>Index price</dt>
        <dd className="text-white">{indexPct != null ? `${indexPct.toFixed(1)}%` : "—"}</dd>
        <dt>Close-only mode</dt>
        <dd className="text-white">{closeOnly ? "Yes" : "No"}</dd>
        <dt>Mark EMA alpha (bps)</dt>
        <dd className="text-white">{markEmaAlphaBps != null ? markEmaAlphaBps.toString() : "—"}</dd>
        <dt>Max mark deviation (bps)</dt>
        <dd className="text-white">{maxMarkDeviationBps != null ? maxMarkDeviationBps.toString() : "—"}</dd>
        <dt>Resolved</dt>
        <dd className="text-white">{resolved ? "Yes" : "No"}</dd>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="number"
          min="0"
          max="100"
          step="0.1"
          placeholder="Index % (0–100)"
          value={indexPriceInput}
          onChange={(e) => setIndexPriceInput(e.target.value)}
          className="w-28 rounded border border-polymarket-border bg-polymarket-bg px-2 py-1 text-white"
        />
        <button
          type="button"
          onClick={() => {
            const pct = parseFloat(indexPriceInput);
            if (!Number.isFinite(pct) || pct < 0 || pct > 100) return;
            setIndexPrice({
              address: DEPLOYED.eventFactoryProxy,
              abi: EVENT_FACTORY_ABI,
              functionName: "setMarketIndexPrice",
              args: [BigInt(eventId), BigInt(Math.round((pct / 100) * PRECISION))],
            });
          }}
          className="rounded bg-polymarket-blue px-3 py-1 text-white"
        >
          Set index price
        </button>
        <button
          type="button"
          onClick={() => {
            setCloseOnly({
              address: DEPLOYED.eventFactoryProxy,
              abi: EVENT_FACTORY_ABI,
              functionName: "setMarketCloseOnly",
              args: [BigInt(eventId), !closeOnly],
            });
          }}
          className="rounded bg-amber-600 px-3 py-1 text-white"
        >
          {closeOnly ? "Unset close-only" : "Set close-only"}
        </button>
        {!resolved && (
          <>
            <button
              type="button"
              onClick={() => {
                resolveEvent({
                  address: DEPLOYED.eventFactoryProxy,
                  abi: EVENT_FACTORY_ABI,
                  functionName: "resolveEvent",
                  args: [BigInt(eventId), true],
                });
              }}
              className="rounded bg-green-600 px-3 py-1 text-white"
            >
              Resolve YES
            </button>
            <button
              type="button"
              onClick={() => {
                resolveEvent({
                  address: DEPLOYED.eventFactoryProxy,
                  abi: EVENT_FACTORY_ABI,
                  functionName: "resolveEvent",
                  args: [BigInt(eventId), false],
                });
              }}
              className="rounded bg-red-600 px-3 py-1 text-white"
            >
              Resolve NO
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function Admin() {
  const { address } = useAccount();
  const { data: admin } = useReadContract({
    address: DEPLOYED.eventFactoryProxy,
    abi: EVENT_FACTORY_ABI,
    functionName: "admin",
  });
  const { data: eventCount } = useReadContract({
    address: DEPLOYED.eventFactoryProxy,
    abi: EVENT_FACTORY_ABI,
    functionName: "eventCount",
  });

  const isAdmin =
    address &&
    admin &&
    typeof admin === "string" &&
    address.toLowerCase() === admin.toLowerCase();
  const count = eventCount != null ? Number(eventCount) : 0;

  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-6 text-amber-200">
        <p>Only the factory admin can view and change risk params. Connect with the admin wallet.</p>
        {admin && <p className="mt-2 text-sm text-gray-400">Admin: {admin}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-white">Admin &amp; risk controls</h1>
      <p className="text-gray-400 text-sm">
        Index price, close-only mode, and resolution. Microstructure (EMA alpha, max deviation) can be set via factory.
      </p>
      <div className="space-y-4">
        {Array.from({ length: count }, (_, i) => (
          <EventRow key={i} eventId={i} />
        ))}
        {count === 0 && <p className="text-gray-500">No events yet. Create one from the Create page.</p>}
      </div>
    </div>
  );
}

function EventRow({ eventId }: { eventId: number }) {
  const { data: eventInfo } = useReadContract({
    address: DEPLOYED.eventFactoryProxy,
    abi: EVENT_FACTORY_ABI,
    functionName: "getEvent",
    args: [BigInt(eventId)],
  });
  const marketAddress = eventInfo?.market as `0x${string}` | undefined;
  if (!marketAddress) return null;
  return (
    <div>
      <p className="text-gray-400 mb-1">
        {eventInfo?.name ?? "—"} (resolved: {eventInfo?.resolved ? "yes" : "no"}, paused: {eventInfo?.paused ? "yes" : "no"})
      </p>
      <MarketParams eventId={eventId} marketAddress={marketAddress} />
    </div>
  );
}
