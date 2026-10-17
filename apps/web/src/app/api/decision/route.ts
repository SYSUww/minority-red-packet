import { NextRequest, NextResponse } from "next/server";

import { readPlayerHistory, summarizePlayerHistory } from "@/lib/player-history-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const interfaceDescription = {
  interfaceVersion: "1.0",
  implemented: false,
  purpose: "Provide a player's historical rounds as context for an external LLM decision adapter.",
  request: {
    playerId: "string (required)",
    roomId: "string (optional)",
    limit: "integer 1-100 (optional, default 30)",
    currentRound: "arbitrary JSON object (optional, echoed into the decision context)",
  },
  expectedAdapterOutput: {
    packetId: "0 | 1 | 2 | 3",
    stakeUnits: "integer 1-10",
    confidence: "number 0-1",
    rationale: "string",
  },
} as const;

export function GET() {
  return NextResponse.json(interfaceDescription);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const playerId = parseText(body.playerId, "playerId", true);
    const roomId = parseText(body.roomId, "roomId", false);
    const limit = body.limit === undefined ? 30 : Number(body.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      return NextResponse.json({ error: "limit must be an integer from 1 to 100" }, { status: 400 });
    }

    const history = await readPlayerHistory({ playerId, roomId, limit });
    return NextResponse.json({
      status: "adapter_required",
      decision: null,
      message: "LLM provider is intentionally not connected. Send this context to your own adapter and return the documented output shape.",
      context: {
        playerId,
        roomId: roomId ?? null,
        summary: summarizePlayerHistory(history.records),
        history: history.records,
        currentRound: body.currentRound ?? null,
      },
      interface: interfaceDescription,
    });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof Error && /must|required/.test(error.message)) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "invalid request" }, { status: 400 });
    }
    console.error("decision context API failed", error);
    return NextResponse.json({ error: "decision context is temporarily unavailable" }, { status: 500 });
  }
}

function parseText(value: unknown, field: string, required: true): string;
function parseText(value: unknown, field: string, required: false): string | undefined;
function parseText(value: unknown, field: string, required: boolean) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }
  if (typeof value !== "string" || !value.trim() || value.length > 160) {
    throw new Error(`${field} must be a non-empty string up to 160 characters`);
  }
  return value.trim();
}
