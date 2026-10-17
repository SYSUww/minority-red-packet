"use client";

import { ArrowRight, Check, Radio } from "lucide-react";

import { PACKETS, type PacketId } from "@/lib/game-config";
import type { RoundSwitchSummary } from "@/lib/round-switch-history";

export type PlayerFlowStep = "join" | "signal" | "commit" | "reveal" | "result";

const FLOW_STEPS: readonly { id: PlayerFlowStep; label: string; short: string }[] = [
  { id: "join", label: "进入房间", short: "入场" },
  { id: "signal", label: "站队并投入", short: "站队+投入" },
  { id: "commit", label: "秘密选择", short: "秘密" },
  { id: "reveal", label: "统一揭晓", short: "揭晓" },
  { id: "result", label: "查看结果", short: "结果" },
];

export function PlayerFlowRail({ current, dark = false }: { current: PlayerFlowStep; dark?: boolean }) {
  const activeIndex = FLOW_STEPS.findIndex((step) => step.id === current);

  return (
    <nav className={`player-flow-rail${dark ? " is-dark" : ""}`} aria-label="本轮活动流程">
      <ol>
        {FLOW_STEPS.map((step, index) => {
          const complete = index < activeIndex;
          const active = index === activeIndex;
          return (
            <li className={active ? "is-active" : complete ? "is-complete" : ""} key={step.id} aria-current={active ? "step" : undefined}>
              <i>{complete ? <Check size={11} strokeWidth={3} /> : index + 1}</i>
              <span>{step.short}</span>
              <small>{step.label}</small>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function RoundLiveStatus({
  roundNumber,
  counts,
  mode,
  switchedCount,
  revealedCount,
  totalPlayers,
  compact = false,
}: {
  roundNumber: number | bigint;
  counts: readonly number[];
  mode: "waiting" | "public" | "secret";
  switchedCount?: number;
  revealedCount?: number;
  totalPlayers: number;
  compact?: boolean;
}) {
  const status = mode === "secret"
    ? revealedCount !== undefined && revealedCount < totalPlayers
      ? `真实分组揭晓中 · ${revealedCount}/${totalPlayers}`
      : "秘密分组已揭晓"
    : mode === "public"
      ? "公开站队人数"
      : "提交站队后显示人数";

  return (
    <section className={`round-live-status is-${mode}${compact ? " is-compact" : ""}`} aria-label={`第 ${roundNumber.toString()} 轮实时状态`}>
      <div className="round-live-status__head">
        <p><Radio size={13} /> LIVE · ROUND {roundNumber.toString().padStart(2, "0")}</p>
        <div><span>总人数 <b>{totalPlayers}</b></span><strong>{status}</strong></div>
      </div>
      <div className="round-live-status__packets">
        {PACKETS.map((packet) => (
          <div key={packet.id} style={{ "--packet-color": packet.color, "--packet-ink": packet.ink } as React.CSSProperties}>
            <i />
            <span>{packet.name}</span>
            <strong>{mode === "waiting" ? "—" : counts[packet.id] ?? 0}{mode === "waiting" ? null : <small>人</small>}</strong>
          </div>
        ))}
      </div>
      <div className="round-live-status__truth">
        {mode === "secret" ? <><span>当前轮次</span><strong>{switchedCount ?? 0} 人反水</strong></> : mode === "waiting" ? <><span>人数已锁定</span><strong>先完成你的提交</strong></> : <><span>秘密结果</span><strong>揭晓后公布反水人数</strong></>}
      </div>
    </section>
  );
}

export function RoundSwitchHistory({ items, currentRound }: { items: readonly RoundSwitchSummary[]; currentRound: number | bigint }) {
  if (items.length === 0) return null;
  return (
    <section className="round-switch-history" aria-label="每轮反水人数">
      <div className="round-switch-history__heading"><span>反水档案</span><strong>每轮秘密揭晓后公开</strong></div>
      <div>
        {items.slice(-5).map((item) => (
          <article className={item.round === Number(currentRound) ? "is-current" : ""} key={item.round}>
            <span>R{String(item.round).padStart(2, "0")}</span>
            <strong>{item.switchedCount} 人反水</strong>
            <small>{item.totalPlayers} 人完成本轮</small>
          </article>
        ))}
      </div>
    </section>
  );
}

export function PacketChoiceGrid({ selected, onSelect, disabled }: { selected: PacketId | null; onSelect: (packet: PacketId) => void; disabled?: boolean }) {
  return (
    <div className="mobile-packets">
      {PACKETS.map((packet) => (
        <button
          type="button"
          key={packet.id}
          onClick={() => onSelect(packet.id)}
          className={selected === packet.id ? "mobile-packet is-selected" : "mobile-packet"}
          style={{ "--packet-color": packet.color, "--packet-ink": packet.ink } as React.CSSProperties}
          aria-pressed={selected === packet.id}
          disabled={disabled}
        >
          <span>{packet.name}</span><strong>0{packet.id + 1}</strong><small>平票优先级 {packet.id + 1}</small>
          {selected === packet.id && <i><Check size={14} /></i>}
        </button>
      ))}
    </div>
  );
}

export function StakeAmountPicker({ value, onChange, disabled }: { value: number; onChange: (value: number) => void; disabled?: boolean }) {
  return (
    <div className="stake-picker" role="group" aria-label="选择投入金额">
      {Array.from({ length: 10 }, (_, index) => index + 1).map((amount) => (
        <button type="button" key={amount} className={value === amount ? "is-selected" : ""} aria-pressed={value === amount} disabled={disabled} onClick={() => onChange(amount)}>
          <strong>{amount}</strong><span>MON</span>
        </button>
      ))}
    </div>
  );
}

export function ChoiceTrail({ publicPacketId, secretPacketId }: { publicPacketId: PacketId | null; secretPacketId: PacketId | null }) {
  const publicPacket = publicPacketId === null ? null : PACKETS[publicPacketId];
  const secretPacket = secretPacketId === null ? null : PACKETS[secretPacketId];
  const behavior = secretPacket === null ? "弃权" : publicPacketId === secretPacketId ? "守约" : "反水";

  return (
    <section className="choice-trail" aria-label="你的公开选择与秘密选择">
      <div className="choice-trail__heading">
        <div><span>你的选择轨迹</span><strong>{behavior}</strong></div>
        <p>{behavior === "反水" ? "公开意图与真实选择不同" : behavior === "守约" ? "公开意图与真实选择一致" : "没有完成最终揭晓"}</p>
      </div>
      <div className="choice-trail__path">
        <PacketChoiceCard label="公开站队" packet={publicPacket} />
        <div className={`choice-trail__turn is-${behavior === "反水" ? "switched" : behavior === "守约" ? "kept" : "abstained"}`}>
          <ArrowRight size={17} />
          <span>{behavior}</span>
        </div>
        <PacketChoiceCard label="秘密战队" packet={secretPacket} />
      </div>
    </section>
  );
}

export function PacketDistribution({ counts, winnerPacketId }: { counts: readonly number[]; winnerPacketId: PacketId | null }) {
  const largest = Math.max(1, ...counts);

  return (
    <section className="packet-distribution" aria-labelledby="packet-distribution-title">
      <div className="result-section-title">
        <div><span>真实结果</span><h2 id="packet-distribution-title">最终阵营分布</h2></div>
        <p>少数派按人数产生</p>
      </div>
      <div className="packet-distribution__list">
        {PACKETS.map((packet) => {
          const count = counts[packet.id] ?? 0;
          const winner = winnerPacketId === packet.id;
          return (
            <div className={winner ? "is-winner" : ""} key={packet.id} style={{ "--packet-color": packet.color, "--packet-ink": packet.ink } as React.CSSProperties}>
              <span className="packet-distribution__swatch">0{packet.id + 1}</span>
              <p><strong>{packet.name}</strong><small>{winner ? "本轮少数派" : `平票优先级 ${packet.id + 1}`}</small></p>
              <i><b style={{ width: `${Math.max(8, count / largest * 100)}%` }} /></i>
              <em>{count}<small>人</small></em>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PacketChoiceCard({ label, packet }: { label: string; packet: (typeof PACKETS)[number] | null }) {
  return (
    <div className="choice-trail__card" style={packet ? { "--packet-color": packet.color, "--packet-ink": packet.ink } as React.CSSProperties : undefined}>
      <span>{label}</span>
      <strong>{packet?.name ?? "未选择"}</strong>
      <small>{packet ? `0${packet.id + 1}` : "—"}</small>
    </div>
  );
}
