"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleDollarSign, Crosshair, TrendingDown, TrendingUp } from "lucide-react";
import { formatEther } from "viem";

import { PACKETS } from "@/lib/game-config";
import type { PlayerIntelProfile } from "@/lib/player-intelligence";

type ProfitTone = "positive" | "negative" | "neutral";

export function PlayerIntelligencePanel({
  profiles,
  balanceLabel,
  roundProfitLabel,
  roundProfitTone = "neutral",
}: {
  profiles: readonly PlayerIntelProfile[];
  balanceLabel: string;
  roundProfitLabel: string;
  roundProfitTone?: ProfitTone;
}) {
  const selfId = profiles.find((profile) => profile.isSelf)?.id;
  const [selectedId, setSelectedId] = useState(selfId ?? profiles[0]?.id ?? "");

  useEffect(() => {
    if (profiles.some((profile) => profile.id === selectedId)) return;
    setSelectedId(selfId ?? profiles[0]?.id ?? "");
  }, [profiles, selectedId, selfId]);

  const selected = useMemo(
    () => profiles.find((profile) => profile.id === selectedId) ?? profiles[0],
    [profiles, selectedId],
  );

  if (!selected) return null;
  const preference = PACKETS[selected.preferencePacketId];

  return (
    <aside className="player-intelligence" aria-label="玩家资产与对手情报">
      <section className="player-wallet-card">
        <div><CircleDollarSign size={16} /><span>你的资产</span></div>
        <p><span>当前余额</span><strong>{balanceLabel}</strong></p>
        <p className={`is-${roundProfitTone}`}>
          <span>本轮收益</span>
          <strong>{roundProfitTone === "positive" ? <TrendingUp size={13} /> : roundProfitTone === "negative" ? <TrendingDown size={13} /> : null}{roundProfitLabel}</strong>
        </p>
      </section>

      <section className="player-scout-board">
        <header><div><Crosshair size={14} /><span>选手情报</span></div><strong>{profiles.length} 人</strong></header>
        <div className="player-scout-list" role="list" aria-label="所有选手">
          {profiles.map((profile) => {
            const packet = PACKETS[profile.preferencePacketId];
            return (
              <button
                type="button"
                key={profile.id}
                className={`${profile.id === selected.id ? "is-selected" : ""}${profile.isSelf ? " is-self" : ""}`}
                onClick={() => setSelectedId(profile.id)}
                style={{ "--preference-color": packet.color, "--preference-ink": packet.ink } as React.CSSProperties}
                aria-pressed={profile.id === selected.id}
              >
                <i>{profile.displayName.slice(0, 1).toUpperCase()}</i>
                <span><strong>{profile.displayName}{profile.isSelf ? " · 你" : ""}</strong><small>偏好 {packet.name}</small></span>
              </button>
            );
          })}
        </div>

        <div className="player-scout-detail" style={{ "--preference-color": preference.color, "--preference-ink": preference.ink } as React.CSSProperties}>
          <div className="player-scout-detail__head">
            <div><span>PLAYER FILE</span><strong>{selected.displayName}</strong></div>
            <p><i />偏好颜色 · {preference.name}</p>
          </div>
          <div className="player-round-ledger">
            <div className="player-round-ledger__labels"><span>轮次</span><span>公开</span><span>秘密</span><span>金额</span><span>结果</span></div>
            {selected.rounds.length === 0 ? <p className="player-round-ledger__empty">尚无已结算记录。本轮结束后会在这里更新。</p> : selected.rounds.slice(0, 4).map((round) => {
              const publicPacket = round.publicPacketId === null ? null : PACKETS[round.publicPacketId];
              const secretPacket = round.secretPacketId === null ? null : PACKETS[round.secretPacketId];
              const net = round.payoutWei - round.stakeWei;
              return (
                <article key={round.round}>
                  <b>R{String(round.round).padStart(2, "0")}</b>
                  <span style={publicPacket ? { "--round-color": publicPacket.color } as React.CSSProperties : undefined}><i />{publicPacket?.name ?? "—"}</span>
                  <span style={secretPacket ? { "--round-color": secretPacket.color } as React.CSSProperties : undefined}><i />{secretPacket?.name ?? "—"}</span>
                  <strong>{formatEther(round.stakeWei)}<small> MON</small></strong>
                  <em className={`is-${round.outcome}`}>{round.outcome === "won" ? "少数派" : round.outcome === "refunded" ? "退款" : "多数派"}<small>{signedMon(net)}</small></em>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </aside>
  );
}

function signedMon(value: bigint) {
  return `${value > 0n ? "+" : ""}${formatEther(value)} MON`;
}
