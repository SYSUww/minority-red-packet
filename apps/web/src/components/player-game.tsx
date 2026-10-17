"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, LockKeyhole, PartyPopper, ShieldCheck } from "lucide-react";
import { formatEther } from "viem";
import { PACKETS, type PacketId } from "@/lib/game-config";
import { createMockRoundPlayers, settleMockRound } from "@/lib/mock-round";
import { buildPlayerIntelProfiles, loadRoomPlayerHistory, type PlayerIntelRound } from "@/lib/player-intelligence";
import type { PlayerHistoryRecord } from "@/lib/player-history";
import { loadRoundSwitches, upsertRoundSwitch, type RoundSwitchSummary } from "@/lib/round-switch-history";
import { ChainPlayerGame } from "@/components/chain-player-game";
import { PlayerIntelligencePanel } from "@/components/player-intelligence-panel";
import { ChoiceTrail, PacketChoiceGrid, PacketDistribution, PlayerFlowRail, RoundLiveStatus, RoundSwitchHistory, StakeAmountPicker, type PlayerFlowStep } from "@/components/player-flow-ui";

type PlayerStep = "join" | "signal" | "commit" | "locked" | "reveal" | "result";
const DEMO_ROOM_ID = "DEMO-472";
const MON = 10n ** 18n;
const MOCK_STARTING_BALANCE = 100n * MON;

export function PlayerGame({ gameId }: { gameId: string }) {
  if (gameId !== "demo") return <ChainPlayerGame gameId={gameId} />;
  return <MockPlayerGame />;
}

