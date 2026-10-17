import { formatEther } from "viem";

import { PACKETS, type PacketId } from "./game-config";

export const HISTORY_VERSION = 1 as const;
export const HISTORY_SOURCES = ["mock", "onchain"] as const;
export const PLAYER_BEHAVIORS = ["kept", "switched", "abstained"] as const;
export const PLAYER_OUTCOMES = ["won", "lost", "refunded"] as const;

export type HistorySource = (typeof HISTORY_SOURCES)[number];
export type PlayerBehavior = (typeof PLAYER_BEHAVIORS)[number];
export type PlayerOutcome = (typeof PLAYER_OUTCOMES)[number];

export type HistoryRecordInput = Readonly<{
  roundId: string;
  source: HistorySource;
  roomId: string;
  round: number;
  playerId: string;
  displayName: string;
  isMock: boolean;
  publicPacketId: PacketId | null;
  secretPacketId: PacketId | null;
  stakeWei: string;
  winningPacketId: PacketId | null;
  packetCounts: readonly [number, number, number, number];
  winnerCount: number;
  behavior: PlayerBehavior;
  outcome: PlayerOutcome;
  payoutWei: string;
}>;

export type PacketReference = Readonly<{
  packetId: PacketId;
  label: string;
}>;

export type PlayerHistoryRecord = Readonly<{
  id: string;
  recordedAt: string;
  source: HistorySource;
  roomId: string;
  roundId: string;
  round: number;
  player: Readonly<{
    id: string;
    displayName: string;
    isMock: boolean;
  }>;
  submission: Readonly<{
    publicSide: PacketReference | null;
    secretSide: PacketReference | null;
    amount: Readonly<{ wei: string; mon: string }>;
  }>;
  actualResult: Readonly<{
    winningSide: PacketReference | null;
    packetCounts: readonly [number, number, number, number];
    winnerCount: number;
    behavior: PlayerBehavior;
    outcome: PlayerOutcome;
    payout: Readonly<{ wei: string; mon: string }>;
  }>;
}>;

export type PlayerHistoryFile = Readonly<{
  version: typeof HISTORY_VERSION;
  updatedAt: string | null;
  records: readonly PlayerHistoryRecord[];
}>;

export function emptyHistoryFile(): PlayerHistoryFile {
  return { version: HISTORY_VERSION, updatedAt: null, records: [] };
}

export function parseHistoryRecordInput(value: unknown): HistoryRecordInput {
  if (!isObject(value)) throw new Error("history record must be an object");

  const publicPacketId = parsePacketId(value.publicPacketId, "publicPacketId", true);
  const secretPacketId = parsePacketId(value.secretPacketId, "secretPacketId", true);
  const winningPacketId = parsePacketId(value.winningPacketId, "winningPacketId", true);
  const behavior = parseEnum(value.behavior, PLAYER_BEHAVIORS, "behavior");
  const outcome = parseEnum(value.outcome, PLAYER_OUTCOMES, "outcome");
  const packetCounts = parsePacketCounts(value.packetCounts);

  if (behavior === "abstained" && secretPacketId !== null) {
    throw new Error("abstained records cannot have a secretPacketId");
  }
  if (behavior !== "abstained" && (publicPacketId === null || secretPacketId === null)) {
    throw new Error("kept or switched records require both packet choices");
  }
  if (outcome === "won" && secretPacketId !== winningPacketId) {
    throw new Error("winner secretPacketId must match winningPacketId");
  }
  if (winningPacketId === null && outcome !== "refunded") {
    throw new Error("a round without a winning packet must be refunded");
  }

  return {
    roundId: parseText(value.roundId, "roundId"),
    source: parseEnum(value.source, HISTORY_SOURCES, "source"),
    roomId: parseText(value.roomId, "roomId"),
    round: parseInteger(value.round, "round", 1),
    playerId: parseText(value.playerId, "playerId"),
    displayName: parseText(value.displayName, "displayName"),
    isMock: parseBoolean(value.isMock, "isMock"),
    publicPacketId,
    secretPacketId,
    stakeWei: parseWei(value.stakeWei, "stakeWei", false),
    winningPacketId,
    packetCounts,
    winnerCount: parseInteger(value.winnerCount, "winnerCount", 0),
    behavior,
    outcome,
    payoutWei: parseWei(value.payoutWei, "payoutWei", true),
  };
}

export function createHistoryRecord(input: HistoryRecordInput, recordedAt: string): PlayerHistoryRecord {
  return {
    id: `${input.roundId}:${input.playerId}`,
    recordedAt,
    source: input.source,
    roomId: input.roomId,
    roundId: input.roundId,
    round: input.round,
    player: {
      id: input.playerId,
      displayName: input.displayName,
      isMock: input.isMock,
    },
    submission: {
      publicSide: packetReference(input.publicPacketId),
      secretSide: packetReference(input.secretPacketId),
      amount: { wei: input.stakeWei, mon: formatEther(BigInt(input.stakeWei)) },
    },
    actualResult: {
      winningSide: packetReference(input.winningPacketId),
      packetCounts: input.packetCounts,
      winnerCount: input.winnerCount,
      behavior: input.behavior,
      outcome: input.outcome,
      payout: { wei: input.payoutWei, mon: formatEther(BigInt(input.payoutWei)) },
    },
  };
}

function packetReference(packetId: PacketId | null): PacketReference | null {
  if (packetId === null) return null;
  return { packetId, label: PACKETS[packetId].name };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 160) {
    throw new Error(`${field} must be a non-empty string up to 160 characters`);
  }
  return value.trim();
}

function parseBoolean(value: unknown, field: string) {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  return value;
}

function parseInteger(value: unknown, field: string, minimum: number) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new Error(`${field} must be an integer greater than or equal to ${minimum}`);
  }
  return Number(value);
}

function parseWei(value: unknown, field: string, allowZero: boolean) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(`${field} must be an unsigned integer string`);
  }
  const amount = BigInt(value);
  if (allowZero ? amount < 0n : amount <= 0n) {
    throw new Error(`${field} must be ${allowZero ? "non-negative" : "positive"}`);
  }
  return amount.toString();
}

function parsePacketId(value: unknown, field: string, nullable: boolean): PacketId | null {
  if (nullable && value === null) return null;
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 3) {
    throw new Error(`${field} must be a packet id from 0 to 3${nullable ? " or null" : ""}`);
  }
  return Number(value) as PacketId;
}

function parsePacketCounts(value: unknown): [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error("packetCounts must contain exactly four counts");
  }
  return value.map((count, index) => parseInteger(count, `packetCounts[${index}]`, 0)) as [number, number, number, number];
}

function parseEnum<const T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T[number];
}
