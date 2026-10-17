import type { Address } from "viem";

import { PACKETS, type PacketId } from "./game-config";
import type { ChainGameSnapshot, ChainPhase, ChainPlayer } from "./onchain-game-gateway";

export const AGENT_PROTOCOL_VERSION = "1.0" as const;
export const AGENT_ACTIONS = ["join", "signal", "commit", "reveal", "settle", "claim", "open_next_round", "wait"] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

export type AgentObservation = Readonly<{
  protocolVersion: typeof AGENT_PROTOCOL_VERSION;
  event: "minority-red-packet.turn";
  eventId: string;
  warnings: readonly string[];
  chain: Readonly<{ id: 10143; name: "Monad Testnet"; contractAddress: Address }>;
  roomId: string;
  round: number;
  phase: ChainPhase;
  block: Readonly<{ current: string; deadline: string | null; remaining: string }>;
  game: Readonly<{
    totalPlayers: number;
    potWei: string;
    publicCounts: readonly [number, number, number, number];
    revealedCounts: readonly [number, number, number, number] | null;
    winnerPacketId: PacketId | null;
  }>;
  self: Readonly<{
    address: Address;
    joined: boolean;
    stakeWei: string;
    publicPacketId: PacketId | null;
    hasCommitted: boolean;
    revealedPacketId: PacketId | null;
    claimableWei: string;
  }>;
  players: readonly Readonly<{
    address: Address;
    joined: boolean;
    stakeWei: string;
    publicPacketId: PacketId | null;
    hasCommitted: boolean;
    revealedPacketId: PacketId | null;
  }>[];
  legalActions: readonly AgentAction[];
}>;

export type AgentDecision = Readonly<{
  action: AgentAction;
  packetId?: PacketId;
  stakeUnits?: number;
  lobbyBlocks?: number;
  confidence?: number;
  rationale?: string;
}>;

export function buildAgentObservation(input: {
  snapshot: ChainGameSnapshot;
  playerAddress: Address;
  contractAddress: Address;
  roomId: bigint;
  claimableWei: bigint;
  warnings?: readonly string[];
}): AgentObservation {
  const { snapshot, playerAddress, contractAddress, roomId, claimableWei } = input;
  const self = snapshot.players.find((player) => player.address.toLowerCase() === playerAddress.toLowerCase());
  const publicCounts: [number, number, number, number] = [0, 0, 0, 0];
  for (const player of snapshot.players) {
    if (player.hasSignaled && player.signalPacket >= 0 && player.signalPacket < PACKETS.length) publicCounts[player.signalPacket] += 1;
  }
  const truthVisible = snapshot.phase === "reveal" || snapshot.phase === "awaiting-settlement" || snapshot.phase === "settled";
  const deadline = phaseDeadline(snapshot);
  const legalActions = deriveLegalActions(snapshot.phase, self, claimableWei);
  const playerState = self ?? emptyPlayer(playerAddress);

  return {
    protocolVersion: AGENT_PROTOCOL_VERSION,
    event: "minority-red-packet.turn",
    eventId: `${roomId.toString()}:${snapshot.game.roundNumber.toString()}:${snapshot.phase}:${snapshot.blockNumber.toString()}`,
    warnings: input.warnings ?? [],
    chain: { id: 10_143, name: "Monad Testnet", contractAddress },
    roomId: roomId.toString(),
    round: Number(snapshot.game.roundNumber),
    phase: snapshot.phase,
    block: {
      current: snapshot.blockNumber.toString(),
      deadline: deadline?.toString() ?? null,
      remaining: deadline === null || deadline <= snapshot.blockNumber ? "0" : (deadline - snapshot.blockNumber).toString(),
    },
    game: {
      totalPlayers: snapshot.game.playerCount,
      potWei: snapshot.game.pot.toString(),
      publicCounts,
      revealedCounts: truthVisible ? tupleCounts(snapshot.revealedCounts) : null,
      winnerPacketId: snapshot.phase === "settled" && snapshot.game.winnerPacket < PACKETS.length ? snapshot.game.winnerPacket as PacketId : null,
    },
    self: { ...publicPlayerState(playerState, truthVisible), claimableWei: claimableWei.toString() },
    players: snapshot.players.map((player) => publicPlayerState(player, truthVisible)),
    legalActions,
  };
}

export function parseAgentDecision(value: unknown, legalActions: readonly AgentAction[]): AgentDecision {
  const candidate = isObject(value) && isObject(value.decision) ? value.decision : value;
  if (!isObject(candidate) || typeof candidate.action !== "string" || !AGENT_ACTIONS.includes(candidate.action as AgentAction)) {
    throw new Error("adapter decision.action must be a supported action");
  }
  const action = candidate.action as AgentAction;
  if (!legalActions.includes(action)) throw new Error(`action ${action} is not legal in the current phase`);

  const decision: { action: AgentAction; packetId?: PacketId; stakeUnits?: number; lobbyBlocks?: number; confidence?: number; rationale?: string } = { action };
  if (action === "signal" || action === "commit") decision.packetId = integer(candidate.packetId, "packetId", 0, 3) as PacketId;
  if (action === "join") decision.stakeUnits = integer(candidate.stakeUnits, "stakeUnits", 1, 10);
  if (action === "open_next_round") decision.lobbyBlocks = integer(candidate.lobbyBlocks, "lobbyBlocks", 1, 1_000_000);
  if (candidate.confidence !== undefined) {
    if (typeof candidate.confidence !== "number" || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) {
      throw new Error("confidence must be a number from 0 to 1");
    }
    decision.confidence = candidate.confidence;
  }
  if (candidate.rationale !== undefined) {
    if (typeof candidate.rationale !== "string" || candidate.rationale.length > 2_000) throw new Error("rationale must be a string up to 2000 characters");
    decision.rationale = candidate.rationale;
  }
  return decision;
}

