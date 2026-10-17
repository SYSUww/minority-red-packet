export type GamePhase = "lobby" | "signal" | "commit" | "reveal" | "settled";

export type PacketId = 0 | 1 | 2 | 3;

export type Packet = Readonly<{
  id: PacketId;
  label: string;
  amount: bigint;
}>;

export type Player = Readonly<{
  id: string;
  nickname: string;
}>;

export type PlayerSnapshot = Player &
  Readonly<{
    signalPacketId: PacketId | null;
    hasCommitted: boolean;
    revealedPacketId: PacketId | null;
  }>;

export type PlayerPayout = Readonly<{
  playerId: string;
  amount: bigint;
}>;

export type PacketCount = Readonly<{
  packetId: PacketId;
  count: number;
}>;

export type Settlement = Readonly<{
  winningPacketId: PacketId | null;
  packetCounts: readonly PacketCount[];
  winners: readonly PlayerPayout[];
  winnerShare: bigint;
  divisionRemainder: bigint;
  distributedAmount: bigint;
  hostRefund: bigint;
}>;

export type GameSnapshot = Readonly<{
  gameId: string;
  phase: GamePhase;
  packets: readonly Packet[];
  players: readonly PlayerSnapshot[];
  totalPot: bigint;
  settlement: Settlement | null;
}>;

export type GameEngineOptions = Readonly<{
  gameId: string;
  packets?: readonly Packet[];
}>;

export const DEFAULT_PACKETS: readonly Packet[] = Object.freeze([
  { id: 0, label: "green", amount: 10_000_000_000_000_000n },
  { id: 1, label: "blue", amount: 20_000_000_000_000_000n },
  { id: 2, label: "purple", amount: 30_000_000_000_000_000n },
  { id: 3, label: "gold", amount: 50_000_000_000_000_000n },
]);

export class GameRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameRuleError";
  }
}

type InternalPlayer = {
  id: string;
  nickname: string;
  signalPacketId: PacketId | null;
  commitment: string | null;
  revealedPacketId: PacketId | null;
};

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 8;
const UINT64_MASK = (1n << 64n) - 1n;
const FNV_PRIME = 0x100000001b3n;
const HASH_SEEDS = [
  0xcbf29ce484222325n,
  0x84222325cbf29ce4n,
  0x9e3779b97f4a7c15n,
  0xd6e8feb86659fd93n,
] as const;

/**
 * Deterministic commitment for the local mock engine. It intentionally has no
 * onchain/cryptographic compatibility; production uses keccak256 over ABI data.
 */
export function createMockCommitment(
  gameId: string,
  playerId: string,
  packetId: PacketId,
  salt: string,
): string {
  const payload = JSON.stringify([gameId, playerId, packetId, salt]);
  const bytes = new TextEncoder().encode(payload);

  const digest = HASH_SEEDS.map(seed => {
    let hash: bigint = seed;
    for (const byte of bytes) {
      hash ^= BigInt(byte);
      hash = (hash * FNV_PRIME) & UINT64_MASK;
    }
    return hash.toString(16).padStart(16, "0");
  }).join("");

  return `0x${digest}`;
}

export class MockGameEngine {
  readonly gameId: string;
  readonly packets: readonly Packet[];

  private phase: GamePhase = "lobby";
  private readonly players = new Map<string, InternalPlayer>();
  private settlement: Settlement | null = null;

  constructor(options: GameEngineOptions) {
    const gameId = options.gameId.trim();
    if (!gameId) {
      throw new GameRuleError("gameId is required");
    }

    const packets = options.packets ?? DEFAULT_PACKETS;
    validatePackets(packets);

    this.gameId = gameId;
    this.packets = Object.freeze(packets.map(packet => Object.freeze({ ...packet })));
  }

  getSnapshot(): GameSnapshot {
    return Object.freeze({
      gameId: this.gameId,
      phase: this.phase,
      packets: this.packets,
      players: Object.freeze(
        [...this.players.values()].map(player =>
          Object.freeze({
            id: player.id,
            nickname: player.nickname,
            signalPacketId: player.signalPacketId,
            hasCommitted: player.commitment !== null,
            revealedPacketId: player.revealedPacketId,
          }),
        ),
      ),
      totalPot: this.totalPot,
      settlement: this.settlement,
    });
  }

  join(player: Player): GameSnapshot {
    this.expectPhase("lobby");

    const id = player.id.trim();
    const nickname = player.nickname.trim();
    if (!id) {
      throw new GameRuleError("player id is required");
    }
    if (!nickname) {
      throw new GameRuleError("nickname is required");
    }
    if (this.players.has(id)) {
      throw new GameRuleError(`player ${id} has already joined`);
    }
    if (this.players.size >= MAX_PLAYERS) {
      throw new GameRuleError(`a game supports at most ${MAX_PLAYERS} players`);
    }

    this.players.set(id, {
      id,
      nickname,
      signalPacketId: null,
      commitment: null,
      revealedPacketId: null,
    });
    return this.getSnapshot();
  }

  startSignal(): GameSnapshot {
    this.expectPhase("lobby");
    if (this.players.size < MIN_PLAYERS) {
      throw new GameRuleError(`a game needs at least ${MIN_PLAYERS} players`);
    }

    this.phase = "signal";
    return this.getSnapshot();
  }

  signal(playerId: string, packetId: PacketId): GameSnapshot {
    this.expectPhase("signal");
    const player = this.getPlayer(playerId);
    this.getPacket(packetId);
    player.signalPacketId = packetId;
    return this.getSnapshot();
  }

