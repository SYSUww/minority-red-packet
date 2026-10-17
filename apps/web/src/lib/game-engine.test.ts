import { describe, expect, it } from "vitest";

import {
  GameRuleError,
  MockGameEngine,
  type Packet,
  type PacketId,
  createMockCommitment,
} from "./game-engine";

const TEST_PACKETS: readonly Packet[] = [
  { id: 0, label: "green", amount: 10n },
  { id: 1, label: "blue", amount: 20n },
  { id: 2, label: "purple", amount: 30n },
  { id: 3, label: "gold", amount: 50n },
];

describe("MockGameEngine", () => {
  it("keeps the game in the lobby until 4 players join and never accepts more than 8", () => {
    const game = createGame();
    joinPlayers(game, 3);

    expect(() => game.startSignal()).toThrow(GameRuleError);

    joinPlayers(game, 5, 3);
    expect(game.startSignal().phase).toBe("signal");

    const fullLobby = createGame();
    joinPlayers(fullLobby, 8);
    expect(() => fullLobby.join({ id: "p9", nickname: "Player 9" })).toThrow(
      "at most 8 players",
    );
  });

  it("publishes signal choices and lets players change sides before commit begins", () => {
    const game = createStartedGame(4);

    game.signal("p1", 3);
    game.signal("p1", 2);

    expect(player(game, "p1").signalPacketId).toBe(2);
    game.startCommit();
    expect(() => game.signal("p1", 1)).toThrow("expected signal phase");
  });

  it("locks a secret commitment without exposing the final packet", () => {
    const game = createCommitGame(4);
    const commitment = createMockCommitment("game-1", "p1", 3, "secret-salt");

    const snapshot = game.commit("p1", commitment);

    expect(playerFromSnapshot(snapshot, "p1")).toMatchObject({
      hasCommitted: true,
      revealedPacketId: null,
    });
    expect(() => game.commit("p1", createMockCommitment("game-1", "p1", 1, "other"))).toThrow(
      "already committed",
    );
  });

  it("reveals only when the packet and salt match the player's commitment", () => {
    const game = createCommitGame(4);
    game.commit("p1", createMockCommitment("game-1", "p1", 2, "correct-salt"));
    game.startReveal();

    expect(() => game.reveal("p1", 1, "correct-salt")).toThrow("does not match commitment");
    expect(() => game.reveal("p1", 2, "wrong-salt")).toThrow("does not match commitment");
    expect(() => game.reveal("p2", 2, "anything")).toThrow("did not commit");

    expect(playerFromSnapshot(game.reveal("p1", 2, "correct-salt"), "p1").revealedPacketId).toBe(2);
    expect(() => game.reveal("p1", 2, "correct-salt")).toThrow("already revealed");
  });

  it("ignores empty packets and awards the least populated non-empty packet", () => {
    const game = revealGame([0, 0, 0, 1, 1, 2]);

    const result = game.settle();

    expect(result.packetCounts).toEqual([
      { packetId: 0, count: 3 },
      { packetId: 1, count: 2 },
      { packetId: 2, count: 1 },
      { packetId: 3, count: 0 },
    ]);
    expect(result.winningPacketId).toBe(2);
    expect(result.winners).toEqual([{ playerId: "p6", amount: 30n }]);
    expect(result.hostRefund).toBe(80n);
  });

  it("has no winner when every revealed player chose the same packet", () => {
    const game = revealGame([3, 3, 3, 3]);

    const result = game.settle();

    expect(result.winningPacketId).toBeNull();
    expect(result.winners).toEqual([]);
    expect(result.distributedAmount).toBe(0n);
    expect(result.hostRefund).toBe(110n);
  });

  it("uses the higher-value packet when minority counts are tied", () => {
    const game = revealGame([0, 0, 0, 1, 1, 2, 2]);

    const result = game.settle();

    expect(result.winningPacketId).toBe(2);
    expect(result.winnerShare).toBe(15n);
    expect(result.winners.map(winner => winner.playerId)).toEqual(["p6", "p7"]);
  });

  it("uses the highest-value packet when all four non-empty packets have equal populations", () => {
    const game = revealGame([0, 0, 1, 1, 2, 2, 3, 3]);

    const result = game.settle();

    expect(result.winningPacketId).toBe(3);
    expect(result.winnerShare).toBe(25n);
  });

  it("splits only the winning packet and refunds losing packets plus division remainder", () => {
    const game = revealGame([0, 0, 0, 1, 1, 1, 1]);

    const result = game.settle();

    expect(result.winningPacketId).toBe(0);
    expect(result.winnerShare).toBe(3n);
    expect(result.winners).toEqual([
      { playerId: "p1", amount: 3n },
      { playerId: "p2", amount: 3n },
      { playerId: "p3", amount: 3n },
    ]);
    expect(result.divisionRemainder).toBe(1n);
    expect(result.distributedAmount).toBe(9n);
    expect(result.hostRefund).toBe(101n);
  });

  it("treats players who never reveal as abstaining and does not let them block settlement", () => {
    const game = createCommitGame(4);
    commitChoice(game, 1, 0);
    commitChoice(game, 2, 0);
    commitChoice(game, 3, 1);
    commitChoice(game, 4, 3);
    game.startReveal();
    revealChoice(game, 1, 0);
    revealChoice(game, 2, 0);
    revealChoice(game, 3, 1);

    const result = game.settle();

    expect(result.winningPacketId).toBe(1);
    expect(result.packetCounts).toContainEqual({ packetId: 3, count: 0 });
    expect(result.winners.map(winner => winner.playerId)).toEqual(["p3"]);
  });
});

function createGame(): MockGameEngine {
  return new MockGameEngine({ gameId: "game-1", packets: TEST_PACKETS });
}

function createStartedGame(playerCount: number): MockGameEngine {
  const game = createGame();
  joinPlayers(game, playerCount);
  game.startSignal();
  return game;
}

function createCommitGame(playerCount: number): MockGameEngine {
  const game = createStartedGame(playerCount);
  game.startCommit();
  return game;
}

function revealGame(choices: readonly PacketId[]): MockGameEngine {
  const game = createCommitGame(choices.length);
  choices.forEach((packetId, index) => commitChoice(game, index + 1, packetId));
  game.startReveal();
  choices.forEach((packetId, index) => revealChoice(game, index + 1, packetId));
  return game;
}

function joinPlayers(game: MockGameEngine, count: number, offset = 0): void {
  for (let index = 1; index <= count; index += 1) {
    const playerNumber = index + offset;
    game.join({ id: `p${playerNumber}`, nickname: `Player ${playerNumber}` });
  }
}

function commitChoice(game: MockGameEngine, playerNumber: number, packetId: PacketId): void {
  game.commit(
    `p${playerNumber}`,
    createMockCommitment("game-1", `p${playerNumber}`, packetId, `salt-${playerNumber}`),
  );
}

function revealChoice(game: MockGameEngine, playerNumber: number, packetId: PacketId): void {
  game.reveal(`p${playerNumber}`, packetId, `salt-${playerNumber}`);
}

function player(game: MockGameEngine, playerId: string) {
  return playerFromSnapshot(game.getSnapshot(), playerId);
}

function playerFromSnapshot(snapshot: ReturnType<MockGameEngine["getSnapshot"]>, playerId: string) {
  const found = snapshot.players.find(candidate => candidate.id === playerId);
  if (!found) {
    throw new Error(`missing player ${playerId}`);
  }
  return found;
}
