import { NextRequest, NextResponse } from "next/server";

import { AgentRequestError, chainHistoryRoomId, readAgentObservation } from "@/lib/agent-chain-state";
import { agentResponseSchema, buildExecutionPlan, parseAgentDecision } from "@/lib/agent-protocol";
import { readPlayerHistory, summarizePlayerHistory } from "@/lib/player-history-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class AgentAdapterError extends Error {}

export async function POST(request: NextRequest) {
  try {
    if (!authorized(request)) return NextResponse.json({ error: "invalid or missing Agent API token" }, { status: 401 });
    const body = await request.json() as Record<string, unknown>;
    const observation = await readAgentObservation(body.roomId, body.playerId);
    const roomId = chainHistoryRoomId(observation.chain.contractAddress, observation.roomId);
    const history = await readPlayerHistory({ playerId: observation.self.address.toLowerCase(), roomId, source: "onchain", limit: parseLimit(body.historyLimit) });
    const context = {
      instruction: "你是少数派红包的参赛 Agent。只可从 legalActions 选择动作并严格输出 JSON。不要索取、回传或猜测私钥与 Salt。Commit 时只选择 packetId，密码学材料由本地执行器生成。",
      observation,
      packetLegend: ["0=青禾", "1=海蓝", "2=藤紫", "3=鎏金"],
      historySummary: summarizePlayerHistory(history.records),
      history: history.records,
      responseSchema: agentResponseSchema(observation.legalActions),
    };
    const adapterUrl = process.env.AGENT_ADAPTER_URL?.trim();
    if (!adapterUrl) {
      return NextResponse.json({
        status: "adapter_required",
        decision: null,
        execution: null,
        message: "配置 AGENT_ADAPTER_URL 后，本接口会在每个阶段把 context 转发给大模型 Adapter。",
        context,
      });
    }

    const rawDecision = await callAdapter(adapterUrl, context);
    const decision = parseAgentDecision(rawDecision, observation.legalActions);
    return NextResponse.json({
      status: "decision_ready",
      decision,
      execution: buildExecutionPlan(decision, observation),
      observation,
    });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "request body must be valid JSON" }, { status: 400 });
    if (error instanceof AgentRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof AgentAdapterError) return NextResponse.json({ error: error.message }, { status: 502 });
    if (error instanceof Error && /must|required|legal|supported/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 422 });
    console.error("agent turn API failed", error);
    return NextResponse.json({ error: "agent turn is temporarily unavailable" }, { status: 500 });
  }
}

async function callAdapter(url: string, context: Record<string, unknown>) {
  const timeout = parseTimeout(process.env.AGENT_ADAPTER_TIMEOUT_MS);
  const token = process.env.AGENT_ADAPTER_TOKEN?.trim();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ event: "minority-red-packet.turn", context }),
      signal: AbortSignal.timeout(timeout),
      cache: "no-store",
    });
    if (!response.ok) throw new AgentAdapterError(`adapter returned HTTP ${response.status}`);
    try {
      return await response.json() as unknown;
    } catch {
      throw new AgentAdapterError("adapter must return valid JSON");
    }
  } catch (error) {
    if (error instanceof AgentAdapterError) throw error;
    throw new AgentAdapterError(error instanceof Error ? `adapter request failed: ${error.message}` : "adapter request failed");
  }
}

function parseLimit(value: unknown) {
  if (value === undefined) return 30;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 100) throw new AgentRequestError("historyLimit must be an integer from 1 to 100");
  return Number(value);
}

function parseTimeout(value: string | undefined) {
  const parsed = value ? Number(value) : 12_000;
  return Number.isSafeInteger(parsed) && parsed >= 1_000 && parsed <= 60_000 ? parsed : 12_000;
}

function authorized(request: NextRequest) {
  const token = process.env.AGENT_API_TOKEN?.trim();
  return !token || request.headers.get("authorization") === `Bearer ${token}`;
}
