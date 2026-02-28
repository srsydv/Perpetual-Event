import { useParams } from "react-router-dom";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits, formatUnits } from "viem";
import { useState, useEffect } from "react";
import { DEPLOYED, PRECISION } from "@/config";
import { EVENT_FACTORY_ABI } from "@/abis/factory";
import { EVENT_MARKET_ABI } from "@/abis/market";
import { ERC20_ABI } from "@/abis/erc20";
import TradePanel from "@/components/TradePanel";
import OrderBook from "@/components/OrderBook";

export default function Market() {
  const { eventId } = useParams<{ eventId: string }>();
  const id = eventId ? parseInt(eventId, 10) : 0;
  const { address } = useAccount();

  const { data: eventInfo } = useReadContract({
    address: DEPLOYED.eventFactoryProxy,
    abi: EVENT_FACTORY_ABI,
    functionName: "getEvent",
    args: [BigInt(id)],
  });

  const marketAddress = eventInfo?.market as `0x${string}` | undefined;

  const { data: markPrice } = useReadContract({
    address: marketAddress,
    abi: EVENT_MARKET_ABI,
    functionName: "getMarkPrice",
  });
  const { data: balance } = useReadContract({
    address: marketAddress,
    abi: EVENT_MARKET_ABI,
    functionName: "collateralBalance",
    args: address ? [address] : undefined,
  });
  const { data: position } = useReadContract({
    address: marketAddress,
    abi: EVENT_MARKET_ABI,
    functionName: "getPosition",
    args: address ? [address] : undefined,
  });
  const { data: collateralBalance } = useReadContract({
    address: DEPLOYED.collateral,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
  });
  const { data: decimals } = useReadContract({
    address: DEPLOYED.collateral,
    abi: ERC20_ABI,
    functionName: "decimals",
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: DEPLOYED.collateral,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address && marketAddress ? [address, marketAddress] : undefined,
  });

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");

  const { writeContract: approveToken, data: approveHash } = useWriteContract();
  const { writeContract: deposit, data: depositHash } = useWriteContract();
  const { writeContract: withdraw, data: withdrawHash } = useWriteContract();

  const { isLoading: approvePending, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveHash });
  const { isLoading: depositPending } = useWaitForTransactionReceipt({ hash: depositHash });
  const { isLoading: withdrawPending } = useWaitForTransactionReceipt({ hash: withdrawHash });

  // After approve confirms, refetch allowance so Deposit button enables
  useEffect(() => {
    if (approveSuccess && refetchAllowance) refetchAllowance();
  }, [approveSuccess, refetchAllowance]);

  const dec = decimals != null ? Number(decimals) : 6;
  const prob = markPrice != null ? Number(markPrice) / PRECISION : 0.5;
  const pos = position ? { size: position.size, entryPrice: position.entryPrice, isLong: position.isLong } : null;
  const bal = balance != null ? formatUnits(balance, dec) : "0";
  const walletBal = collateralBalance != null ? formatUnits(collateralBalance, dec) : "0";
  const hasAllowance = allowance != null && depositAmount !== "" && allowance >= parseUnits(depositAmount || "0", dec);

  const handleApprove = () => {
    if (!marketAddress || !depositAmount) return;
    approveToken({
      address: DEPLOYED.collateral,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [marketAddress, parseUnits(depositAmount, dec)],
    });
  };
  const handleDeposit = () => {
    if (!marketAddress || !depositAmount) return;
    deposit({
      address: marketAddress,
      abi: EVENT_MARKET_ABI,
      functionName: "deposit",
      args: [parseUnits(depositAmount, dec)],
    });
  };
  const handleWithdraw = () => {
    if (!marketAddress || !withdrawAmount) return;
    withdraw({
      address: marketAddress,
      abi: EVENT_MARKET_ABI,
      functionName: "withdraw",
      args: [parseUnits(withdrawAmount, dec)],
    });
  };

  if (!eventInfo) return <div className="text-gray-500">Loading...</div>;
  const { name, resolutionTime, resolved: eventResolved, outcome: eventOutcome } = eventInfo;
  const resolutionDate = new Date(Number(resolutionTime) * 1000);

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-6">
        <h1 className="text-xl font-semibold text-white">{name}</h1>
        <p className="mt-1 text-gray-500">Resolves {resolutionDate.toLocaleString()}</p>
        <div className="mt-4 flex gap-8">
          <div>
            <p className="text-sm text-gray-500">Probability (YES)</p>
            <p className="text-3xl font-bold text-polymarket-green">{Math.round(prob * 100)}%</p>
          </div>
          {eventResolved && (
            <div>
              <p className="text-sm text-gray-500">Outcome</p>
              <p className={`text-xl font-semibold ${eventOutcome ? "text-polymarket-green" : "text-polymarket-red"}`}>
                {eventOutcome ? "YES" : "NO"}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {marketAddress && <OrderBook marketAddress={marketAddress} />}
          <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-6">
            <h2 className="mb-4 font-medium text-white">Position</h2>
            {pos && pos.size > 0n ? (
              <div className="space-y-1 text-sm">
                <p>Side: {pos.isLong ? "Long (YES)" : "Short (NO)"}</p>
                <p>Size: {formatUnits(pos.size, 18)}</p>
                <p>Entry: {Math.round(Number(pos.entryPrice) / 1e18 * 100)}%</p>
              </div>
            ) : (
              <p className="text-gray-500">No position</p>
            )}
          </div>

          {!eventResolved && marketAddress && (
            <TradePanel marketAddress={marketAddress} eventId={id} />
          )}
          {eventResolved && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200">
              Market resolved. Use settleAndWithdraw to claim.
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-6">
            <h2 className="mb-4 font-medium text-white">Balance</h2>
            <p className="text-gray-400">In market: <span className="text-white">{bal}</span></p>
            <p className="text-gray-400">Wallet: <span className="text-white">{walletBal}</span></p>
          </div>

          {!eventResolved && address && (
            <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-6">
              <h2 className="mb-4 font-medium text-white">Deposit / Withdraw</h2>
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Amount to deposit"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="w-full rounded-lg border border-polymarket-border bg-polymarket-bg px-3 py-2 text-white placeholder-gray-500"
                />
                <div className="flex gap-2">
                  {!hasAllowance && depositAmount ? (
                    <button
                      onClick={handleApprove}
                      disabled={approvePending}
                      className="rounded-lg bg-polymarket-blue px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {approvePending ? "Approving..." : "Approve"}
                    </button>
                  ) : null}
                  <button
                    onClick={handleDeposit}
                    disabled={depositPending || !depositAmount || !hasAllowance}
                    className="rounded-lg bg-polymarket-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {depositPending ? "Depositing..." : "Deposit"}
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Amount to withdraw"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  className="w-full rounded-lg border border-polymarket-border bg-polymarket-bg px-3 py-2 text-white placeholder-gray-500"
                />
                <button
                  onClick={handleWithdraw}
                  disabled={withdrawPending || !withdrawAmount}
                  className="w-full rounded-lg bg-polymarket-red/80 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {withdrawPending ? "Withdrawing..." : "Withdraw"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