  startCommit(): GameSnapshot {
    this.expectPhase("signal");
    this.phase = "commit";
    return this.getSnapshot();
  }

  commit(playerId: string, commitment: string): GameSnapshot {
    this.expectPhase("commit");
    const player = this.getPlayer(playerId);
    if (player.commitment !== null) {
      throw new GameRuleError(`player ${playerId} has already committed`);
    }
    if (!commitment.trim()) {
      throw new GameRuleError("commitment is required");
    }

    player.commitment = commitment;
    return this.getSnapshot();
  }

  startReveal(): GameSnapshot {
    this.expectPhase("commit");
    this.phase = "reveal";
    return this.getSnapshot();
  }

  reveal(playerId: string, packetId: PacketId, salt: string): GameSnapshot {
    this.expectPhase("reveal");
    const player = this.getPlayer(playerId);
    this.getPacket(packetId);

    if (player.commitment === null) {
      throw new GameRuleError(`player ${playerId} did not commit`);
    }
    if (player.revealedPacketId !== null) {
      throw new GameRuleError(`player ${playerId} has already revealed`);
    }

    const expected = createMockCommitment(this.gameId, player.id, packetId, salt);
    if (player.commitment !== expected) {
      throw new GameRuleError("reveal does not match commitment");
    }

    player.revealedPacketId = packetId;
    return this.getSnapshot();
  }

  settle(): Settlement {
    if (this.phase === "settled" && this.settlement) {
      return this.settlement;
    }
    this.expectPhase("reveal");

    const counts = new Map<PacketId, number>(this.packets.map(packet => [packet.id, 0]));
    for (const player of this.players.values()) {
      if (player.revealedPacketId !== null) {
        counts.set(player.revealedPacketId, (counts.get(player.revealedPacketId) ?? 0) + 1);
      }
    }

    const packetCounts = Object.freeze(
      this.packets.map(packet =>
        Object.freeze({ packetId: packet.id, count: counts.get(packet.id) ?? 0 }),
      ),
    );
    const nonEmptyPackets = this.packets.filter(packet => (counts.get(packet.id) ?? 0) > 0);

    if (nonEmptyPackets.length <= 1) {
      this.settlement = freezeSettlement({
        winningPacketId: null,
        packetCounts,
        winners: [],
        winnerShare: 0n,
        divisionRemainder: 0n,
        distributedAmount: 0n,
        hostRefund: this.totalPot,
      });
      this.phase = "settled";
      return this.settlement;
    }

    const minimumCount = Math.min(...nonEmptyPackets.map(packet => counts.get(packet.id) ?? 0));
    const winningPacket = nonEmptyPackets
      .filter(packet => counts.get(packet.id) === minimumCount)
      .reduce((winner, packet) => (packet.amount > winner.amount ? packet : winner));
    const winnerIds = [...this.players.values()]
      .filter(player => player.revealedPacketId === winningPacket.id)
      .map(player => player.id);
    const winnerCount = BigInt(winnerIds.length);
    const winnerShare = winningPacket.amount / winnerCount;
    const distributedAmount = winnerShare * winnerCount;
    const divisionRemainder = winningPacket.amount - distributedAmount;
    const winners = winnerIds.map(playerId => Object.freeze({ playerId, amount: winnerShare }));

    this.settlement = freezeSettlement({
      winningPacketId: winningPacket.id,
      packetCounts,
      winners,
      winnerShare,
      divisionRemainder,
      distributedAmount,
      hostRefund: this.totalPot - distributedAmount,
    });
    this.phase = "settled";
    return this.settlement;
  }

  private get totalPot(): bigint {
    return this.packets.reduce((total, packet) => total + packet.amount, 0n);
  }

  private expectPhase(expected: GamePhase): void {
    if (this.phase !== expected) {
      throw new GameRuleError(`expected ${expected} phase, current phase is ${this.phase}`);
    }
  }

  private getPlayer(playerId: string): InternalPlayer {
    const player = this.players.get(playerId);
    if (!player) {
      throw new GameRuleError(`unknown player ${playerId}`);
    }
    return player;
  }

  private getPacket(packetId: PacketId): Packet {
    const packet = this.packets.find(candidate => candidate.id === packetId);
    if (!packet) {
      throw new GameRuleError(`unknown packet ${packetId}`);
    }
    return packet;
  }
}

function validatePackets(packets: readonly Packet[]): void {
  if (packets.length !== 4) {
    throw new GameRuleError("a game must have exactly four packets");
  }

  const ids = new Set<PacketId>();
  const amounts = new Set<bigint>();
  for (const packet of packets) {
    if (![0, 1, 2, 3].includes(packet.id)) {
      throw new GameRuleError(`invalid packet id ${packet.id}`);
    }
    if (ids.has(packet.id)) {
      throw new GameRuleError(`duplicate packet id ${packet.id}`);
    }
    if (!packet.label.trim()) {
      throw new GameRuleError("packet label is required");
    }
    if (packet.amount <= 0n) {
      throw new GameRuleError("packet amount must be positive");
    }
    if (amounts.has(packet.amount)) {
      throw new GameRuleError("packet amounts must be unique");
    }
    ids.add(packet.id);
    amounts.add(packet.amount);
  }
}

function freezeSettlement(settlement: Settlement): Settlement {
  return Object.freeze({
    ...settlement,
    packetCounts: Object.freeze([...settlement.packetCounts]),
    winners: Object.freeze([...settlement.winners]),
  });
}
