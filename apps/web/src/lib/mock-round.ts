import type { PacketId } from "./game-config";

const MON = 10n ** 18n;

export type MockRoundPlayer = Readonly<{
  id: string;
  name: string;
  signalPacketId: PacketId;
  secretPacketId: PacketId;
  stakeWei: bigint;
}>;

export type MockRoundPlayerResult = MockRoundPlayer & Readonly<{
  payoutWei: bigint;
  won: boolean;
}>;

const MOCK_PLAYERS: readonly MockRoundPlayer[] = [
  { id: "mock-1", name: "北北", signalPacketId: 0, secretPacketId: 0, stakeWei: 1n * MON },
  { id: "mock-2", name: "林一", signalPacketId: 1, secretPacketId: 0, stakeWei: 1n * MON },
  { id: "mock-3", name: "小满", signalPacketId: 1, secretPacketId: 1, stakeWei: 1n * MON },
  { id: "mock-4", name: "阿澈", signalPacketId: 2, secretPacketId: 1, stakeWei: 1n * MON },
  { id: "mock-5", name: "十七", signalPacketId: 3, secretPacketId: 3, stakeWei: 1n * MON },
  { id: "mock-6", name: "Lynn", signalPacketId: 3, secretPacketId: 3, stakeWei: 2n * MON },
  { id: "mock-7", name: "K", signalPacketId: 3, secretPacketId: 3, stakeWei: 2n * MON },
];

export function createMockRoundPlayers(input: {
  name: string;
  signalPacketId: PacketId;
  secretPacketId: PacketId;
  stakeUnits: number;
}) {
  return [
    {
      id: "you",
      name: input.name || "你",
      signalPacketId: input.signalPacketId,
      secretPacketId: input.secretPacketId,
      stakeWei: BigInt(input.stakeUnits) * MON,
    },
    ...MOCK_PLAYERS,
  ] satisfies readonly MockRoundPlayer[];
}

export function countPackets(players: readonly MockRoundPlayer[], field: "signalPacketId" | "secretPacketId") {
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  for (const player of players) counts[player[field]] += 1;
  return counts;
}

export function settleMockRound(players: readonly MockRoundPlayer[]) {
  const publicCounts = countPackets(players, "signalPacketId");
  const finalCounts = countPackets(players, "secretPacketId");
  let winnerPacketId: PacketId | null = null;
  let winnerCount = Number.POSITIVE_INFINITY;

  finalCounts.forEach((count, packetId) => {
    if (count > 0 && count <= winnerCount) {
      winnerPacketId = packetId as PacketId;
      winnerCount = count;
    }
  });

  const potWei = players.reduce((total, player) => total + player.stakeWei, 0n);
  const winningStakeWei = players.reduce(
    (total, player) => total + (player.secretPacketId === winnerPacketId ? player.stakeWei : 0n),
    0n,
  );
  const losingPotWei = potWei - winningStakeWei;
  const payouts = new Map<string, bigint>();
  let distributedWei = 0n;

  if (winnerPacketId !== null) {
    for (const player of players) {
      if (player.secretPacketId !== winnerPacketId) continue;
      const payoutWei = player.stakeWei + (losingPotWei * player.stakeWei) / winningStakeWei;
      payouts.set(player.id, payoutWei);
      distributedWei += payoutWei;
    }
    let remainderWei = potWei - distributedWei;
    for (const player of players) {
      if (remainderWei === 0n) break;
      if (player.secretPacketId !== winnerPacketId) continue;
      payouts.set(player.id, (payouts.get(player.id) ?? 0n) + 1n);
      remainderWei -= 1n;
    }
  }

  const results: readonly MockRoundPlayerResult[] = players.map((player) => ({
    ...player,
    payoutWei: payouts.get(player.id) ?? 0n,
    won: player.secretPacketId === winnerPacketId,
  }));

  return {
    publicCounts,
    finalCounts,
    switchedCount: players.filter((player) => player.signalPacketId !== player.secretPacketId).length,
    winnerPacketId,
    winnerCount: Number.isFinite(winnerCount) ? winnerCount : 0,
    potWei,
    losingPotWei,
    results,
  } as const;
}
