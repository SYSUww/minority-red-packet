"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, RotateCcw, Users } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { type Address } from "viem";
import { HostChainSetup } from "@/components/host-chain-setup";
import { PACKETS } from "@/lib/game-config";

type HostPhase = "lobby" | "signal" | "commit" | "reveal" | "settled";

const phaseOrder: HostPhase[] = ["lobby", "signal", "commit", "reveal", "settled"];
const phaseLabels: Record<HostPhase, string> = {
  lobby: "等待加入",
  signal: "公开站队",
  commit: "秘密锁定",
  reveal: "同时揭晓",
  settled: "结算完成",
};

const players = ["Alice", "Bob", "Carol", "David", "Eve", "Frank", "Grace", "Henry"];
const signalGroups = [["Alice"], ["Bob", "Carol"], ["David"], ["Eve", "Frank", "Grace", "Henry"]];
const revealGroups = [
  ["Alice", "Grace", "Henry"],
  ["Bob", "Carol"],
  ["David"],
  ["Eve", "Frank"],
];

export function HostConsole() {
  const [phase, setPhase] = useState<HostPhase>("lobby");
  const [joinUrl, setJoinUrl] = useState("http://localhost:3000/play/demo");
  const [block, setBlock] = useState(44_831_209);

  function handleGameCreated(gameId: bigint, contractAddress: Address) {
    setJoinUrl(`${window.location.origin}/play/${gameId.toString()}?contract=${contractAddress}`);
  }

  useEffect(() => {
    setJoinUrl(`${window.location.origin}/play/demo`);
    const timer = window.setInterval(() => setBlock((value) => value + 1), 900);
    return () => window.clearInterval(timer);
  }, []);

  const phaseIndex = phaseOrder.indexOf(phase);
  const groups = phase === "reveal" || phase === "settled" ? revealGroups : signalGroups;
  const nextLabel = useMemo(() => {
    if (phase === "lobby") return "开始公开站队";
    if (phase === "signal") return "锁定公开站队";
    if (phase === "commit") return "开始统一揭晓";
    if (phase === "reveal") return "在合约中结算";
    return "再开一局";
  }, [phase]);

  function advance() {
    if (phase === "settled") {
      setPhase("lobby");
      return;
    }
    setPhase(phaseOrder[phaseIndex + 1]);
  }

  return (
    <div className="host-console">
      <header className="console-header">
        <div>
          <Link href="/" className="back-link"><ArrowLeft size={16} /> 返回首页</Link>
          <h1>少数派红包 <span>#M472</span></h1>
        </div>
        <div className="console-meta">
          <span className="mode-tag">本地演示</span>
          <span>Monad 区块 <strong>#{block.toLocaleString()}</strong></span>
        </div>
      </header>

      <nav className="phase-rail" aria-label="游戏阶段">
        {phaseOrder.map((item, index) => (
          <div className={index <= phaseIndex ? "phase-step is-active" : "phase-step"} key={item}>
            <span>{index < phaseIndex ? <CheckCircle2 size={18} /> : index + 1}</span>
            <p>{phaseLabels[item]}</p>
          </div>
        ))}
      </nav>

      <HostChainSetup onGameCreated={handleGameCreated} />

      <section className="console-stage">
        <div className="console-titlebar">
          <div>
            <p className="eyebrow">{phaseLabels[phase]} · GAME M472</p>
            <h2>{getPhaseTitle(phase)}</h2>
          </div>
          {phase !== "settled" && (
            <div className="block-clock">
              <strong>{phase === "lobby" ? "READY" : phase === "signal" ? "30" : phase === "commit" ? "20" : "15"}</strong>
              <span>{phase === "lobby" ? "可以开始" : "剩余区块"}</span>
            </div>
          )}
        </div>

        {phase === "lobby" ? (
          <Lobby joinUrl={joinUrl} />
        ) : phase === "commit" ? (
          <CommitBoard />
        ) : (
          <PacketBoard groups={groups} phase={phase} />
        )}
      </section>

      <footer className="console-controls">
        <div className="player-total"><Users size={18} /><strong>8 / 8</strong><span>名玩家在线</span></div>
        <p>{getPhaseHint(phase)}</p>
        <button className="button console-button" onClick={advance}>
          {phase === "settled" ? <RotateCcw size={18} /> : null}
          {nextLabel}
          {phase !== "settled" ? <ArrowRight size={18} /> : null}
        </button>
      </footer>
    </div>
  );
}

function Lobby({ joinUrl }: { joinUrl: string }) {
  return (
    <div className="lobby-grid">
      <div className="qr-card">
        <QRCodeSVG value={joinUrl} size={176} bgColor="#fffdf8" fgColor="#17131f" level="M" />
        <div><strong>扫码加入</strong><span>{joinUrl.replace(/^https?:\/\//, "")}</span></div>
      </div>
      <div className="lobby-players">
        {players.map((player, index) => (
          <div className="lobby-player" key={player}>
            <span>{player.slice(0, 1)}</span>
            <p><strong>{player}</strong><small>{index % 3 === 0 ? "刚刚加入" : "已就位"}</small></p>
            <i />
          </div>
        ))}
      </div>
    </div>
  );
}

function PacketBoard({ groups, phase }: { groups: string[][]; phase: HostPhase }) {
  return (
    <div className={`host-packet-grid phase-${phase}`}>
      {PACKETS.map((packet, index) => {
        const isWinner = phase === "settled" && index === 2;
        return (
          <article
            className={isWinner ? "host-packet is-winner" : "host-packet"}
            key={packet.id}
            style={{ "--packet-color": packet.color, "--packet-ink": packet.ink } as React.CSSProperties}
          >
            {isWinner && <span className="winner-ribbon">少数派</span>}
            <div className="host-packet__head"><span>{packet.name}</span><small>0{index + 1}</small></div>
            <strong>{packet.amount}</strong><em>MON</em>
            <div className="host-player-list">
              {groups[index].map((name) => <span key={name}>{name.slice(0, 1)}<small>{name}</small></span>)}
            </div>
            <p>{groups[index].length} 人</p>
          </article>
        );
      })}
    </div>
  );
}

function CommitBoard() {
  return (
    <div className="commit-board">
      <div className="commit-orbit">
        <span className="commit-count">8<small>/ 8</small></span>
        {players.map((player, index) => (
          <i key={player} style={{ "--i": index } as React.CSSProperties}>{player.slice(0, 1)}</i>
        ))}
      </div>
      <div>
        <h3>所有选择都已锁定</h3>
        <p>链上现在只有 8 份 Commitment。任何人，包括主持人，都还看不到红包编号。</p>
        <div className="tx-steps"><span className="done">已提交</span><span className="done">已进入区块</span><span className="done">已最终确认</span></div>
      </div>
    </div>
  );
}

function getPhaseTitle(phase: HostPhase) {
  if (phase === "lobby") return "人到齐了，就开始猜心。";
  if (phase === "signal") return "你站在哪里，所有人都看得见。";
  if (phase === "commit") return "答案已经锁定，但没人能偷看。";
  if (phase === "reveal") return "三、二、一——举手机！";
  return "紫色只有一人，成为本局少数派。";
}

function getPhaseHint(phase: HostPhase) {
  if (phase === "lobby") return "人数达到 4 人后可以开始，最多 8 人。";
  if (phase === "signal") return "公开选择可以反复更改，这不是最终答案。";
  if (phase === "commit") return "大屏只显示进度，不显示任何人的最终红包。";
  if (phase === "reveal") return "未按截止区块揭晓的玩家会弃权，不阻塞结算。";
  return "紫色 0.03 MON 由 David 独得，其余金额退回主持人。";
}