export function buildExecutionPlan(decision: AgentDecision, observation: AgentObservation) {
  const roomId = observation.roomId;
  switch (decision.action) {
    case "join":
      return { mode: "external_wallet", functionName: "joinGame", args: [roomId], valueWei: (BigInt(decision.stakeUnits ?? 0) * 10n ** 18n).toString() } as const;
    case "signal":
      return { mode: "external_wallet", functionName: "signalChoice", args: [roomId, decision.packetId] } as const;
    case "commit":
      return {
        mode: "external_wallet",
        functionName: "commitChoice",
        args: [roomId, "<commitment>"],
        privateStateRequired: true,
        instruction: "在 Agent 本地生成 bytes32 Salt，按合约 makeCommitment 的域生成 commitment；仅发送 commitment，并保存 packetId 与 Salt。",
        packetId: decision.packetId,
      } as const;
    case "reveal":
      return { mode: "external_wallet", functionName: "revealChoice", args: [roomId, "<savedPacketId>", "<savedSalt>"], privateStateRequired: true } as const;
    case "settle":
      return { mode: "external_wallet", functionName: "settle", args: [roomId] } as const;
    case "claim":
      return { mode: "external_wallet", functionName: "claim", args: [roomId, observation.self.address] } as const;
    case "open_next_round":
      return { mode: "external_wallet", functionName: "openNextRound", args: [roomId, decision.lobbyBlocks] } as const;
    default:
      return { mode: "none" } as const;
  }
}

export function agentResponseSchema(legalActions: readonly AgentAction[]) {
  return {
    type: "object",
    required: ["action"],
    properties: {
      action: { type: "string", enum: legalActions },
      packetId: { type: "integer", minimum: 0, maximum: 3, description: "signal/commit 必填" },
      stakeUnits: { type: "integer", minimum: 1, maximum: 10, description: "join 必填" },
      lobbyBlocks: { type: "integer", minimum: 1, maximum: 1_000_000, description: "open_next_round 必填" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      rationale: { type: "string", maxLength: 2_000 },
    },
  } as const;
}

function deriveLegalActions(phase: ChainPhase, self: ChainPlayer | undefined, claimableWei: bigint): AgentAction[] {
  const actions: AgentAction[] = [];
  const committed = Boolean(self && self.commitment !== emptyHash());
  if (phase === "lobby" && !self?.joined) actions.push("join");
  if (phase === "signal" && self?.joined) actions.push("signal");
  if (phase === "commit" && self?.joined && self.hasSignaled && !committed) actions.push("commit");
  if (phase === "reveal" && committed && !self?.revealed) actions.push("reveal");
  if (phase === "awaiting-settlement") actions.push("settle");
  if ((phase === "settled" || phase === "cancelled") && claimableWei > 0n) actions.push("claim");
  if (phase === "settled" || phase === "cancelled") actions.push("open_next_round");
  actions.push("wait");
  return actions;
}

function publicPlayerState(player: ChainPlayer, truthVisible: boolean) {
  return {
    address: player.address,
    joined: player.joined,
    stakeWei: player.stakeAmount.toString(),
    publicPacketId: player.hasSignaled ? player.signalPacket as PacketId : null,
    hasCommitted: player.commitment !== emptyHash(),
    revealedPacketId: truthVisible && player.revealed ? player.revealedPacket as PacketId : null,
  };
}

function emptyPlayer(address: Address): ChainPlayer {
  return { address, stakeAmount: 0n, commitment: emptyHash(), signalPacket: 0, revealedPacket: 0, joined: false, hasSignaled: false, revealed: false, payout: 0n };
}

function phaseDeadline(snapshot: ChainGameSnapshot) {
  if (snapshot.phase === "lobby") return snapshot.game.joinEndBlock;
  if (snapshot.phase === "signal") return snapshot.game.signalEndBlock;
  if (snapshot.phase === "commit") return snapshot.game.commitEndBlock;
  if (snapshot.phase === "reveal") return snapshot.game.revealEndBlock;
  return null;
}

function tupleCounts(counts: readonly number[]): [number, number, number, number] {
  return [counts[0] ?? 0, counts[1] ?? 0, counts[2] ?? 0, counts[3] ?? 0];
}

function emptyHash() {
  return `0x${"0".repeat(64)}` as const;
}

function integer(value: unknown, field: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`);
  return Number(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
