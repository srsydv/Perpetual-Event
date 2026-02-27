export const EVENT_FACTORY_ABI = [
  {
    inputs: [
      { name: "name", type: "string" },
      { name: "resolutionTime", type: "uint256" },
      { name: "oracle", type: "address" },
    ],
    name: "createEvent",
    outputs: [
      { name: "eventId", type: "uint256" },
      { name: "market", type: "address" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "eventId", type: "uint256" }],
    name: "getEvent",
    outputs: [
      {
        components: [
          { name: "name", type: "string" },
          { name: "resolutionTime", type: "uint256" },
          { name: "oracle", type: "address" },
          { name: "market", type: "address" },
          { name: "resolved", type: "bool" },
          { name: "outcome", type: "bool" },
          { name: "paused", type: "bool" },
        ],
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  { inputs: [], name: "eventCount", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "collateral", outputs: [{ name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "admin", outputs: [{ name: "", type: "address" }], stateMutability: "view", type: "function" },
  {
    inputs: [{ name: "eventId", type: "uint256" }, { name: "outcome", type: "bool" }],
    name: "resolveEvent",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
