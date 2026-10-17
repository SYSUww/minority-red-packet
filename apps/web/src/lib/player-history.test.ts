import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createHistoryRecord, parseHistoryRecordInput, type HistoryRecordInput } from "./player-history";
import { appendPlayerHistory, readPlayerHistory, summarizePlayerHistory } from "./player-history-store";

let temporaryDirectory = "";

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "minority-history-"));
  process.env.PLAYER_HISTORY_PATH = join(temporaryDirectory, "player-history.json");
});

afterEach(async () => {
  delete process.env.PLAYER_HISTORY_PATH;
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

describe("player history", () => {
  it("normalizes a revealed round into an LLM-friendly record without secret material", () => {
    const input = parseHistoryRecordInput(recordInput());
    const record = createHistoryRecord(input, "2026-10-17T00:00:00.000Z");

    expect(record.submission).toEqual({
      publicSide: { packetId: 0, label: "青禾" },
      secretSide: { packetId: 3, label: "鎏金" },
      amount: { wei: "8000000000000000000", mon: "8" },
    });
    expect(record.actualResult).toMatchObject({
      winningSide: { packetId: 3, label: "鎏金" },
      behavior: "switched",
      outcome: "won",
      payout: { wei: "17000000000000000000", mon: "17" },
    });
    expect(JSON.stringify(record)).not.toContain("salt");
    expect(JSON.stringify(record)).not.toContain("commitment");
  });

  it("rejects a winner whose revealed side does not match the winning side", () => {
    expect(() => parseHistoryRecordInput({ ...recordInput(), secretPacketId: 2 })).toThrow(
      "winner secretPacketId must match winningPacketId",
    );
  });

  it("atomically maintains the JSON ledger and filters a player's history", async () => {
    const first = recordInput();
    const second = { ...recordInput(), playerId: "mock-p2", displayName: "Mock 阿洛", isMock: true, outcome: "lost" as const, secretPacketId: 0 as const, behavior: "kept" as const, payoutWei: "0" };

    await appendPlayerHistory([first, second]);
    const playerHistory = await readPlayerHistory({ playerId: first.playerId });
    const saved = JSON.parse(await readFile(process.env.PLAYER_HISTORY_PATH!, "utf8"));

    expect(saved.records).toHaveLength(2);
    expect(playerHistory.records).toHaveLength(1);
    expect(summarizePlayerHistory(playerHistory.records)).toMatchObject({
      rounds: 1,
      wins: 1,
      switches: 1,
      netWei: "9000000000000000000",
    });
  });
});

function recordInput(): HistoryRecordInput {
  return {
    roundId: "session-1:round-1",
    source: "mock",
    roomId: "LOCAL-TEST:session-1",
    round: 1,
    playerId: "local-p1",
    displayName: "你",
    isMock: false,
    publicPacketId: 0,
    secretPacketId: 3,
    stakeWei: "8000000000000000000",
    winningPacketId: 3,
    packetCounts: [1, 1, 1, 1],
    winnerCount: 1,
    behavior: "switched",
    outcome: "won",
    payoutWei: "17000000000000000000",
  };
}
