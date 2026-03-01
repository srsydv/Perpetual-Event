import { useParams, Link } from "react-router-dom";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits, formatUnits } from "viem";
import { useState, useEffect } from "react";
import { DEPLOYED } from "@/config";
import { BINARY_MARKET_ABI } from "@/abis/binaryMarket";
import { ERC20_ABI } from "@/abis/erc20";
import TradePanel from "@/components/TradePanel";
import OrderBook from "@/components/OrderBook";

export default function Market() {
  const { marketId: marketIdParam } = useParams<{ marketId: string }>();
  const id = marketIdParam ?? "0";
  const marketAddress = (DEPLOYED.markets[id] || "") as `0x${string}` | undefined;
  const { address } = useAccount();

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
  const { data: balance } = useReadContract({
    address: marketAddress,
    abi: BINARY_MARKET_ABI,
    functionName: "collateralBalance",
    args: address ? [address] : undefined,
  });
  const { data: yesBal } = useReadContract({
    address: marketAddress,
    abi: BINARY_MARKET_ABI,
    functionName: "yesBalance",
    args: address ? [address] : undefined,
  });
  const { data: noBal } = useReadContract({
    address: marketAddress,
    abi: BINARY_MARKET_ABI,
    functionName: "noBalance",
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
  const [mintAmount, setMintAmount] = useState("");
  const [mergeAmount, setMergeAmount] = useState("");

  const { writeContract: approveToken, data: approveHash } = useWriteContract();
  const { writeContract: deposit, data: depositHash } = useWriteContract();
  const { writeContract: withdraw, data: withdrawHash } = useWriteContract();
  const { writeContract: mintShares, data: mintHash } = useWriteContract();
  const { writeContract: mergeShares, data: mergeHash } = useWriteContract();
  const { writeContract: redeem, data: redeemHash } = useWriteContract();

  const { isLoading: approvePending, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveHash });
  const { isLoading: depositPending } = useWaitForTransactionReceipt({ hash: depositHash });
  const { isLoading: withdrawPending } = useWaitForTransactionReceipt({ hash: withdrawHash });
  const { isLoading: mintPending } = useWaitForTransactionReceipt({ hash: mintHash });
  const { isLoading: mergePending } = useWaitForTransactionReceipt({ hash: mergeHash });
  const { isLoading: redeemPending } = useWaitForTransactionReceipt({ hash: redeemHash });

  useEffect(() => {
    if (approveSuccess && refetchAllowance) refetchAllowance();
  }, [approveSuccess, refetchAllowance]);

  const dec = decimals != null ? Number(decimals) : 18;
  const bal = balance != null ? formatUnits(balance, dec) : "0";
  const walletBal = collateralBalance != null ? formatUnits(collateralBalance, dec) : "0";
  const yesBalance = yesBal != null ? formatUnits(yesBal, dec) : "0";
  const noBalance = noBal != null ? formatUnits(noBal, dec) : "0";
  const hasAllowance =
    allowance != null && depositAmount !== "" && allowance >= parseUnits(depositAmount || "0", dec);
  const isResolved = resolved === true;
  const outcomeYes = outcome === true;

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
      abi: BINARY_MARKET_ABI,
      functionName: "deposit",
      args: [parseUnits(depositAmount, dec)],
    });
  };
  const handleWithdraw = () => {
    if (!marketAddress || !withdrawAmount) return;
    withdraw({
      address: marketAddress,
      abi: BINARY_MARKET_ABI,
      functionName: "withdraw",
      args: [parseUnits(withdrawAmount, dec)],
    });
  };
  const handleMint = () => {
    if (!marketAddress || !mintAmount) return;
    mintShares({
      address: marketAddress,
      abi: BINARY_MARKET_ABI,
      functionName: "mintShares",
      args: [parseUnits(mintAmount, dec)],
    });
  };
  const handleMerge = () => {
    if (!marketAddress || !mergeAmount) return;
    mergeShares({
      address: marketAddress,
      abi: BINARY_MARKET_ABI,
      functionName: "mergeShares",
      args: [parseUnits(mergeAmount, dec)],
    });
  };
  const handleRedeem = () => {
    if (!marketAddress) return;
    redeem({
      address: marketAddress,
      abi: BINARY_MARKET_ABI,
      functionName: "redeem",
    });
  };

  const redeemableYes = outcomeYes && yesBal != null && yesBal > 0n;
  const redeemableNo = !outcomeYes && noBal != null && noBal > 0n;

  if (!marketAddress || marketAddress === "0x0000000000000000000000000000000000000000") {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200">
        <p>Market not configured. Run <code>npx hardhat run scripts/deploy-binary.js --network sepolia</code> and set VITE_BINARY_MARKET_0 (or VITE_BINARY_DEPLOY_JSON) in .env.</p>
        <Link to="/" className="mt-2 inline-block text-polymarket-blue">← Home</Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-6">
        <h1 className="text-xl font-semibold text-white">Binary Market (Polymarket-style)</h1>
        <p className="mt-1 text-gray-500">Market ID: {id}</p>
        <div className="mt-4 flex gap-8">
          {isResolved && (
            <div>
              <p className="text-sm text-gray-500">Outcome</p>
              <p className={`text-xl font-semibold ${outcomeYes ? "text-polymarket-green" : "text-polymarket-red"}`}>
                {outcomeYes ? "YES" : "NO"}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {marketAddress && <OrderBook marketAddress={marketAddress} />}
          <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-6">
            <h2 className="mb-4 font-medium text-white">Shares</h2>
            <div className="space-y-1 text-sm">
              <p className="text-polymarket-green">YES: <span className="text-white">{yesBalance}</span></p>
              <p className="text-polymarket-red">NO: <span className="text-white">{noBalance}</span></p>
            </div>
          </div>

          {!isResolved && marketAddress && (
            <TradePanel marketAddress={marketAddress} eventId={parseInt(id, 10)} />
          )}
          {isResolved && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200">
              Market resolved. Redeem winning shares below.
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-6">
            <h2 className="mb-4 font-medium text-white">Balance</h2>
            <p className="text-gray-400">In market (collateral): <span className="text-white">{bal}</span></p>
            <p className="text-gray-400">Wallet: <span className="text-white">{walletBal}</span></p>
          </div>

          {!isResolved && address && (
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

          {!isResolved && address && (
            <div className="rounded-xl border border-polymarket-border bg-polymarket-card p-6">
              <h2 className="mb-4 font-medium text-white">Mint / Merge shares</h2>
              <p className="mb-2 text-xs text-gray-500">Mint: convert collateral into 1 YES + 1 NO per unit. Merge: convert 1 YES + 1 NO back to collateral.</p>
              <input
                type="text"
                placeholder="Amount to mint"
                value={mintAmount}
                onChange={(e) => setMintAmount(e.target.value)}
                className="mb-2 w-full rounded-lg border border-polymarket-border bg-polymarket-bg px-3 py-2 text-white placeholder-gray-500"
              />
              <button
                onClick={handleMint}
                disabled={mintPending || !mintAmount}
                className="mb-3 w-full rounded-lg bg-polymarket-blue px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {mintPending ? "Minting..." : "Mint shares"}
              </button>
              <input
                type="text"
                placeholder="Amount to merge"
                value={mergeAmount}
                onChange={(e) => setMergeAmount(e.target.value)}
                className="w-full rounded-lg border border-polymarket-border bg-polymarket-bg px-3 py-2 text-white placeholder-gray-500"
              />
              <button
                onClick={handleMerge}
                disabled={mergePending || !mergeAmount}
                className="mt-2 w-full rounded-lg bg-gray-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {mergePending ? "Merging..." : "Merge shares"}
              </button>
            </div>
          )}

          {isResolved && (redeemableYes || redeemableNo) && (
            <div className="rounded-xl border border-polymarket-green/40 bg-polymarket-green/10 p-6">
              <h2 className="mb-2 font-medium text-white">Redeem</h2>
              <p className="mb-3 text-sm text-gray-400">
                {outcomeYes ? "YES won. Redeem YES shares for 1:1 collateral." : "NO won. Redeem NO shares for 1:1 collateral."}
              </p>
              <button
                onClick={handleRedeem}
                disabled={redeemPending}
                className="w-full rounded-lg bg-polymarket-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {redeemPending ? "Redeeming..." : "Redeem"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
