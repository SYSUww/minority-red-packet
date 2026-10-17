import { NextRequest, NextResponse } from "next/server";

import { HISTORY_SOURCES, parseHistoryRecordInput } from "@/lib/player-history";
import { appendPlayerHistory, readPlayerHistory } from "@/lib/player-history-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams;
    const source = search.get("source") ?? undefined;
    if (source && !HISTORY_SOURCES.includes(source as (typeof HISTORY_SOURCES)[number])) {
      return NextResponse.json({ error: "source must be mock or onchain" }, { status: 400 });
    }
    const limitValue = search.get("limit");
    const limit = limitValue === null ? undefined : Number(limitValue);
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
      return NextResponse.json({ error: "limit must be a positive integer" }, { status: 400 });
    }
    const history = await readPlayerHistory({
      playerId: search.get("playerId")?.trim() || undefined,
      roomId: search.get("roomId")?.trim() || undefined,
      source: source as (typeof HISTORY_SOURCES)[number] | undefined,
      limit,
    });
    return NextResponse.json({ ...history, count: history.records.length });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { records?: unknown };
    const rawRecords = Array.isArray(body.records) ? body.records : [];
    if (rawRecords.length === 0 || rawRecords.length > 8) {
      return NextResponse.json({ error: "records must contain 1 to 8 player records" }, { status: 400 });
    }
    const records = rawRecords.map(parseHistoryRecordInput);
    const roundIds = new Set(records.map((record) => record.roundId));
    if (roundIds.size !== 1) {
      return NextResponse.json({ error: "all records in a batch must belong to the same roundId" }, { status: 400 });
    }
    const history = await appendPlayerHistory(records);
    return NextResponse.json({
      saved: records.length,
      roundId: records[0].roundId,
      totalRecords: history.records.length,
      updatedAt: history.updatedAt,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof Error && /must|required|cannot|without/.test(error.message)) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "invalid request" }, { status: 400 });
    }
    return serverError(error);
  }
}

function serverError(error: unknown) {
  console.error("player history API failed", error);
  return NextResponse.json({ error: "player history is temporarily unavailable" }, { status: 500 });
}
