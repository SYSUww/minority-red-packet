import { describe, expect, it } from "vitest";

import { createMockRoundPlayers, settleMockRound } from "./mock-round";

describe("mock round presentation", () => {
  it("derives the live counts, switchers and payout from one shared round", () => {
    const round = settleMockRound(createMockRoundPlayers({
      name: "测试玩家",
      signalPacketId: 0,
      secretPacketId: 2,
      stakeUnits: 3,
    }));

    expect(round.publicCounts).toEqual([2, 2, 1, 3]);
    expect(round.finalCounts).toEqual([2, 2, 1, 3]);
    expect(round.switchedCount).toBe(3);
    expect(round.winnerPacketId).toBe(2);
    expect(round.results.find((player) => player.id === "you")?.payoutWei).toBe(12n * 10n ** 18n);
  });

  it("ignores an empty packet when choosing the minority", () => {
    const round = settleMockRound(createMockRoundPlayers({
      name: "测试玩家",
      signalPacketId: 0,
      secretPacketId: 0,
      stakeUnits: 3,
    }));

    expect(round.finalCounts).toEqual([3, 2, 0, 3]);
    expect(round.winnerPacketId).toBe(1);
  });
});
