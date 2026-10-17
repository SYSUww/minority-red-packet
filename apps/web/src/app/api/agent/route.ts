import { NextResponse } from "next/server";

import { AGENT_ACTIONS, AGENT_PROTOCOL_VERSION } from "@/lib/agent-protocol";
import { monadTestnet } from "@/lib/chain";
import { resolveContractAddress } from "@/lib/contract-address";

export const dynamic = "force-dynamic";

export function GET() {
  const contractAddress = resolveContractAddress(process.env.NEXT_PUBLIC_CONTRACT_ADDRESS);
  return NextResponse.json({
    name: "Minority Red Packet Agent Protocol",
    protocolVersion: AGENT_PROTOCOL_VERSION,
    chain: { id: 10_143, name: "Monad Testnet", rpcUrl: monadTestnet.rpcUrls.default.http[0], contractAddress },
    adapterConfigured: Boolean(process.env.AGENT_ADAPTER_URL?.trim()),
    endpoints: {
      discovery: "GET /api/agent",
      state: "GET /api/agent/state?roomId={roomId}&playerId={0xAddress}",
      turn: "POST /api/agent/turn",
    },
    flow: ["lobby", "signal", "commit", "reveal", "awaiting-settlement", "settled"],
    actions: AGENT_ACTIONS,
    phaseActions: {
      lobby: ["join", "wait"],
      signal: ["signal", "wait"],
      commit: ["commit", "wait"],
      reveal: ["reveal", "wait"],
      "awaiting-settlement": ["settle", "wait"],
      settled: ["claim", "open_next_round", "wait"],
      cancelled: ["claim", "open_next_round", "wait"],
    },
    execution: {
      mode: "external_wallet",
      note: "模型只返回决策；Agent 自有钱包负责签名。私钥与 Commit Salt 不得传给本接口或模型。",
    },
    adapter: {
      environment: ["AGENT_ADAPTER_URL", "AGENT_ADAPTER_TOKEN (optional)", "AGENT_ADAPTER_TIMEOUT_MS (optional)", "AGENT_RPC_TIMEOUT_MS (optional)", "AGENT_API_TOKEN (recommended in production)"],
      response: { decision: { action: "signal", packetId: 2, confidence: 0.74, rationale: "example" } },
    },
  });
}
