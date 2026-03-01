export const BINARY_FACTORY_ABI = [
  { inputs: [], name: "admin", outputs: [{ name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "marketCount", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "", type: "uint256" }], name: "markets", outputs: [{ name: "", type: "address" }], stateMutability: "view", type: "function" },
  {
    inputs: [
      { name: "collateral", type: "address" },
      { name: "questionId", type: "string" },
      { name: "resolutionTime", type: "uint256" },
    ],
    name: "createMarket",
    outputs: [{ name: "marketId", type: "uint256" }, { name: "market", type: "address" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "marketId", type: "uint256" }, { name: "outcome", type: "bool" }],
    name: "resolveMarket",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
