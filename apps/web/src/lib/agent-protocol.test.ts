import { describe, expect, it } from "vitest";

import { buildAgentObservation, buildExecutionPlan, parseAgentDecision } from "./agent-protocol";
import type { ChainGameSnapshot, ChainPhase, ChainPlayer } from "./onchain-game-gateway";

const CONTRACT = "0x1111111111111111111111111111111111111111" as const;
const PLAYER = "0x2222222222222222222222222222222222222222" as const;
const OTHER = "0x3333333333333333333333333333333333333333" as const;
const ZERO_HASH = `0x${"0".repeat(64)}` as const;
const COMMITMENT = `0x${"a".repeat(64)}` as const;

describe("agent protocol", () => {
  it("hides secret choices until reveal and exposes the correct phase action", () => {
    const observation = buildAgentObservation({ snapshot: snapshot("commit"), playerAddress: PLAYER, contractAddress: CONTRACT, roomId: 7n, claimableWei: 0n });

    expect(observation.game.revealedCounts).toBeNull();
    expect(observation.warnings).toEqual([]);
    expect(observation.players[1].revealedPacketId).toBeNull();
    expect(observation.legalActions).toEqual(["commit", "wait"]);
    expect(JSON.stringify(observation)).not.toContain(COMMITMENT);
  });

  it("reveals public truth in reveal phase without exposing a salt or commitment", () => {
    const observation = buildAgentObservation({ snapshot: snapshot("reveal", true), playerAddress: PLAYER, contractAddress: CONTRACT, roomId: 7n, claimableWei: 0n });

    expect(observation.game.revealedCounts).toEqual([1, 0, 1, 0]);
    expect(observation.players.map((player) => player.revealedPacketId)).toEqual([2, 0]);
    expect(observation.legalActions).toEqual(["wait"]);
    expect(JSON.stringify(observation)).not.toContain(COMMITMENT);
  });

  it("validates model actions against the current phase", () => {
    expect(parseAgentDecision({ action: "signal", packetId: 3, confidence: 0.8 }, ["signal", "wait"])).toMatchObject({ action: "signal", packetId: 3 });
    expect(() => parseAgentDecision({ action: "claim" }, ["signal", "wait"])).toThrow("not legal");
    expect(() => parseAgentDecision({ action: "commit", packetId: 9 }, ["commit", "wait"])).toThrow("packetId");
  });

  it("returns a wallet execution plan while keeping commit secrets local", () => {
    const observation = buildAgentObservation({ snapshot: snapshot("commit"), playerAddress: PLAYER, contractAddress: CONTRACT, roomId: 7n, claimableWei: 0n });
    const plan = buildExecutionPlan({ action: "commit", packetId: 2 }, observation);

    expect(plan).toMatchObject({ functionName: "commitChoice", privateStateRequired: true, packetId: 2 });
    expect(JSON.stringify(plan)).not.toContain("salt-");
  });
});

function snapshot(phase: ChainPhase, revealed = false): ChainGameSnapshot {
  const players: ChainPlayer[] = [
    { address: PLAYER, stakeAmount: 3n, commitment: phase === "reveal" ? COMMITMENT : ZERO_HASH, signalPacket: 0, revealedPacket: 2, joined: true, hasSignaled: true, revealed, payout: 0n },
    { address: OTHER, stakeAmount: 2n, commitment: COMMITMENT, signalPacket: 1, revealedPacket: 0, joined: true, hasSignaled: true, revealed: true, payout: 0n },
  ];
  return {
    game: { roundNumber: 2n, joinEndBlock: 100n, startBlock: 90n, signalEndBlock: 110n, commitEndBlock: 120n, revealEndBlock: 130n, playerCount: 2, winnerPacket: 4, winnerCount: 0, exists: true, settled: false, cancelled: false, pot: 5n, winningStake: 0n, losingPot: 0n, remainder: 0n },
    phase,
    phaseIndex: 2,
    players,
    revealedCounts: [1, 0, 1, 0],
    blockNumber: 115n,
  };
}
