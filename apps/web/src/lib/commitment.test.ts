import { describe, expect, it } from "vitest";

import { createCommitment } from "./commitment";

const INPUT = {
  chainId: 10_143n,
  contractAddress: "0x1111111111111111111111111111111111111111",
  gameId: 7n,
  player: "0x2222222222222222222222222222222222222222",
  packetId: 2,
  salt: `0x${"3".repeat(64)}`,
} as const;

describe("createCommitment", () => {
  it("separates the same choice and salt across room rounds", () => {
    const firstRound = createCommitment({ ...INPUT, roundNumber: 1n });
    const secondRound = createCommitment({ ...INPUT, roundNumber: 2n });

    expect(firstRound).not.toBe(secondRound);
  });
});
