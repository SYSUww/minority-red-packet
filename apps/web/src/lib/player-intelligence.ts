import type { PacketId } from "./game-config";
import type { PlayerHistoryRecord, PlayerOutcome } from "./player-history";

export type PlayerIntelRound = Readonly<{
  round: number;
  publicPacketId: PacketId | null;
  secretPacketId: PacketId | null;
  stakeWei: bigint;
  payoutWei: bigint;
  outcome: PlayerOutcome;
}>;

export type PlayerIntelSeed = Readonly<{
  id: string;
  displayName: string;
  isSelf: boolean;
  fallbackPreferencePacketId: PacketId;
}>;

export type PlayerIntelProfile = PlayerIntelSeed & Readonly<{
  preferencePacketId: PacketId;
  rounds: readonly PlayerIntelRound[];
}>;

export function buildPlayerIntelProfiles(
  records: readonly PlayerHistoryRecord[],
  seeds: readonly PlayerIntelSeed[],
  currentRounds: Readonly<Record<string, PlayerIntelRound>> = {},
): PlayerIntelProfile[] {
  const recordsByPlayer = new Map<string, PlayerIntelRound[]>();
  const namesByPlayer = new Map<string, string>();

  for (const record of records) {
    namesByPlayer.set(record.player.id, record.player.displayName);
    const rounds = recordsByPlayer.get(record.player.id) ?? [];
    rounds.push(historyRecordToIntelRound(record));
    recordsByPlayer.set(record.player.id, rounds);
  }

  const allSeeds = seeds.length > 0
    ? seeds
    : [...recordsByPlayer.keys()]
      .map((id, index) => ({
        id,
        displayName: namesByPlayer.get(id) ?? id,
        isSelf: false,
        fallbackPreferencePacketId: (index % 4) as PacketId,
      }));

  return allSeeds.map((seed) => {
    const byRound = new Map<number, PlayerIntelRound>();
    for (const round of recordsByPlayer.get(seed.id) ?? []) byRound.set(round.round, round);
    if (currentRounds[seed.id]) byRound.set(currentRounds[seed.id].round, currentRounds[seed.id]);
    const rounds = [...byRound.values()].sort((left, right) => right.round - left.round);
    return {
      ...seed,
      preferencePacketId: inferPreference(rounds, seed.fallbackPreferencePacketId),
      rounds,
    };
  });
}

export function inferPreference(rounds: readonly PlayerIntelRound[], fallback: PacketId): PacketId {
  const scores = [0, 0, 0, 0];
  let preferred = fallback;
  for (const round of [...rounds].reverse()) {
    const packetId = round.secretPacketId ?? round.publicPacketId;
    if (packetId === null) continue;
    scores[packetId] += 1;
    if (scores[packetId] >= scores[preferred]) preferred = packetId;
  }
  return preferred;
}

export async function loadRoomPlayerHistory(roomId: string, source: "mock" | "onchain") {
  const params = new URLSearchParams({ roomId, source, limit: "500" });
  const response = await fetch(`/api/history?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`history API returned ${response.status}`);
  const body = await response.json() as { records?: PlayerHistoryRecord[] };
  return Array.isArray(body.records) ? body.records : [];
}

function historyRecordToIntelRound(record: PlayerHistoryRecord): PlayerIntelRound {
  return {
    round: record.round,
    publicPacketId: record.submission.publicSide?.packetId ?? null,
    secretPacketId: record.submission.secretSide?.packetId ?? null,
    stakeWei: BigInt(record.submission.amount.wei),
    payoutWei: BigInt(record.actualResult.payout.wei),
    outcome: record.actualResult.outcome,
  };
}
