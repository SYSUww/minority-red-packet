"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, LockKeyhole, PartyPopper, ShieldCheck } from "lucide-react";
import { PACKETS, type PacketId } from "@/lib/game-config";

type PlayerStep = "join" | "signal" | "commit" | "locked" | "reveal" | "result";

export function PlayerGame() {
  const [step, setStep] = useState<PlayerStep>("join");
  const [name, setName] = useState("");
  const [signalPacket, setSignalPacket] = useState<PacketId | null>(null);
  const [secretPacket, setSecretPacket] = useState<PacketId | null>(null);

  const chosenPacket = useMemo(
    () => PACKETS.find((packet) => packet.id === secretPacket),
    [secretPacket],
  );

  if (step === "reveal" && chosenPacket) {
    return (
      <main className="phone-reveal" style={{ "--reveal-color": chosenPacket.color, "--reveal-ink": chosenPacket.ink } as React.CSSProperties}>
        <p>最终选择</p>
        <span>{chosenPacket.name}</span>
        <strong>{chosenPacket.amount}<small> MON</small></strong>
        <div className="raise-phone">现在，举起手机</div>
        <button onClick={() => setStep("result")}>查看结算结果</button>
      </main>
    );
  }

  if (step === "result" && chosenPacket) {
    return (
      <main className="player-shell result-shell">
        <div className="confetti-mark"><PartyPopper size={32} /></div>
        <p className="eyebrow">结算完成 · #M472</p>
        <h1>{secretPacket === 2 ? "你进入了最小群体" : "这次，你没有进入少数派"}</h1>
        <div className="result-ticket">
          <span>获胜红包</span><strong>藤紫 · 0.03 MON</strong>
          <span>获胜人数</span><strong>1 人</strong>
          <span>可领取</span><strong>{secretPacket === 2 ? "0.03 MON" : "0 MON"}</strong>
        </div>
        <button className="mobile-primary" disabled={secretPacket !== 2}>
          {secretPacket === 2 ? "领取红包" : "本局未获胜"}
        </button>
        <button className="mobile-text" onClick={() => setStep("join")}>重新体验</button>
      </main>
    );
  }

  return (
    <main className="player-shell">
      <header className="player-header">
        <Link href="/" aria-label="返回首页"><ArrowLeft size={19} /></Link>
        <span className="mode-tag">本地演示</span>
        <p>#M472</p>
      </header>

      {step === "join" && (
        <section className="player-panel join-panel">
          <div className="tiny-packets" aria-hidden="true">
            {PACKETS.map((packet) => <i key={packet.id} style={{ background: packet.color }} />)}
          </div>
          <p className="eyebrow">你被邀请加入</p>
          <h1>少数派红包</h1>
          <p className="mobile-lead">先让大家看到你的站队，再把真正的选择锁进链上。</p>
          <label>
            你的现场昵称
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={12} placeholder="例如：小满" />
          </label>
          <button className="mobile-primary" disabled={!name.trim()} onClick={() => setStep("signal")}>加入游戏</button>
          <div className="privacy-note"><ShieldCheck size={16} /> 自动创建临时游戏账户，无需安装钱包</div>
        </section>
      )}

      {step === "signal" && (
        <PacketPicker
          eyebrow="公开站队 · 还可更改"
          title={`${name}，先让大家看看你的意图。`}
          description="这个选择会显示在大屏上，但不会锁定你的最终答案。"
          selected={signalPacket}
          onSelect={setSignalPacket}
          button="公开我的站队"
          onContinue={() => setStep("commit")}
        />
      )}

      {step === "commit" && (
        <PacketPicker
          eyebrow="秘密选择 · 仅你可见"
          title="现在，选一个真正要抢的红包。"
          description={`你刚才公开选择了${signalPacket === null ? "一个红包" : PACKETS[signalPacket].name}。可以守约，也可以悄悄反水。`}
          selected={secretPacket}
          onSelect={setSecretPacket}
          button="秘密锁定选择"
          secret
          onContinue={() => setStep("locked")}
        />
      )}

      {step === "locked" && (
        <section className="player-panel locked-panel">
          <div className="lock-medallion"><LockKeyhole size={29} /></div>
          <p className="eyebrow">已最终确认</p>
          <h1>你的答案已经锁定</h1>
          <p className="mobile-lead">Commitment 已进入 Monad 区块。现在没人能看见，也不能修改。</p>
          <div className="lock-facts">
            <span><Check size={16} /> Salt 已安全保存在本机</span>
            <span><Check size={16} /> 选择哈希已最终确认</span>
            <span><Check size={16} /> 等待主持人统一揭晓</span>
          </div>
          <button className="mobile-primary" onClick={() => setStep("reveal")}>模拟统一揭晓</button>
        </section>
      )}
    </main>
  );
}

function PacketPicker({
  eyebrow,
  title,
  description,
  selected,
  onSelect,
  button,
  onContinue,
  secret = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  selected: PacketId | null;
  onSelect: (packet: PacketId) => void;
  button: string;
  onContinue: () => void;
  secret?: boolean;
}) {
  return (
    <section className="player-panel picker-panel">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="mobile-lead">{description}</p>
      <div className="mobile-packets">
        {PACKETS.map((packet) => (
          <button
            key={packet.id}
            onClick={() => onSelect(packet.id)}
            className={selected === packet.id ? "mobile-packet is-selected" : "mobile-packet"}
            style={{ "--packet-color": packet.color, "--packet-ink": packet.ink } as React.CSSProperties}
            aria-pressed={selected === packet.id}
          >
            <span>{packet.name}</span><strong>{packet.amount}</strong><small>MON</small>
            {selected === packet.id && <i><Check size={14} /></i>}
          </button>
        ))}
      </div>
      {secret && <p className="secret-note"><LockKeyhole size={15} /> 选中后会在本机生成随机 Salt，只向链上提交哈希。</p>}
      <button className="mobile-primary" disabled={selected === null} onClick={onContinue}>{button}</button>
    </section>
  );
}