function MockPlayerGame() {
  const [step, setStep] = useState<PlayerStep>("join");
  const [name, setName] = useState("");
  const [signalPacket, setSignalPacket] = useState<PacketId | null>(null);
  const [secretPacket, setSecretPacket] = useState<PacketId | null>(null);
  const [stakeUnits, setStakeUnits] = useState(3);
  const [round, setRound] = useState(1);
  const [switchHistory, setSwitchHistory] = useState<readonly RoundSwitchSummary[]>([]);
  const [historyRecords, setHistoryRecords] = useState<readonly PlayerHistoryRecord[]>([]);

  const chosenPacket = useMemo(
    () => PACKETS.find((packet) => packet.id === secretPacket),
    [secretPacket],
  );
  const roundSummary = useMemo(() => settleMockRound(createMockRoundPlayers({
    name,
    signalPacketId: signalPacket ?? 0,
    secretPacketId: secretPacket ?? 2,
    stakeUnits,
  })), [name, secretPacket, signalPacket, stakeUnits]);
  const publicCounts = useMemo(() => {
    if (step === "join") return [0, 0, 0, 0];
    const counts = [...roundSummary.publicCounts];
    if (signalPacket === null) counts[0] -= 1;
    return counts;
  }, [roundSummary.publicCounts, signalPacket, step]);
  const currentSwitchSummary = useMemo(() => ({
    round,
    switchedCount: roundSummary.switchedCount,
    totalPlayers: roundSummary.results.length,
  }), [round, roundSummary.results.length, roundSummary.switchedCount]);
  const visibleSwitchHistory = step === "result"
    ? upsertRoundSwitch(switchHistory, currentSwitchSummary)
    : switchHistory;
  const currentIntelRounds = useMemo(() => step === "result"
    ? Object.fromEntries(roundSummary.results.map((player) => [player.id, mockIntelRound(round, player, roundSummary.winnerPacketId)]))
    : {}, [round, roundSummary.results, roundSummary.winnerPacketId, step]);
  const playerProfiles = useMemo(() => buildPlayerIntelProfiles(
    historyRecords,
    roundSummary.results.map((player, index) => ({
      id: player.id,
      displayName: player.id === "you" ? name || "你" : player.name,
      isSelf: player.id === "you",
      fallbackPreferencePacketId: (player.id === "you" ? signalPacket ?? 0 : (index - 1 + 4) % 4) as PacketId,
    })),
    currentIntelRounds,
  ), [currentIntelRounds, historyRecords, name, roundSummary.results, signalPacket]);
  const ownProfile = playerProfiles.find((profile) => profile.isSelf);
  const settledNetWei = ownProfile?.rounds.reduce((total, item) => total + item.payoutWei - item.stakeWei, 0n) ?? 0n;
  const stakeIsLocked = step === "commit" || step === "locked" || step === "reveal";
  const mockBalanceWei = MOCK_STARTING_BALANCE + settledNetWei - (stakeIsLocked ? BigInt(stakeUnits) * MON : 0n);
  const ownCurrentRound = currentIntelRounds.you;
  const roundProfitWei = ownCurrentRound ? ownCurrentRound.payoutWei - ownCurrentRound.stakeWei : null;

  useEffect(() => {
    void Promise.all([
      loadRoomPlayerHistory(DEMO_ROOM_ID, "mock"),
      loadRoundSwitches(DEMO_ROOM_ID, "mock"),
    ]).then(([records, switches]) => {
      setHistoryRecords(records);
      setSwitchHistory(switches);
      const latestRound = records.reduce((largest, record) => Math.max(largest, record.round), 0);
      if (latestRound > 0) setRound((current) => current === 1 ? latestRound + 1 : current);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (step !== "result") return;
    const records = roundSummary.results.map((player) => ({
      roundId: `${DEMO_ROOM_ID}:round-${round}`,
      source: "mock",
      roomId: DEMO_ROOM_ID,
      round,
      playerId: player.id,
      displayName: player.id === "you" ? name || "你" : player.name,
      isMock: player.id !== "you",
      publicPacketId: player.signalPacketId,
      secretPacketId: player.secretPacketId,
      stakeWei: player.stakeWei.toString(),
      winningPacketId: roundSummary.winnerPacketId,
      packetCounts: roundSummary.finalCounts,
      winnerCount: roundSummary.winnerCount,
      behavior: player.signalPacketId === player.secretPacketId ? "kept" : "switched",
      outcome: roundSummary.winnerPacketId === null ? "refunded" : player.won ? "won" : "lost",
      payoutWei: player.payoutWei.toString(),
    }));
    void fetch("/api/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ records }),
    }).then((response) => {
      if (!response.ok) throw new Error(`history API returned ${response.status}`);
      return loadRoomPlayerHistory(DEMO_ROOM_ID, "mock");
    }).then(setHistoryRecords).catch(() => undefined);
  }, [name, round, roundSummary.finalCounts, roundSummary.results, roundSummary.winnerCount, roundSummary.winnerPacketId, step]);

  if (step === "reveal" && chosenPacket) {
    return (
      <main className="phone-reveal" style={{ "--reveal-color": chosenPacket.color, "--reveal-ink": chosenPacket.ink } as React.CSSProperties}>
        <RoundLiveStatus roundNumber={round} counts={roundSummary.finalCounts} mode="secret" switchedCount={roundSummary.switchedCount} revealedCount={8} totalPlayers={8} compact />
        <p>第 {round} 轮 · 最终选择</p>
        <span>{chosenPacket.name}</span>
        <strong>0{chosenPacket.id + 1}<small> · 平票优先级 {chosenPacket.id + 1}</small></strong>
        <div className="raise-phone">现在，举起手机</div>
        <button onClick={() => setStep("result")}>查看结算结果</button>
      </main>
    );
  }

  if (step === "result" && chosenPacket) {
    const ownResult = roundSummary.results.find((player) => player.id === "you");
    const won = ownResult?.won ?? false;
    const payoutWei = ownResult?.payoutWei ?? 0n;
    const stakeWei = ownResult?.stakeWei ?? 0n;
    const netWei = payoutWei - stakeWei;
    const winnerPacket = roundSummary.winnerPacketId === null ? null : PACKETS[roundSummary.winnerPacketId];
    return (
      <main className="player-shell result-shell mock-result-shell">
        <header className="player-header">
          <Link href="/" aria-label="返回首页"><ArrowLeft size={19} /></Link>
          <span className="mode-tag">本地演示</span>
          <p>#472 · R{String(round).padStart(2, "0")}</p>
        </header>
        <PlayerIntelligencePanel profiles={playerProfiles} balanceLabel={`${formatEther(mockBalanceWei)} MON`} roundProfitLabel={roundProfitWei === null ? "—" : `${roundProfitWei > 0n ? "+" : ""}${formatEther(roundProfitWei)} MON`} roundProfitTone={roundProfitWei === null ? "neutral" : roundProfitWei > 0n ? "positive" : roundProfitWei < 0n ? "negative" : "neutral"} />
        <RoundLiveStatus roundNumber={round} counts={roundSummary.finalCounts} mode="secret" switchedCount={roundSummary.switchedCount} revealedCount={8} totalPlayers={8} />
        <RoundSwitchHistory items={visibleSwitchHistory} currentRound={round} />
        <PlayerFlowRail current="result" />
        <section className="player-panel settlement-panel">
          <div className={`settlement-hero${won ? " is-won" : " is-lost"}`} style={winnerPacket ? { "--result-color": winnerPacket.color, "--result-ink": winnerPacket.ink } as React.CSSProperties : undefined}>
            <div className="settlement-hero__label"><span>ROUND RESULT</span><strong>{winnerPacket?.name ?? "—"} · 少数派</strong></div>
            <h1>{won ? "你站进了真正的少数派" : "你看见了少数派，但不在其中"}</h1>
            <div className="settlement-hero__numbers">
              <p><span>模拟可领取</span><strong>{formatEther(payoutWei)}<small> MON</small></strong></p>
              <p><span>本轮净结果</span><strong>{netWei > 0n ? "+" : ""}{formatEther(netWei)} MON</strong></p>
              <p><span>你的投入</span><strong>{stakeUnits} MON</strong></p>
            </div>
          </div>
          <ChoiceTrail publicPacketId={signalPacket} secretPacketId={secretPacket} />
          <PacketDistribution counts={roundSummary.finalCounts} winnerPacketId={roundSummary.winnerPacketId} />
          <div className="result-section-title public-result-title"><div><span>演示账本</span><h2>每个人的真实提交</h2></div><p>与链上结果页一致</p></div>
          <div className="public-results">
            {roundSummary.results.map((player) => {
              const switched = player.signalPacketId !== player.secretPacketId;
              return <div className={player.id === "you" ? "is-self" : ""} key={player.id}>
                <p><code>{player.id === "you" ? `${player.name}（你）` : player.name}</code><small>{formatEther(player.stakeWei)} MON</small></p>
                <span>{PACKETS[player.signalPacketId].name} → {PACKETS[player.secretPacketId].name}</span>
                <em>{player.won ? `${formatEther(player.payoutWei)} MON` : "—"}</em>
                <strong className={`result-behavior is-${switched ? "switched" : "kept"}`}>{switched ? "反水" : "守约"}</strong>
              </div>;
            })}
          </div>
          <div className="mock-result-note"><PartyPopper size={17} /><span>这是流程演示，不会产生真实资产领取。</span></div>
          <button className="mobile-text" onClick={() => {
            setSwitchHistory((current) => upsertRoundSwitch(current, currentSwitchSummary));
            setStep("join");
            setSignalPacket(null);
            setSecretPacket(null);
            setRound((current) => current + 1);
          }}>进入第 {round + 1} 轮</button>
          <p className="next-round-note">房间 #472 持续有效；下一轮重新选择投入和阵营。</p>
        </section>
      </main>
    );
  }

  const flowStep: PlayerFlowStep = step === "locked" ? "reveal" : step;

  return (
    <main className="player-shell">
      <header className="player-header">
        <Link href="/" aria-label="返回首页"><ArrowLeft size={19} /></Link>
        <span className="mode-tag">本地演示</span>
        <p>#472 · R{String(round).padStart(2, "0")}</p>
      </header>
      <PlayerIntelligencePanel profiles={playerProfiles} balanceLabel={`${formatEther(mockBalanceWei)} MON`} roundProfitLabel={stakeIsLocked ? "待结算" : "—"} />
      <RoundLiveStatus roundNumber={round} counts={publicCounts} mode={step === "join" || step === "signal" ? "waiting" : "public"} totalPlayers={8} />
      <RoundSwitchHistory items={switchHistory} currentRound={round} />
      <PlayerFlowRail current={flowStep} />

      {step === "join" && (
        <section className="player-panel join-panel">
          <div className="tiny-packets" aria-hidden="true">
            {PACKETS.map((packet) => <i key={packet.id} style={{ background: packet.color }} />)}
          </div>
          <p className="eyebrow">第 {round} 轮 · 玩家身份</p>
          <h1>先留下你的名字</h1>
          <p className="mobile-lead">下一步同时选择公开站队和本轮投入，再进入秘密选择。</p>
          <label>
            你的现场昵称
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={12} placeholder="例如：小满" />
          </label>
          <button className="mobile-primary" disabled={!name.trim()} onClick={() => setStep("signal")}>进入第 {round} 轮</button>
          <div className="privacy-note"><ShieldCheck size={16} /> 本地演示：不连接钱包，也不会发送真实交易</div>
        </section>
      )}

      {step === "signal" && (
        <PacketPicker
          eyebrow="公开站队 · 还可更改"
          title={`${name}，先让大家看看你的意图。`}
          description="这个选择会显示在大屏上，但不会锁定你的最终答案。"
          selected={signalPacket}
          onSelect={setSignalPacket}
          button={`确认站队并投入 ${stakeUnits} MON`}
          stakeUnits={stakeUnits}
          onStakeChange={setStakeUnits}
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
            <span><Check size={16} /> 等待区块时间进入统一揭晓</span>
          </div>
          <button className="mobile-primary" onClick={() => setStep("reveal")}>模拟统一揭晓</button>
        </section>
      )}
    </main>
  );
}

function mockIntelRound(
  round: number,
  player: ReturnType<typeof settleMockRound>["results"][number],
  winnerPacketId: PacketId | null,
): PlayerIntelRound {
  return {
    round,
    publicPacketId: player.signalPacketId,
    secretPacketId: player.secretPacketId,
    stakeWei: player.stakeWei,
    payoutWei: player.payoutWei,
    outcome: winnerPacketId === null ? "refunded" : player.won ? "won" : "lost",
  };
}

function PacketPicker({
  eyebrow,
  title,
  description,
  selected,
  onSelect,
  button,
  onContinue,
  stakeUnits,
  onStakeChange,
  secret = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  selected: PacketId | null;
  onSelect: (packet: PacketId) => void;
  button: string;
  onContinue: () => void;
  stakeUnits?: number;
  onStakeChange?: (amount: number) => void;
  secret?: boolean;
}) {
  return (
    <section className="player-panel picker-panel">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="mobile-lead">{description}</p>
      <PacketChoiceGrid selected={selected} onSelect={onSelect} />
      {stakeUnits !== undefined && onStakeChange && <div className="public-stake-block"><div className="join-stake-heading"><span>本轮投入金额</span><strong>{stakeUnits} MON</strong></div><StakeAmountPicker value={stakeUnits} onChange={onStakeChange} /></div>}
      {secret && <p className="secret-note"><LockKeyhole size={15} /> 选中后会在本机生成随机 Salt，只向链上提交哈希。</p>}
      <button className="mobile-primary" disabled={selected === null} onClick={onContinue}>{button}</button>
    </section>
  );
}
