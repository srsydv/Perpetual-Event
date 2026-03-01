import { useState, useEffect } from "react";
import { useAccount, useChainId, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { DEPLOYED } from "@/config";
import { BINARY_FACTORY_ABI } from "@/abis/binaryFactory";
import { BINARY_MARKET_ABI } from "@/abis/binaryMarket";

function normalizeAddress(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.toLowerCase();
  if (typeof v === "object" && v !== null && "toString" in v) return String(v).toLowerCase();
  return String(v).toLowerCase();
}

function MarketRow({ marketId }: { marketId: number }) {
  const { data: marketAddressFromChain } = useReadContract({
    address: DEPLOYED.binaryMarketFactory,
    abi: BINARY_FACTORY_ABI,
    functionName: "markets",
    args: [BigInt(marketId)],
    chainId: DEPLOYED.chainId,
  });
  const marketAddress = (marketAddressFromChain as string | undefined) as `0x${string}` | undefined;
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

  if (!marketAddressFromChain || marketAddress === "0x0000000000000000000000000000000000000000") return null;

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
  const chainId = useChainId();
  const [createCollateral, setCreateCollateral] = useState<string>(DEPLOYED.collateral);
  const [createQuestionId, setCreateQuestionId] = useState("");
  const [createDays, setCreateDays] = useState("365");

  const { data: admin } = useReadContract({
    address: DEPLOYED.binaryMarketFactory,
    abi: BINARY_FACTORY_ABI,
    functionName: "admin",
    chainId: DEPLOYED.chainId,
  });
  const { data: marketCount, refetch: refetchMarketCount } = useReadContract({
    address: DEPLOYED.binaryMarketFactory,
    abi: BINARY_FACTORY_ABI,
    functionName: "marketCount",
    chainId: DEPLOYED.chainId,
    query: { staleTime: 0 },
  });

  const { writeContract: createMarket, data: createTxHash } = useWriteContract();
  const { isLoading: createPending, isSuccess: createSuccess } = useWaitForTransactionReceipt({ hash: createTxHash });

  const adminStr = normalizeAddress(admin);
  const addressStr = normalizeAddress(address);
  const isCorrectChain = chainId === DEPLOYED.chainId;
  const isAdmin = Boolean(
    isCorrectChain && addressStr && adminStr && addressStr === adminStr
  );
  const count = marketCount != null ? Number(marketCount) : 0;

  const handleCreateMarket = () => {
    if (!createCollateral || !createQuestionId.trim()) return;
    const days = parseInt(createDays, 10) || 365;
    const resolutionTime = BigInt(Math.floor(Date.now() / 1000) + days * 86400);
    createMarket({
      address: DEPLOYED.binaryMarketFactory,
      abi: BINARY_FACTORY_ABI,
      functionName: "createMarket",
      args: [createCollateral as `0x${string}`, createQuestionId.trim(), resolutionTime],
    });
  };

  useEffect(() => {
    if (createSuccess && refetchMarketCount) refetchMarketCount();
  }, [createSuccess, refetchMarketCount]);

  if (!address) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-6 text-amber-200">
        <p>Connect your wallet to access the admin page.</p>
      </div>
    );
  }

  if (!isCorrectChain) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-6 text-amber-200">
        <p>Wrong network. This app uses Sepolia. Please switch your wallet to <strong>Sepolia</strong> (chain ID {DEPLOYED.chainId}) and try again.</p>
        <p className="mt-2 text-sm text-gray-400">Current chain ID: {chainId}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-white">Admin</h1>

      {adminStr && (
        <p className="text-sm text-gray-400">
          Factory admin: <code className="break-all text-gray-300">{adminStr}</code>
          {isAdmin && <span className="ml-2 text-polymarket-green">(you)</span>}
          {!isAdmin && addressStr && <span className="ml-2 text-amber-400">(only this address can create/resolve)</span>}
        </p>
      )}

      <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-6">
        <h2 className="mb-4 font-medium text-white">Create market</h2>
        <p className="mb-4 text-sm text-gray-400">Deploy a new binary market. Use the same collateral as existing markets (e.g. USDC or test token).</p>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-gray-400">Collateral (address)</label>
            <input
              type="text"
              value={createCollateral}
              onChange={(e) => setCreateCollateral(e.target.value)}
              placeholder="0x..."
              className="w-full rounded-lg border border-polymarket-border bg-polymarket-bg px-3 py-2 text-white placeholder-gray-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-400">Question ID (e.g. will-india-win)</label>
            <input
              type="text"
              value={createQuestionId}
              onChange={(e) => setCreateQuestionId(e.target.value)}
              placeholder="question-id"
              className="w-full rounded-lg border border-polymarket-border bg-polymarket-bg px-3 py-2 text-white placeholder-gray-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-400">Resolution in (days from now)</label>
            <input
              type="number"
              min={1}
              value={createDays}
              onChange={(e) => setCreateDays(e.target.value)}
              className="w-32 rounded-lg border border-polymarket-border bg-polymarket-bg px-3 py-2 text-white"
            />
          </div>
          <button
            type="button"
            onClick={handleCreateMarket}
            disabled={createPending || !createCollateral || !createQuestionId.trim()}
            className="rounded-lg bg-polymarket-blue px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {createPending ? "Creating…" : "Create market"}
          </button>
        </div>
      </div>

      <div>
        <h2 className="mb-4 font-medium text-white">Resolve markets</h2>
        <p className="mb-4 text-sm text-gray-400">Resolve each binary market with outcome YES or NO. After resolution, users can redeem winning shares.</p>
        <div className="space-y-4">
          {count > 0 && Array.from({ length: count }, (_, i) => (
            <MarketRow key={i} marketId={i} />
          ))}
          {count === 0 && <p className="text-gray-500">No markets yet. Create one above.</p>}
        </div>
      </div>
    </div>
  );
}
