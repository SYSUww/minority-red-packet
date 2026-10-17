import { NextRequest, NextResponse } from "next/server";

import { AgentRequestError, readAgentObservation } from "@/lib/agent-chain-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const observation = await readAgentObservation(
      request.nextUrl.searchParams.get("roomId"),
      request.nextUrl.searchParams.get("playerId"),
    );
    return NextResponse.json({ status: "ok", observation });
  } catch (error) {
    return agentError(error);
  }
}

function agentError(error: unknown) {
  if (error instanceof AgentRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("agent state API failed", error);
  return NextResponse.json({ error: "agent state is temporarily unavailable" }, { status: 500 });
}
