import { useState } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { signTypedData } from "@wagmi/core";
import { decodeAbiParameters, encodeAbiParameters, formatUnits, parseAbiParameters, parseUnits } from "viem";
import { config } from "@/wagmi";
import { DEPLOYED, PRECISION, MATCHER_API, BINARY_DOMAIN_NAME, BINARY_DOMAIN_VERSION } from "@/config";
import { BINARY_MARKET_ABI } from "@/abis/binaryMarket";
import PreTradeSimulation from "@/components/PreTradeSimulation";

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

function formatPercentFrom1e18(price: bigint): string {
  const pct = (Number(price) / PRECISION) * 100;
  const rounded = Math.round(pct * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function getOrderInfoFromHex(makerOrderHex: string): {
  maker: string;
  makerLong: boolean;
  makerPrice: bigint;
  makerSizeRaw: bigint;
  nonce: bigint;
  expiry: bigint;
  makerPricePct: string;
  makerSize: string;
} | null {
  try {
    const hex = makerOrderHex.startsWith("0x") ? makerOrderHex : `0x${makerOrderHex}`;
    const decoded = decodeAbiParameters(
      parseAbiParameters("address, uint256, uint256, uint256, uint256, uint256"),
      hex as `0x${string}`
    );
    return {
      maker: decoded[0] as string,
      makerLong: decoded[3] !== 0n,
      makerPrice: decoded[1] as bigint,
      makerSizeRaw: decoded[2] as bigint,
      nonce: decoded[4] as bigint,
      expiry: decoded[5] as bigint,
      makerPricePct: formatPercentFrom1e18(decoded[1] as bigint),
      makerSize: formatUnits(decoded[2] as bigint, 18),
    };
  } catch {
    return null;
  }
}

function shortenAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
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
  const [makerOrderHex, setMakerOrderHex] = useState("");
  const [signatureHex, setSignatureHex] = useState("");
  const [selectedOrderIndex, setSelectedOrderIndex] = useState(0);

  const { data: nonce } = useReadContract({
    address: marketAddress,
    abi: BINARY_MARKET_ABI,
    functionName: "nonces",
    args: address ? [address] : undefined,
  });

  const { writeContract: submitFill, data: fillHash } = useWriteContract();
  const { isLoading: fillPending } = useWaitForTransactionReceipt({ hash: fillHash });

  const storedOrders = getStoredOrders(marketAddress);
  const selectedOrderInfo = getOrderInfoFromHex(makerOrderHex);
  const takerIsLong = selectedOrderInfo ? !selectedOrderInfo.makerLong : null;
  const { data: makerNonceOnChain } = useReadContract({
    address: marketAddress,
    abi: BINARY_MARKET_ABI,
    functionName: "nonces",
    args: selectedOrderInfo ? [selectedOrderInfo.maker as `0x${string}`] : undefined,
  });

  const fillPriceNum = Number(fillPrice);
  const fillPriceRaw =
    Number.isFinite(fillPriceNum) && fillPriceNum > 0 && fillPriceNum <= 100
      ? BigInt(Math.round((fillPriceNum / 100) * PRECISION))
      : null;
  let fillSizeRaw: bigint | null = null;
  try {
    fillSizeRaw = parseUnits(fillSize, 18);
  } catch {
    fillSizeRaw = null;
  }

  const precheckErrors: string[] = [];
  if (!selectedOrderInfo) precheckErrors.push("Invalid maker order hex.");
  if (selectedOrderInfo && address && selectedOrderInfo.maker.toLowerCase() === address.toLowerCase()) {
    precheckErrors.push("You cannot fill your own order. Switch wallet.");
  }
  if (selectedOrderInfo && selectedOrderInfo.expiry <= BigInt(Math.floor(Date.now() / 1000))) {
    precheckErrors.push("Order is expired.");
  }
  if (fillPriceRaw === null) precheckErrors.push("Fill price must be between 0 and 100.");
  if (fillSizeRaw === null || fillSizeRaw <= 0n) precheckErrors.push("Fill size must be a valid positive number.");
  if (selectedOrderInfo && fillSizeRaw !== null && fillSizeRaw > selectedOrderInfo.makerSizeRaw) {
    precheckErrors.push("Fill size cannot be greater than maker order size.");
  }
  if (selectedOrderInfo && fillPriceRaw !== null && takerIsLong !== null) {
    if (takerIsLong && selectedOrderInfo.makerPrice > fillPriceRaw) {
      precheckErrors.push("Price mismatch: taker long requires fill price >= maker price.");
    }
    if (!takerIsLong && selectedOrderInfo.makerPrice < fillPriceRaw) {
      precheckErrors.push("Price mismatch: taker short requires fill price <= maker price.");
    }
  }
  if (selectedOrderInfo && makerNonceOnChain !== undefined && makerNonceOnChain !== selectedOrderInfo.nonce) {
    precheckErrors.push("Stale nonce: this maker order is no longer valid (already used/replaced).");
  }
  if (selectedOrderInfo && makerNonceOnChain === undefined) {
    precheckErrors.push("Checking maker nonce on-chain...");
  }
  const canSubmitFill = precheckErrors.length === 0 && !fillPending && !!address && !!makerOrderHex && !!signatureHex && takerIsLong !== null;

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
      name: BINARY_DOMAIN_NAME,
      version: BINARY_DOMAIN_VERSION,
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
    setFillPrice(placePrice);
    setFillSize(placeSize);
    setSelectedOrderIndex(storedOrders.length);
    alert("Order signed and stored. You can fill it (as taker) or share makerOrder + signature.");
  };

  const fillOrder = () => {
    if (!canSubmitFill) return;
    const makerOrder = makerOrderHex.startsWith("0x")
      ? makerOrderHex as `0x${string}`
      : `0x${makerOrderHex}` as `0x${string}`;
    const signature = (signatureHex.startsWith("0x") ? signatureHex : `0x${signatureHex}`) as `0x${string}`;
    if (!address || takerIsLong === null || fillPriceRaw === null || fillSizeRaw === null) return;
    submitFill({
      address: marketAddress,
      abi: BINARY_MARKET_ABI,
      functionName: "submitFillV1",
      args: [address, takerIsLong, fillPriceRaw, fillSizeRaw, makerOrder, signature],
    });
  };

  return (
    <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-6">
      <h2 className="mb-4 font-medium text-white">Trade</h2>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm text-gray-400">Place limit order (sign as maker)</h3>
          <p className="mb-2 text-xs text-amber-200/80">
            You can sign without depositing, but your order can only be filled if you have enough collateral in this market (deposit first). Otherwise the fill will revert.
          </p>
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
                <label className="block text-xs text-gray-500">Use stored order (pick one to fill as taker; pick an order from someone else, not yours)</label>
                <select
                  value={selectedOrderIndex}
                  onChange={(e) => {
                    const i = parseInt(e.target.value, 10);
                    setSelectedOrderIndex(i);
                    const o = storedOrders[i];
                    if (o) {
                      setMakerOrderHex(o.makerOrder);
                      setSignatureHex(o.signature);
                      const info = getOrderInfoFromHex(o.makerOrder);
                      if (info) {
                        setFillPrice(info.makerPricePct);
                        setFillSize(info.makerSize);
                      }
                    }
                  }}
                  className="w-full rounded border border-polymarket-border bg-polymarket-bg px-3 py-2 text-white"
                >
                  {storedOrders.map((o, i) => {
                    const info = getOrderInfoFromHex(o.makerOrder);
                    const maker = info?.maker;
                    const isYou = address && maker && address.toLowerCase() === maker.toLowerCase();
                    const label = maker
                      ? `Order #${i + 1} — ${shortenAddress(maker)}${isYou ? " (You)" : ""}`
                      : `Order #${i + 1}`;
                    return (
                      <option key={i} value={i}>{label}</option>
                    );
                  })}
                </select>
              </>
            )}
            <label className="block text-xs text-gray-500">Or paste maker order (hex)</label>
            <input
              type="text"
              placeholder="0x..."
              value={makerOrderHex}
              onChange={(e) => {
                const next = e.target.value;
                setMakerOrderHex(next);
                const info = getOrderInfoFromHex(next);
                if (info) {
                  setFillPrice(info.makerPricePct);
                  setFillSize(info.makerSize);
                }
              }}
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
            <p className="text-xs text-gray-400">
              Your side is auto-set from maker order:{" "}
              <span className="text-white">
                {takerIsLong === null ? "Unknown (invalid maker order hex)" : takerIsLong ? "Long (YES)" : "Short (NO)"}
              </span>
            </p>
            {selectedOrderInfo && (
              <p className="text-xs text-gray-500">
                Maker: <span className="text-gray-300">{shortenAddress(selectedOrderInfo.maker)}</span> | Maker price:{" "}
                <span className="text-gray-300">{selectedOrderInfo.makerPricePct}%</span> | Maker size:{" "}
                <span className="text-gray-300">{selectedOrderInfo.makerSize}</span> | Order nonce:{" "}
                <span className="text-gray-300">{selectedOrderInfo.nonce.toString()}</span> | On-chain nonce:{" "}
                <span className="text-gray-300">{makerNonceOnChain === undefined ? "..." : makerNonceOnChain.toString()}</span>
              </p>
            )}
            {precheckErrors.length > 0 && (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
                {precheckErrors.map((err, i) => (
                  <p key={i}>- {err}</p>
                ))}
              </div>
            )}
            <button
              onClick={fillOrder}
              disabled={!canSubmitFill}
              className="w-full rounded-lg bg-polymarket-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {fillPending ? "Submitting..." : "Submit fill"}
            </button>
            {MATCHER_API && (
              <PreTradeSimulation
                marketAddress={marketAddress}
                takerIsLong={takerIsLong}
                fillPrice={fillPrice}
                fillSize={fillSize}
                makerOrderHex={makerOrderHex}
              />
            )}
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        To test: sign an order as maker, then switch wallet (or use another account) and fill as taker with opposite side.
      </p>
    </div>
  );
}
