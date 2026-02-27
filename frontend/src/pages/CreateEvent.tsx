import { useState, useEffect } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { DEPLOYED } from "@/config";
import { EVENT_FACTORY_ABI } from "@/abis/factory";
import { useReadContract } from "wagmi";

const LOADING_TIMEOUT_MS = 5000;

export default function CreateEvent() {
  const { address } = useAccount();
  const [name, setName] = useState("");
  const [resolutionDays, setResolutionDays] = useState("30");
  const [oracle, setOracle] = useState("");
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  const { data: admin, isLoading: adminLoading, isError: adminError, error: adminErrorDetail, refetch: refetchAdmin } = useReadContract({
    address: DEPLOYED.eventFactoryProxy,
    abi: EVENT_FACTORY_ABI,
    functionName: "admin",
  });

  useEffect(() => {
    if (!adminLoading) return;
    const t = setTimeout(() => setLoadingTimedOut(true), LOADING_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [adminLoading]);

  useEffect(() => {
    if (!adminLoading) setLoadingTimedOut(false);
  }, [adminLoading]);

  const adminAddress = admin != null && typeof admin === "string" ? admin : undefined;
  const isAdmin = Boolean(address && adminAddress && address.toLowerCase() === adminAddress.toLowerCase());

  const { writeContract, data: hash } = useWriteContract();
  const { isLoading } = useWaitForTransactionReceipt({ hash });

  const handleCreate = () => {
    if (!name || !oracle) return;
    const resolutionTime = BigInt(Math.floor(Date.now() / 1000) + parseInt(resolutionDays, 10) * 86400);
    writeContract({
      address: DEPLOYED.eventFactoryProxy,
      abi: EVENT_FACTORY_ABI,
      functionName: "createEvent",
      args: [name, resolutionTime, oracle as `0x${string}`],
    });
  };

  const showLoading = adminLoading && !loadingTimedOut;

  if (showLoading) {
    return (
      <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-8 text-center text-gray-500">
        Loading...
      </div>
    );
  }

  if (adminError || adminAddress === undefined) {
    return (
      <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-8 text-center text-gray-500 space-y-3">
        <p>Could not load factory admin.</p>
        {adminErrorDetail && (
          <p className="text-left text-sm text-amber-200/90 break-all max-w-md mx-auto">
            {adminErrorDetail.message}
          </p>
        )}
        <p className="text-sm">Try: switch wallet to Sepolia, or set a Sepolia RPC in <code className="text-gray-400">frontend/.env</code> as <code className="text-gray-400">VITE_SEPOLIA_RPC_URL</code>.</p>
        <button
          type="button"
          onClick={() => refetchAdmin()}
          className="rounded-lg bg-polymarket-blue/80 px-4 py-2 text-white hover:bg-polymarket-blue"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-8 text-center text-gray-500 space-y-2">
        <p>Only the factory admin can create events. Connect with the admin wallet.</p>
        <p className="text-sm break-all">
          Current factory admin: <span className="text-white font-mono">{adminAddress ?? "—"}</span>
        </p>
        {address && (
          <p className="text-sm break-all">
            Connected: <span className="text-white font-mono">{address}</span>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md rounded-xl border border-polymarket-border bg-polymarket-card p-6">
      <h1 className="mb-6 text-xl font-semibold text-white">Create event</h1>
      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400">Event name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Will BTC > $100k by Dec 2026?"
            className="mt-1 w-full rounded-lg border border-polymarket-border bg-polymarket-bg px-3 py-2 text-white placeholder-gray-500"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400">Resolution (days from now)</label>
          <input
            type="number"
            min="1"
            value={resolutionDays}
            onChange={(e) => setResolutionDays(e.target.value)}
            className="mt-1 w-full rounded-lg border border-polymarket-border bg-polymarket-bg px-3 py-2 text-white"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400">Oracle address (can resolve)</label>
          <input
            type="text"
            value={oracle}
            onChange={(e) => setOracle(e.target.value)}
            placeholder="0x..."
            className="mt-1 w-full rounded-lg border border-polymarket-border bg-polymarket-bg px-3 py-2 text-white placeholder-gray-500"
          />
        </div>
        <button
          onClick={handleCreate}
          disabled={isLoading || !name || !oracle}
          className="w-full rounded-lg bg-polymarket-green px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {isLoading ? "Creating..." : "Create event"}
        </button>
      </div>
    </div>
  );
}
