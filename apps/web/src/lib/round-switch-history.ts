import type { HistorySource, PlayerHistoryRecord } from "./player-history";

export type RoundSwitchSummary = Readonly<{
  round: number;
  switchedCount: number;
  totalPlayers: number;
}>;

export function summarizeRoundSwitches(records: readonly PlayerHistoryRecord[]): RoundSwitchSummary[] {
  const rounds = new Map<string, { round: number; switchedCount: number; totalPlayers: number }>();
  for (const record of records) {
    const current = rounds.get(record.roundId) ?? { round: record.round, switchedCount: 0, totalPlayers: 0 };
    current.totalPlayers += 1;
    if (record.actualResult.behavior === "switched") current.switchedCount += 1;
    rounds.set(record.roundId, current);
  }
  return [...rounds.values()].sort((left, right) => left.round - right.round);
}

export async function loadRoundSwitches(roomId: string, source: HistorySource) {
  const params = new URLSearchParams({ roomId, source, limit: "500" });
  const response = await fetch(`/api/history?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`history API returned ${response.status}`);
  const body = await response.json() as { records?: PlayerHistoryRecord[] };
  return summarizeRoundSwitches(Array.isArray(body.records) ? body.records : []);
}

export function upsertRoundSwitch(
  summaries: readonly RoundSwitchSummary[],
  next: RoundSwitchSummary,
) {
  const existing = summaries.find((item) => item.round === next.round);
  if (existing && existing.switchedCount === next.switchedCount && existing.totalPlayers === next.totalPlayers) {
    return summaries;
  }
  return [...summaries.filter((item) => item.round !== next.round), next]
    .sort((left, right) => left.round - right.round);
}
