import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { DEPLOYED } from "@/config";
import { BINARY_FACTORY_ABI } from "@/abis/binaryFactory";
import { BINARY_MARKET_ABI } from "@/abis/binaryMarket";

function MarketRow({ marketId }: { marketId: number }) {
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
  const { writeContract: resolveMarket, data: txHash } = useWriteContract();
  useWaitForTransactionReceipt({ hash: txHash });

  if (!marketAddress || marketAddress === "0x0000000000000000000000000000000000000000") return null;

  return (
    <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-4 text-sm">
      <h4 className="mb-2 font-medium text-white">Market #{marketId}</h4>
      <p className="text-gray-400">Resolved: {resolved ? "Yes" : "No"} {resolved && outcome != null && `(Outcome: ${outcome ? "YES" : "NO"})`}</p>
      {!resolved && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => {
              resolveMarket({
                address: DEPLOYED.binaryMarketFactory,
                abi: BINARY_FACTORY_ABI,
                functionName: "resolveMarket",
                args: [BigInt(marketId), true],
              });
            }}
            className="rounded bg-green-600 px-3 py-1 text-white"
          >
            Resolve YES
          </button>
          <button
            type="button"
            onClick={() => {
              resolveMarket({
                address: DEPLOYED.binaryMarketFactory,
                abi: BINARY_FACTORY_ABI,
                functionName: "resolveMarket",
                args: [BigInt(marketId), false],
              });
            }}
            className="rounded bg-red-600 px-3 py-1 text-white"
          >
            Resolve NO
          </button>
        </div>
      )}
    </div>
  );
}

export default function Admin() {
  const { address } = useAccount();
  const { data: admin } = useReadContract({
    address: DEPLOYED.binaryMarketFactory,
    abi: BINARY_FACTORY_ABI,
    functionName: "admin",
  });
  const { data: marketCount } = useReadContract({
    address: DEPLOYED.binaryMarketFactory,
    abi: BINARY_FACTORY_ABI,
    functionName: "marketCount",
  });

  const isAdmin =
    address &&
    admin &&
    typeof admin === "string" &&
    address.toLowerCase() === admin.toLowerCase();
  const count = marketCount != null ? Number(marketCount) : 0;

  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-6 text-amber-200">
        <p>Only the factory admin can resolve markets. Connect with the admin wallet.</p>
        {admin && <p className="mt-2 text-sm text-gray-400">Admin: {admin}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-white">Admin — Resolve markets</h1>
      <p className="text-sm text-gray-400">Resolve each binary market with outcome YES or NO. After resolution, users can redeem winning shares.</p>
      <div className="space-y-4">
        {Array.from({ length: count }, (_, i) => (
          <MarketRow key={i} marketId={i} />
        ))}
        {count === 0 && <p className="text-gray-500">No markets yet. Deploy with deploy-binary.js.</p>}
      </div>
    </div>
  );
}
