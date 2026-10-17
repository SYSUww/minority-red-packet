import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  HISTORY_VERSION,
  createHistoryRecord,
  emptyHistoryFile,
  type HistoryRecordInput,
  type HistorySource,
  type PlayerHistoryFile,
  type PlayerHistoryRecord,
} from "./player-history";

export type HistoryQuery = Readonly<{
  playerId?: string;
  roomId?: string;
  source?: HistorySource;
  limit?: number;
}>;

const DEFAULT_HISTORY_PATH = join(process.cwd(), "data", "player-history.json");
let writeQueue: Promise<void> = Promise.resolve();

export async function readPlayerHistory(query: HistoryQuery = {}): Promise<PlayerHistoryFile> {
  const file = await readHistoryFile();
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  const records = file.records
    .filter((record) => !query.playerId || record.player.id === query.playerId)
    .filter((record) => !query.roomId || record.roomId === query.roomId)
    .filter((record) => !query.source || record.source === query.source)
    .slice(-limit)
    .reverse();
  return { ...file, records };
}

export function appendPlayerHistory(inputs: readonly HistoryRecordInput[]): Promise<PlayerHistoryFile> {
  if (inputs.length === 0) return readHistoryFile();
  const operation = writeQueue.catch(() => undefined).then(async () => {
    const current = await readHistoryFile();
    const recordedAt = new Date().toISOString();
    const byId = new Map(current.records.map((record) => [record.id, record]));
    for (const input of inputs) {
      const record = createHistoryRecord(input, recordedAt);
      byId.set(record.id, record);
    }
    const next: PlayerHistoryFile = {
      version: HISTORY_VERSION,
      updatedAt: recordedAt,
      records: [...byId.values()],
    };
    await writeHistoryFile(next);
    return next;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function summarizePlayerHistory(records: readonly PlayerHistoryRecord[]) {
  const wins = records.filter((record) => record.actualResult.outcome === "won").length;
  const switches = records.filter((record) => record.actualResult.behavior === "switched").length;
  const totalStakeWei = records.reduce((total, record) => total + BigInt(record.submission.amount.wei), 0n);
  const totalPayoutWei = records.reduce((total, record) => total + BigInt(record.actualResult.payout.wei), 0n);
  return {
    rounds: records.length,
    wins,
    losses: records.filter((record) => record.actualResult.outcome === "lost").length,
    refunds: records.filter((record) => record.actualResult.outcome === "refunded").length,
    switches,
    winRate: records.length === 0 ? 0 : wins / records.length,
    switchRate: records.length === 0 ? 0 : switches / records.length,
    totalStakeWei: totalStakeWei.toString(),
    totalPayoutWei: totalPayoutWei.toString(),
    netWei: (totalPayoutWei - totalStakeWei).toString(),
  };
}

async function readHistoryFile(): Promise<PlayerHistoryFile> {
  const path = historyPath();
  try {
    const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ path, "utf8")) as PlayerHistoryFile;
    if (parsed.version !== HISTORY_VERSION || !Array.isArray(parsed.records)) {
      throw new Error(`unsupported player history format in ${path}`);
    }
    return parsed;
  } catch (error) {
    if (isMissingFile(error)) return emptyHistoryFile();
    throw error;
  }
}

async function writeHistoryFile(file: PlayerHistoryFile) {
  const path = historyPath();
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function historyPath() {
  return process.env.PLAYER_HISTORY_PATH?.trim() || DEFAULT_HISTORY_PATH;
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
