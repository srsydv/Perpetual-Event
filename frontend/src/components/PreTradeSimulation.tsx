import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { MATCHER_API, PRECISION } from "@/config";
import { parseUnits, decodeAbiParameters, parseAbiParameters } from "viem";

type SimResult = { ok: true; fillSize: string; price: string; takerIsLong: boolean; maker: string } | { ok: false; reason: string };

async function simulateFill(
  matcherApi: string,
  market: string,
  taker: string,
  takerIsLong: boolean,
  price: string,
  size: string,
  makerOrder: unknown[]
): Promise<SimResult> {
  const res = await fetch(`${matcherApi.replace(/\/$/, "")}/simulate-fill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      market,
      taker,
      takerIsLong,
      price: (Number(price) / 100 * PRECISION).toString(),
      size: parseUnits(size, 18).toString(),
      makerOrder,
    }),
  });
  const data = await res.json();
  if (data.ok) return { ok: true, fillSize: data.fillSize, price: data.price, takerIsLong: data.takerIsLong, maker: data.maker };
  return { ok: false, reason: data.reason ?? data.error ?? "Simulation failed" };
}

export default function PreTradeSimulation({
  marketAddress,
  takerIsLong,
  fillPrice,
  fillSize,
  makerOrderHex,
}: {
  marketAddress: string;
  takerIsLong: boolean | null;
  fillPrice: string;
  fillSize: string;
  makerOrderHex: string;
}) {
  const { address } = useAccount();
  const [result, setResult] = useState<SimResult | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    if (!MATCHER_API || !address || takerIsLong === null || !makerOrderHex) return;
    setLoading(true);
    setResult(null);
    try {
      let decoded: readonly unknown[] | null = null;
      try {
        const hex = makerOrderHex.startsWith("0x") ? makerOrderHex : `0x${makerOrderHex}`;
        decoded = decodeAbiParameters(
          parseAbiParameters("address, uint256, uint256, uint256, uint256, uint256"),
          hex as `0x${string}`
        );
      } catch {
        decoded = null;
      }
      if (!decoded || decoded.length < 6) {
        setResult({ ok: false, reason: "Invalid maker order hex" });
        return;
      }
      const makerOrder = [...decoded];
      if (makerOrder.length === 7) {
        // already 7 params
      } else if (makerOrder.length === 6) {
        makerOrder.push("0x0000000000000000000000000000000000000000000000000000000000000000");
      }
      const r = await simulateFill(
        MATCHER_API,
        marketAddress,
        address,
        takerIsLong,
        fillPrice,
        fillSize,
        makerOrder
      );
      setResult(r);
    } catch (e) {
      setResult({ ok: false, reason: String(e) });
    } finally {
      setLoading(false);
    }
  }, [MATCHER_API, address, takerIsLong, fillPrice, fillSize, makerOrderHex, marketAddress]);

  if (!MATCHER_API) return null;

  return (
    <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-4">
      <h3 className="mb-2 text-sm font-medium text-white">Pre-trade simulation</h3>
      <button
        type="button"
        onClick={run}
        disabled={loading || !address || takerIsLong === null || !makerOrderHex}
        className="mb-2 rounded bg-polymarket-blue px-3 py-1 text-xs text-white disabled:opacity-50"
      >
        {loading ? "Checking…" : "Simulate fill"}
      </button>
      {result && (
        <div className={`text-xs ${result.ok ? "text-polymarket-green" : "text-amber-200"}`}>
          {result.ok ? (
            <p>OK: fill size {result.fillSize}, price {result.price}</p>
          ) : (
            <p>Failure: {result.reason}</p>
          )}
        </div>
      )}
    </div>
  );
}
