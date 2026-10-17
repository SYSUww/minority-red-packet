import { describe, expect, it } from "vitest";

import { buildPlayerIntelProfiles, inferPreference, type PlayerIntelRound } from "./player-intelligence";

function round(roundNumber: number, secretPacketId: 0 | 1 | 2 | 3, outcome: "won" | "lost" = "lost"): PlayerIntelRound {
  return {
    round: roundNumber,
    publicPacketId: secretPacketId,
    secretPacketId,
    stakeWei: 1n,
    payoutWei: outcome === "won" ? 2n : 0n,
    outcome,
  };
}

describe("player intelligence", () => {
  it("infers preference from the most frequent settled secret choice", () => {
    expect(inferPreference([round(3, 2), round(2, 1), round(1, 2)], 0)).toBe(2);
  });

  it("uses the most recent choice to break a preference tie", () => {
    expect(inferPreference([round(2, 3), round(1, 1)], 0)).toBe(3);
  });

  it("keeps only one entry per round and lets the live settlement win", () => {
    const profiles = buildPlayerIntelProfiles([], [{ id: "you", displayName: "你", isSelf: true, fallbackPreferencePacketId: 0 }], {
      you: round(1, 2, "won"),
    });
    expect(profiles[0].rounds).toEqual([round(1, 2, "won")]);
    expect(profiles[0].preferencePacketId).toBe(2);
  });
});
