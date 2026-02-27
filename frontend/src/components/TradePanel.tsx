import { useState } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { signTypedData } from "@wagmi/core";
import { encodeAbiParameters, parseAbiParameters, parseUnits } from "viem";
import { config } from "@/wagmi";
import { DEPLOYED, PRECISION } from "@/config";
import { EVENT_MARKET_ABI } from "@/abis/market";

const ORDER_TYPE = {
  Order: [
    { name: "maker", type: "address" },
    { name: "price", type: "uint256" },
    { name: "size", type: "uint256" },
    { name: "isLong", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

const STORAGE_KEY = "event_perp_orders";

function getStoredOrders(market: string): { makerOrder: string; signature: string }[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const all: Record<string, { makerOrder: string; signature: string }[]> = JSON.parse(raw);
    return all[market] || [];
  } catch {
    return [];
  }
}
function storeOrder(market: string, makerOrder: string, signature: string) {
  const all: Record<string, { makerOrder: string; signature: string }[]> = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  if (!all[market]) all[market] = [];
  all[market].push({ makerOrder, signature });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export default function TradePanel({
  marketAddress,
  eventId: _eventId,
}: {
  marketAddress: `0x${string}`;
  eventId: number;
}) {
  const { address } = useAccount();
  const [placePrice, setPlacePrice] = useState("50");
  const [placeSize, setPlaceSize] = useState("100");
  const [placeLong, setPlaceLong] = useState(true);
  const [fillPrice, setFillPrice] = useState("50");
  const [fillSize, setFillSize] = useState("100");
  const [fillLong, setFillLong] = useState(true);
  const [makerOrderHex, setMakerOrderHex] = useState("");
  const [signatureHex, setSignatureHex] = useState("");
  const [selectedOrderIndex, setSelectedOrderIndex] = useState(0);

  const { data: nonce } = useReadContract({
    address: marketAddress,
    abi: EVENT_MARKET_ABI,
    functionName: "nonces",
    args: address ? [address] : undefined,
  });

  const { writeContract: submitFill, data: fillHash } = useWriteContract();
  const { isLoading: fillPending } = useWaitForTransactionReceipt({ hash: fillHash });

  const storedOrders = getStoredOrders(marketAddress);

  const placeOrder = async () => {
    if (!address || nonce === undefined) return;
    const price = BigInt(Math.round(parseFloat(placePrice) / 100 * PRECISION));
    const size = parseUnits(placeSize, 18);
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400 * 7); // 7 days
    const order = {
      maker: address,
      price,
      size,
      isLong: placeLong,
      nonce,
      expiry,
    };
    const domain = {
      name: "EventPerpetual",
      version: "1",
      chainId: DEPLOYED.chainId,
      verifyingContract: marketAddress,
    };
    const sig = await signTypedData(config, {
      domain,
      types: ORDER_TYPE,
      primaryType: "Order",
      message: order,
    });
    const makerOrderEncoded = encodeAbiParameters(
      parseAbiParameters("address, uint256, uint256, uint256, uint256, uint256"),
      [address, price, size, placeLong ? 1n : 0n, nonce, expiry]
    );
    const sigBytes = sig.startsWith("0x") ? sig as `0x${string}` : `0x${sig}`;
    storeOrder(marketAddress, makerOrderEncoded, sigBytes);
    setMakerOrderHex(makerOrderEncoded);
    setSignatureHex(sigBytes);
    setSelectedOrderIndex(storedOrders.length);
    alert("Order signed and stored. You can fill it (as taker) or share makerOrder + signature.");
  };

  const fillOrder = () => {
    const makerOrder = selectedOrderIndex >= 0 && storedOrders[selectedOrderIndex]
      ? storedOrders[selectedOrderIndex].makerOrder as `0x${string}`
      : makerOrderHex.startsWith("0x")
        ? makerOrderHex as `0x${string}`
        : `0x${makerOrderHex}` as `0x${string}`;
    const signature = (signatureHex.startsWith("0x") ? signatureHex : `0x${signatureHex}`) as `0x${string}`;
    const price = BigInt(Math.round(parseFloat(fillPrice) / 100 * PRECISION));
    const size = parseUnits(fillSize, 18);
    if (!address) return;
    submitFill({
      address: marketAddress,
      abi: EVENT_MARKET_ABI,
      functionName: "submitFill",
      args: [address, fillLong, price, size, makerOrder, signature],
    });
  };

  return (
    <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-6">
      <h2 className="mb-4 font-medium text-white">Trade</h2>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm text-gray-400">Place limit order (sign as maker)</h3>
          <div className="space-y-2">
            <label className="block text-xs text-gray-500">Price (0-100 %)</label>
            <input
              type="number"
              min="1"
              max="99"
              value={placePrice}
              onChange={(e) => setPlacePrice(e.target.value)}
              className="w-full rounded border border-polymarket-border bg-polymarket-bg px-3 py-2 text-white"
            />
            <label className="block text-xs text-gray-500">Size</label>
            <input
              type="text"
              value={placeSize}
              onChange={(e) => setPlaceSize(e.target.value)}
              className="w-full rounded border border-polymarket-border bg-polymarket-bg px-3 py-2 text-white"
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={placeLong} onChange={(e) => setPlaceLong(e.target.checked)} />
              Long (YES)
            </label>
            <button
              onClick={placeOrder}
              disabled={!address || nonce === undefined}
              className="w-full rounded-lg bg-polymarket-blue px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Sign order
            </button>
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-sm text-gray-400">Fill order (as taker)</h3>
          <div className="space-y-2">
            {storedOrders.length > 0 && (
              <>
                <label className="block text-xs text-gray-500">Use stored order</label>
                <select
                  value={selectedOrderIndex}
                  onChange={(e) => {
                    const i = parseInt(e.target.value, 10);
                    setSelectedOrderIndex(i);
                    const o = storedOrders[i];
                    if (o) {
                      setMakerOrderHex(o.makerOrder);
                      setSignatureHex(o.signature);
                    }
                  }}
                  className="w-full rounded border border-polymarket-border bg-polymarket-bg px-3 py-2 text-white"
                >
                  {storedOrders.map((_, i) => (
                    <option key={i} value={i}>Order #{i + 1}</option>
                  ))}
                </select>
              </>
            )}
            <label className="block text-xs text-gray-500">Or paste maker order (hex)</label>
            <input
              type="text"
              placeholder="0x..."
              value={makerOrderHex}
              onChange={(e) => setMakerOrderHex(e.target.value)}
              className="w-full rounded border border-polymarket-border bg-polymarket-bg px-3 py-2 text-sm text-white placeholder-gray-500"
            />
            <label className="block text-xs text-gray-500">Signature (hex)</label>
            <input
              type="text"
              placeholder="0x..."
              value={signatureHex}
              onChange={(e) => setSignatureHex(e.target.value)}
              className="w-full rounded border border-polymarket-border bg-polymarket-bg px-3 py-2 text-sm text-white placeholder-gray-500"
            />
            <label className="block text-xs text-gray-500">Your side: Price (%)</label>
            <input
              type="number"
              min="1"
              max="99"
              value={fillPrice}
              onChange={(e) => setFillPrice(e.target.value)}
              className="w-full rounded border border-polymarket-border bg-polymarket-bg px-3 py-2 text-white"
            />
            <label className="block text-xs text-gray-500">Size</label>
            <input
              type="text"
              value={fillSize}
              onChange={(e) => setFillSize(e.target.value)}
              className="w-full rounded border border-polymarket-border bg-polymarket-bg px-3 py-2 text-white"
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={fillLong} onChange={(e) => setFillLong(e.target.checked)} />
              Taker Long (YES)
            </label>
            <button
              onClick={fillOrder}
              disabled={fillPending || !address || !makerOrderHex || !signatureHex}
              className="w-full rounded-lg bg-polymarket-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {fillPending ? "Submitting..." : "Submit fill"}
            </button>
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        To test: sign an order as maker, then switch wallet (or use another account) and fill as taker with opposite side.
      </p>
    </div>
  );
}
