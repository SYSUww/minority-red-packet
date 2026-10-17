import { createPublicClient, getAddress, http, isAddress, type Address } from "viem";

import { buildAgentObservation } from "./agent-protocol";
import { monadTestnet } from "./chain";
import { resolveContractAddress } from "./contract-address";
import { OnchainGameGateway } from "./onchain-game-gateway";

export class AgentRequestError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

export async function readAgentObservation(roomValue: unknown, playerValue: unknown) {
  const roomId = parseRoomId(roomValue);
  const playerAddress = parsePlayerAddress(playerValue);
  const contractAddress = resolveContractAddress(process.env.NEXT_PUBLIC_CONTRACT_ADDRESS);
  if (!contractAddress) throw new AgentRequestError("NEXT_PUBLIC_CONTRACT_ADDRESS is not configured", 503);

  const rpcTimeout = parseRpcTimeout(process.env.AGENT_RPC_TIMEOUT_MS);
  const client = createPublicClient({
    chain: monadTestnet,
    transport: http(monadTestnet.rpcUrls.default.http[0], { retryCount: 1, timeout: rpcTimeout }),
  });
  const gateway = new OnchainGameGateway(contractAddress, client as never);
  try {
    const snapshot = await gateway.readSnapshot(roomId);
    if (!snapshot.game.exists) throw new AgentRequestError("room does not exist", 404);
    let claimableWei = 0n;
    const warnings: string[] = [];
    try {
      claimableWei = await gateway.readClaimable(roomId, playerAddress);
    } catch {
      warnings.push("claimable balance is unavailable on the configured deployment; claim is omitted from legalActions");
    }
    return buildAgentObservation({ snapshot, playerAddress, contractAddress, roomId, claimableWei, warnings });
  } catch (error) {
    if (error instanceof AgentRequestError) throw error;
    throw new AgentRequestError(error instanceof Error ? `failed to read Monad state: ${error.message}` : "failed to read Monad state", 502);
  }
}

export function chainHistoryRoomId(contractAddress: Address, roomId: string) {
  return `MONAD-10143:${contractAddress.toLowerCase()}:${roomId}`;
}

function parseRoomId(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") throw new AgentRequestError("roomId is required");
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) throw new AgentRequestError("roomId must be an unsigned integer string");
  return BigInt(text);
}

function parsePlayerAddress(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value)) throw new AgentRequestError("playerId must be a valid EVM address");
  return getAddress(value);
}

function parseRpcTimeout(value: string | undefined) {
  const parsed = value ? Number(value) : 8_000;
  return Number.isSafeInteger(parsed) && parsed >= 1_000 && parsed <= 30_000 ? parsed : 8_000;
}
