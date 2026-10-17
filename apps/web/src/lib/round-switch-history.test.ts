import { describe, expect, it } from "vitest";

import type { PlayerHistoryRecord } from "./player-history";
import { summarizeRoundSwitches, upsertRoundSwitch } from "./round-switch-history";

function record(round: number, player: string, behavior: "kept" | "switched"): PlayerHistoryRecord {
  return {
    id: `${round}:${player}`,
    recordedAt: "2026-10-17T00:00:00.000Z",
    source: "mock",
    roomId: "demo",
    roundId: `demo:${round}`,
    round,
    player: { id: player, displayName: player, isMock: true },
    submission: { publicSide: null, secretSide: null, amount: { wei: "1", mon: "0.000000000000000001" } },
    actualResult: {
      winningSide: null,
      packetCounts: [0, 0, 0, 0],
      winnerCount: 0,
      behavior,
      outcome: "refunded",
      payout: { wei: "1", mon: "0.000000000000000001" },
    },
  };
}

describe("round switch history", () => {
  it("groups switchers by round", () => {
    expect(summarizeRoundSwitches([
      record(1, "a", "switched"),
      record(1, "b", "kept"),
      record(2, "a", "switched"),
      record(2, "b", "switched"),
    ])).toEqual([
      { round: 1, switchedCount: 1, totalPlayers: 2 },
      { round: 2, switchedCount: 2, totalPlayers: 2 },
    ]);
  });

  it("updates the current round without duplicating it", () => {
    expect(upsertRoundSwitch(
      [{ round: 1, switchedCount: 1, totalPlayers: 8 }],
      { round: 1, switchedCount: 3, totalPlayers: 8 },
    )).toEqual([{ round: 1, switchedCount: 3, totalPlayers: 8 }]);
  });
});
