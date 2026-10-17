"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Coins, Eye, FlaskConical, LockKeyhole, Play, RefreshCcw, ShieldOff, Sparkles, Trophy, Users, X } from "lucide-react";
import { formatEther } from "viem";
import { PACKETS, type PacketId } from "@/lib/game-config";
import { createMockCommitment, MockGameEngine, type GamePhase, type GameSnapshot, type Settlement } from "@/lib/game-engine";

const ONE_MON = 1_000_000_000_000_000_000n;
const TEST_NAMES = ["你", "Mock 阿洛", "Mock 栗子", "Mock K", "Mock 松塔", "Mock 南风", "Mock 七月", "Mock 小海"];
const PHASES: readonly { key: GamePhase; label: string; note: string }[] = [
  { key: "lobby", label: "准备玩家", note: "4—8 人" },
  { key: "signal", label: "公开站队", note: "所有人可见" },
  { key: "commit", label: "秘密锁定", note: "允许反水" },
  { key: "reveal", label: "统一揭晓", note: "核对答案" },
  { key: "settled", label: "完成结算", note: "少数派获胜" },
];

type TestPlayer = {
  id: string;
  nickname: string;
  stakeUnits: number;
  signalPacketId: PacketId;
  secretPacketId: PacketId;
  salt: string;
};

type RoundRecord = {
  round: number;
  winningPacketId: PacketId | null;
  winnerCount: number;
  truthCount: number;
  lieCount: number;
  pot: bigint;
};

type PlayerTestState = {
  step: "signal" | "secret";
  selected: PacketId | null;
  stakeUnits: number;
};

export function TestLab() {
  const [players, setPlayers] = useState<TestPlayer[]>(() => createPlayers(4));
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [round, setRound] = useState(1);
  const [roundHistory, setRoundHistory] = useState<RoundRecord[]>([]);
  const [playerTest, setPlayerTest] = useState<PlayerTestState | null>(null);
  const [notice, setNotice] = useState("点击“以玩家视角测试”，你负责自己的选择，其余玩家自动使用 Mock 数据。");
  const engineRef = useRef<MockGameEngine | null>(null);
  const historySessionRef = useRef("");
  const phase = snapshot?.phase ?? "lobby";
  const phaseIndex = PHASES.findIndex((item) => item.key === phase);

  const publicCounts = useMemo(() => snapshot ? packetCounts(snapshot.players.flatMap((player) => player.signalPacketId === null ? [] : [player.signalPacketId as PacketId])) : packetCounts(players.map((player) => player.signalPacketId)), [players, snapshot]);
  const finalCounts = useMemo(() => packetCounts(players.map((player) => player.secretPacketId)), [players]);

  function setPlayerCount(count: number) {
    engineRef.current = null;
    setSnapshot(null);
    setRound(1);
    setRoundHistory([]);
    setPlayerTest(null);
    setPlayers(createPlayers(count, 1));
    setNotice(`本局共 ${count} 人：你操作 1 名玩家，其余 ${count - 1} 人由 Mock 自动完成。`);
  }

  function renamePlayer(id: string, nickname: string) {
    setPlayers((current) => current.map((player) => player.id === id ? { ...player, nickname } : player));
  }

  function changeStake(id: string, stakeUnits: number) {
    setPlayers((current) => current.map((player) => player.id === id ? { ...player, stakeUnits } : player));
  }

  function startSignal() {
    runSafely(() => {
      const engine = createEngine(players, round);
      engine.startSignal();
      for (const player of players) engine.signal(player.id, player.signalPacketId);
      engineRef.current = engine;
      setSnapshot(engine.getSnapshot());
      setNotice("公开站队已显示。点击任意红包可以修改玩家的公开意图。");
    });
  }

  function startPlayerTest() {
    runSafely(() => {
      engineRef.current = null;
      setSnapshot(null);
      setPlayerTest({ step: "signal", selected: null, stakeUnits: players[0].stakeUnits });
      setNotice("你正在以真实玩家视角操作；其他玩家的公开站队、投入和秘密选择由 Mock 自动生成。");
    });
  }

  function confirmPlayerChoice() {
    if (!playerTest || playerTest.selected === null) return;
    const { selected, step } = playerTest;
    runSafely(() => {
      if (step === "signal") {
        const updatedPlayers = players.map((item, index) => index === 0 ? { ...item, signalPacketId: selected, stakeUnits: playerTest.stakeUnits } : item);
        setPlayers(updatedPlayers);
        const current = createEngine(updatedPlayers, round);
        current.startSignal();
        for (const item of updatedPlayers) current.signal(item.id, item.signalPacketId);
        current.startCommit();
        engineRef.current = current;
        setSnapshot(current.getSnapshot());
        setPlayerTest({ step: "secret", selected: null, stakeUnits: updatedPlayers[0].stakeUnits });
        return;
      }

      const current = engine();
      const updatedPlayers = players.map((item, index) => index === 0 ? { ...item, secretPacketId: selected } : item);
      for (const item of updatedPlayers) {
        current.commit(item.id, createMockCommitment(current.gameId, item.id, item.secretPacketId, item.salt));
      }
      current.startReveal();
      for (const item of updatedPlayers) current.reveal(item.id, item.secretPacketId, item.salt);
      const result = current.settle();
      saveRound(result.winningPacketId, result.winners.length, updatedPlayers);
      persistRoundHistory(updatedPlayers, result);
      setPlayers(updatedPlayers);
      setSnapshot(current.getSnapshot());
      setPlayerTest(null);
      setNotice(`第 ${round} 轮已完成。你的两次选择来自真实操作，其余 ${players.length - 1} 名玩家来自 Mock。`);
    });
  }

  function chooseSignal(playerId: string, packetId: PacketId) {
    if (phase !== "signal") return;
    runSafely(() => {
      engineRef.current?.signal(playerId, packetId);
      setPlayers((current) => current.map((player) => player.id === playerId ? { ...player, signalPacketId: packetId } : player));
      setSnapshot(engineRef.current?.getSnapshot() ?? null);
    });
  }

  function startCommit() {
    runSafely(() => {
      setSnapshot(engine().startCommit());
      setNotice("现在编辑每名玩家的秘密选择。与公开站队不同即为反水。其他玩家在真实游戏中看不到这一列。");
    });
  }

  function chooseSecret(playerId: string, packetId: PacketId) {
    if (phase !== "commit") return;
    setPlayers((current) => current.map((player) => player.id === playerId ? { ...player, secretPacketId: packetId } : player));
  }

  function lockChoices() {
    runSafely(() => {
      const current = engine();
      for (const player of players) {
        current.commit(player.id, createMockCommitment(current.gameId, player.id, player.secretPacketId, player.salt));
      }
      setSnapshot(current.startReveal());
      setNotice("所有秘密选择已经锁定。点击统一揭晓即可验证承诺并计算少数派。");
    });
  }

  function revealAndSettle() {
    runSafely(() => {
      const current = engine();
      for (const player of players) current.reveal(player.id, player.secretPacketId, player.salt);
      const result = current.settle();
      saveRound(result.winningPacketId, result.winners.length);
      persistRoundHistory(players, result);
      setSnapshot(current.getSnapshot());
      setNotice(`第 ${round} 轮已完成。少数派已经瓜分本轮所有投入，可以让同一批玩家进入下一轮。`);
    });
  }

  function runAll() {
    runSafely(() => {
      const current = createEngine(players, round);
      current.startSignal();
      for (const player of players) current.signal(player.id, player.signalPacketId);
      current.startCommit();
      for (const player of players) {
        current.commit(player.id, createMockCommitment(current.gameId, player.id, player.secretPacketId, player.salt));
      }
      current.startReveal();
      for (const player of players) current.reveal(player.id, player.secretPacketId, player.salt);
      const result = current.settle();
      saveRound(result.winningPacketId, result.winners.length);
      persistRoundHistory(players, result);
      engineRef.current = current;
      setSnapshot(current.getSnapshot());
      setNotice(`第 ${round} 轮一键排练完成。可以查看结算，或让同一批玩家进入下一轮。`);
    });
  }

  function resetRound() {
    engineRef.current = null;
    setSnapshot(null);
    setPlayerTest(null);
    setPlayers(createPlayers(players.length, round, players.map((player) => player.nickname)));
    setRoundHistory((current) => current.filter((record) => record.round !== round));
    setNotice(`第 ${round} 轮已重置，没有产生任何链上交易。`);
  }

  function nextRound() {
    const next = round + 1;
    engineRef.current = null;
    setSnapshot(null);
    setRound(next);
    setPlayers(createPlayers(players.length, next, players.map((player) => player.nickname)));
    setNotice(`第 ${next} 轮已准备好。每名玩家可重新选择 1～10 模拟 MON。`);
  }

  function saveRound(winningPacketId: PacketId | null, winnerCount: number, roundPlayers: readonly TestPlayer[] = players) {
    const truthCount = roundPlayers.filter((player) => player.signalPacketId === player.secretPacketId).length;
    const record: RoundRecord = { round, winningPacketId, winnerCount, truthCount, lieCount: roundPlayers.length - truthCount, pot: totalPot(roundPlayers) };
    setRoundHistory((current) => [...current.filter((item) => item.round !== round), record].sort((a, b) => a.round - b.round));
  }

  function persistRoundHistory(roundPlayers: readonly TestPlayer[], settlement: Settlement) {
    if (!historySessionRef.current) historySessionRef.current = crypto.randomUUID();
    const sessionId = historySessionRef.current;
    const roundId = `${sessionId}:round-${round}:${crypto.randomUUID()}`;
    const winnerPayouts = new Map(settlement.winners.map((winner) => [winner.playerId, winner.amount]));
    const refunds = new Map(settlement.refunds.map((refund) => [refund.playerId, refund.amount]));
    const counts = settlement.packetCounts.map((item) => item.count) as [number, number, number, number];
    const records = roundPlayers.map((player, index) => {
      const behavior = player.signalPacketId === player.secretPacketId ? "kept" : "switched";
      const outcome = settlement.winningPacketId === null ? "refunded" : winnerPayouts.has(player.id) ? "won" : "lost";
      return {
        roundId,
        source: "mock",
        roomId: `LOCAL-TEST:${sessionId}`,
        round,
        playerId: `${sessionId}:${player.id}`,
        displayName: player.nickname,
        isMock: index > 0,
        publicPacketId: player.signalPacketId,
        secretPacketId: player.secretPacketId,
        stakeWei: (BigInt(player.stakeUnits) * ONE_MON).toString(),
        winningPacketId: settlement.winningPacketId,
        packetCounts: counts,
        winnerCount: settlement.winners.length,
        behavior,
        outcome,
        payoutWei: (winnerPayouts.get(player.id) ?? refunds.get(player.id) ?? 0n).toString(),
      };
    });

    void fetch("/api/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ records }),
    }).then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      setNotice((current) => `${current} 历史 JSON 已更新。`);
    }).catch((error) => {
      setNotice((current) => `${current} 历史写入失败：${error instanceof Error ? error.message : "未知错误"}`);
    });
  }

  function runSafely(action: () => void) {
    try {
      action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "测试操作失败，请重新开始。 ");
    }
  }

  function engine() {
    if (!engineRef.current) throw new Error("测试局尚未开始。 ");
    return engineRef.current;
  }

  const settlement = snapshot?.settlement;
  const winners = new Map(settlement?.winners.map((winner) => [winner.playerId, winner.amount]) ?? []);

  return (
    <main className="test-lab">
      <header className="test-lab__header">
        <div>
          <Link href="/" className="test-back"><ArrowLeft size={16} /> 返回首页</Link>
          <p className="eyebrow">LOCAL REHEARSAL · ZERO TRANSACTIONS</p>
          <h1>一台电脑，<em>排练整场博弈。</em></h1>
          <p>这里是与正式合约隔离的测试沙盒。选择只存在于当前页面，刷新后自动清空。</p>
        </div>
        <div className="test-safety-card">
          <ShieldOff size={22} />
          <div><strong>不连接钱包</strong><span>不请求签名 · 不使用测试币 · 不写入区块链</span></div>
        </div>
      </header>

      <RehearsalScreen finalCounts={finalCounts} history={roundHistory} phase={phase} players={players} publicCounts={publicCounts} round={round} settlement={settlement} />

      <section className="test-command" aria-label="测试阶段控制">
        <ol className="test-phase-rail">
          {PHASES.map((item, index) => <li key={item.key} className={index < phaseIndex ? "is-done" : index === phaseIndex ? "is-active" : ""}><i>{index < phaseIndex ? <Check size={13} /> : index + 1}</i><span><strong>{item.label}</strong><small>{item.note}</small></span></li>)}
        </ol>
        <div className="test-command__message"><FlaskConical size={17} /><p>{notice}</p></div>
        <div className="test-command__actions">
          {phase === "lobby" ? <><button className="test-button test-button--quiet" onClick={runAll}><Sparkles size={16} />一键看结果</button><button className="test-button test-button--quiet" onClick={startSignal}><FlaskConical size={16} />导演台编辑</button><button className="test-button test-button--primary" onClick={startPlayerTest}><Users size={16} />以玩家视角测试</button></> : <><button className="test-button test-button--quiet" onClick={resetRound}><RefreshCcw size={15} />重新测试本轮</button><button className="test-button test-button--primary" onClick={phase === "signal" ? startCommit : phase === "commit" ? lockChoices : phase === "reveal" ? revealAndSettle : nextRound}><Play size={16} />{phaseActionLabel(phase, round)}</button></>}
        </div>
      </section>

      <section className="test-workbench">
        <aside className="test-tally" aria-label="红包人数变化">
          <div className="test-tally__heading"><p className="eyebrow">LIVE DISTRIBUTION</p><strong>{players.length} 人 · {formatEther(totalPot(players))} 模拟 MON</strong></div>
          <div className="test-tally__packets">
            {PACKETS.map((packet) => {
              const publicCount = publicCounts[packet.id];
              const finalCount = finalCounts[packet.id];
              const finalCountHidden = phase === "signal";
              const winner = settlement?.winningPacketId === packet.id;
              return <div className={winner ? "test-tally__packet is-winner" : "test-tally__packet"} key={packet.id} style={{ "--packet-color": packet.color, "--packet-ink": packet.ink } as React.CSSProperties}><div><span>{packet.name}</span><strong>0{packet.id + 1}</strong></div><div className="test-bars"><i style={{ "--bar-size": `${Math.max(8, publicCount / players.length * 100)}%` } as React.CSSProperties}><small>公开 {publicCount}</small></i><i className="is-secret" style={{ "--bar-size": finalCountHidden ? "8%" : `${Math.max(8, finalCount / players.length * 100)}%` } as React.CSSProperties}><small>最终 {finalCountHidden ? "?" : finalCount}</small></i></div>{winner && <em>少数派</em>}</div>;
            })}
          </div>
          <div className="test-tally__legend"><span><i />公开人数</span><span><i />最终人数</span></div>
        </aside>

        <article className="test-player-board">
          <div className="test-player-board__header">
            <div><p className="eyebrow">OPERATOR VIEW</p><h2>{phase === "lobby" ? "先准备虚拟玩家" : phase === "settled" ? "结果已经摊开" : "逐个调整玩家选择"}</h2></div>
            {phase === "lobby" && <div className="test-count-switch" aria-label="虚拟玩家人数">{[4, 5, 6, 7, 8].map((count) => <button aria-pressed={players.length === count} className={players.length === count ? "is-active" : ""} key={count} onClick={() => setPlayerCount(count)}>{count} 人</button>)}</div>}
          </div>
          <div className="test-player-list">
            {players.map((player, index) => {
              const switched = player.signalPacketId !== player.secretPacketId;
              const payout = winners.get(player.id);
              return <div className="test-player-row" key={player.id}>
                <div className="test-player-identity"><i>{index + 1}</i>{phase === "lobby" ? <input aria-label={`玩家 ${index + 1} 昵称`} maxLength={8} value={player.nickname} onChange={(event) => renamePlayer(player.id, event.target.value)} /> : <div><strong>{player.nickname}</strong><span>{player.id}</span></div>}</div>
                <ChoiceButtons label="公开站队" selected={player.signalPacketId} disabled={phase !== "signal"} onSelect={(packetId) => chooseSignal(player.id, packetId)} />
                <ChoiceButtons label={phase === "signal" || playerTest ? "最终选择 · 尚未公开" : "秘密选择 · 测试视角"} selected={player.secretPacketId} hidden={phase === "signal" || Boolean(playerTest)} disabled={phase !== "commit" || Boolean(playerTest)} onSelect={(packetId) => chooseSecret(player.id, packetId)} />
                <div className="test-player-outcome">{phase === "settled" ? <><strong className={switched ? "is-switched" : "is-kept"}>{switched ? "反水" : "守约"}</strong><span>{payout ? `获得 ${formatEther(payout)} MON` : "未获胜"}</span></> : phase === "lobby" ? <label className="test-stake-select"><span>投入金额</span><select value={player.stakeUnits} onChange={(event) => changeStake(player.id, Number(event.target.value))}>{Array.from({ length: 10 }, (_, amount) => amount + 1).map((amount) => <option key={amount} value={amount}>{amount} MON</option>)}</select></label> : phase === "signal" ? <span>投入 {player.stakeUnits} MON</span> : <strong className={switched ? "is-switched" : "is-kept"}>{switched ? "将会反水" : "选择守约"}</strong>}</div>
              </div>;
            })}
          </div>
        </article>
      </section>
      {playerTest && <PlayerTestScreen state={playerTest} onCancel={resetRound} onConfirm={confirmPlayerChoice} onSelect={(selected) => setPlayerTest((current) => current ? { ...current, selected } : null)} onStakeChange={(stakeUnits) => setPlayerTest((current) => current ? { ...current, stakeUnits } : null)} player={players[0]} mockCount={players.length - 1} />}
    </main>
  );
}

function PlayerTestScreen({ state, onCancel, onConfirm, onSelect, onStakeChange, player, mockCount }: { state: PlayerTestState; onCancel: () => void; onConfirm: () => void; onSelect: (packetId: PacketId) => void; onStakeChange: (amount: number) => void; player: TestPlayer; mockCount: number }) {
  const isSecret = state.step === "secret";
  return <section className={isSecret ? "handoff-screen handoff-choice is-secret" : "handoff-screen handoff-choice"} role="dialog" aria-modal="true" aria-label={`你的${isSecret ? "秘密选择" : "公开站队"}`}><button className="handoff-close" onClick={onCancel} aria-label="退出玩家视角测试"><X size={18} /></button><div className="handoff-choice__heading"><p className="eyebrow">PLAYER POV · 你操作 1 人 · {mockCount} 人由 MOCK 驱动</p><h2>{isSecret ? "你真正想抢哪一个？" : "先选阵营，再选投入。"}</h2><span>{isSecret ? `可以守约，也可以反水。你的投入已锁定为 ${player.stakeUnits} MON；确认后 Mock 玩家会自动完成并立即结算。` : "少数派只按人数判定；获胜后，投入金额决定你分得败者资金的权重。"}</span></div><div className="handoff-packets">{PACKETS.map((packet) => <button aria-pressed={state.selected === packet.id} className={state.selected === packet.id ? "is-selected" : ""} key={packet.id} onClick={() => onSelect(packet.id)} style={{ "--packet-color": packet.color, "--packet-ink": packet.ink } as React.CSSProperties}><span>{packet.name}</span><strong>0{packet.id + 1}</strong><small>平票优先级 {packet.id + 1}</small>{state.selected === packet.id && <i><Check size={17} /></i>}</button>)}</div>{!isSecret && <div className="handoff-stakes"><span>选择投入金额</span><div>{Array.from({ length: 10 }, (_, index) => index + 1).map((amount) => <button type="button" className={state.stakeUnits === amount ? "is-selected" : ""} aria-pressed={state.stakeUnits === amount} key={amount} onClick={() => onStakeChange(amount)}><strong>{amount}</strong><small>MON</small></button>)}</div></div>}<button className="handoff-primary" disabled={state.selected === null} onClick={onConfirm}>{isSecret ? <LockKeyhole size={18} /> : <Eye size={18} />}{isSecret ? "锁定选择并查看结果" : `确认阵营并投入 ${state.stakeUnits} MON`}</button></section>;
}

function RehearsalScreen({ finalCounts, history, phase, players, publicCounts, round, settlement }: { finalCounts: number[]; history: readonly RoundRecord[]; phase: GamePhase; players: readonly TestPlayer[]; publicCounts: number[]; round: number; settlement: GameSnapshot["settlement"] | undefined }) {
  const truthCount = players.filter((player) => player.signalPacketId === player.secretPacketId).length;
  const lieCount = players.length - truthCount;
  const winningPacket = settlement?.winningPacketId === null || settlement?.winningPacketId === undefined ? null : PACKETS[settlement.winningPacketId];
  const pot = totalPot(players);

  return <section className={`rehearsal-screen phase-${phase}`} aria-label={`第 ${round} 轮现场大屏`}>
    <header className="rehearsal-screen__topline">
      <div><span>ROUND {String(round).padStart(2, "0")}</span><strong>{screenPhaseLabel(phase)}</strong></div>
      <div className="rehearsal-screen__metrics"><span><Users size={14} />{players.length} 名玩家</span><span><Coins size={14} />{formatEther(pot)} 模拟 MON</span></div>
    </header>

    <div className="rehearsal-screen__content">
      {phase === "lobby" ? <div className="screen-intro"><p>下一轮准备中</p><h2>每个人再次投入，<br /><em>重新选择一次阵营。</em></h2><span>点击“开始公开站队”，大屏将实时显示四个红包的选择人数。</span></div> : null}

      {phase === "signal" || phase === "commit" ? <div className="screen-public"><div className="screen-copy"><Eye size={24} /><p>{phase === "signal" ? "公开站队进行中" : "公开站队结果已冻结"}</p><h2>现在，全场都看得见。</h2><span>{phase === "signal" ? "调整下方选择，大屏人数会立即变化。" : "接下来进入秘密锁定，公开人数保持不变。"}</span></div><ScreenPacketCounts counts={publicCounts} /></div> : null}

      {phase === "reveal" ? <div className="screen-truth"><div className="screen-copy"><LockKeyhole size={24} /><p>秘密选择全部锁定</p><h2>有人守约，也有人悄悄离开。</h2><span>这里只公布汇总，不提前泄露任何人的最终红包。</span></div><div className="truth-score"><article><span>守约</span><strong>{truthCount}</strong><small>最终选择与公开站队一致</small></article><i>:</i><article className="is-lie"><span>反水</span><strong>{lieCount}</strong><small>最终选择与公开站队不同</small></article></div></div> : null}

      {phase === "settled" ? <div className="screen-settlement">{winningPacket ? <><div className="winner-packet" style={{ "--packet-color": winningPacket.color, "--packet-ink": winningPacket.ink } as React.CSSProperties}><Trophy size={24} /><span>本轮少数派</span><strong>{winningPacket.name}</strong><small>0{winningPacket.id + 1}</small></div><div className="winner-copy"><p>第 {round} 轮结算完成</p><h2>{settlement?.winners.length ?? 0} 名赢家，<br />按投入权重分配败者资金。</h2><span>败者资金 {formatEther(settlement?.losingPot ?? 0n)} MON，连同赢家本金共分配 {formatEther(pot)} MON。</span><ScreenPacketCounts compact counts={finalCounts} /></div></> : <div className="screen-copy"><Trophy size={24} /><p>本轮没有形成少数派</p><h2>所有投入原额退回。</h2><span>至少需要两个非空红包，才能产生少数派。</span></div>}</div> : null}
    </div>

    <footer className="rehearsal-screen__history"><span>轮次记录</span>{history.length === 0 ? <p>完成第一轮后，这里会保留每轮结果。</p> : <div>{history.map((record) => <i key={record.round}><b>R{String(record.round).padStart(2, "0")}</b><span>{record.winningPacketId === null ? "退款" : `${PACKETS[record.winningPacketId].name} · ${record.winnerCount} 人胜`}</span><small>{record.truthCount} 守约 / {record.lieCount} 反水</small></i>)}</div>}</footer>
  </section>;
}

function ScreenPacketCounts({ compact = false, counts }: { compact?: boolean; counts: number[] }) {
  return <div className={compact ? "screen-packet-counts is-compact" : "screen-packet-counts"}>{PACKETS.map((packet) => <article key={packet.id} style={{ "--packet-color": packet.color, "--packet-ink": packet.ink } as React.CSSProperties}><span>{packet.name}</span><strong>{counts[packet.id]}</strong><small>人</small></article>)}</div>;
}

function ChoiceButtons({ disabled, hidden = false, label, onSelect, selected }: { disabled: boolean; hidden?: boolean; label: string; onSelect: (packetId: PacketId) => void; selected: PacketId }) {
  return <fieldset className={hidden ? "test-choice is-hidden" : "test-choice"}><legend>{label}</legend><div>{PACKETS.map((packet) => <button aria-label={`${label}：${packet.name}`} aria-pressed={!hidden && selected === packet.id} disabled={disabled || hidden} key={packet.id} onClick={() => onSelect(packet.id)} style={{ "--packet-color": packet.color, "--packet-ink": packet.ink } as React.CSSProperties}>{hidden ? "?" : `0${packet.id + 1}`}</button>)}</div></fieldset>;
}

function createPlayers(count: number, round = 1, names: readonly string[] = TEST_NAMES): TestPlayer[] {
  const split = Math.ceil(count / 2);
  const offset = (round - 1) % PACKETS.length;
  return Array.from({ length: count }, (_, index) => {
    const signalPacketId = ((index < split ? 0 : 1) + offset) % PACKETS.length as PacketId;
    return {
      id: `P${String(index + 1).padStart(2, "0")}`,
      nickname: names[index] || TEST_NAMES[index],
      stakeUnits: (index + round - 1) % 10 + 1,
      signalPacketId,
      secretPacketId: index === count - 1 ? (offset + 2) % PACKETS.length as PacketId : signalPacketId,
      salt: `local-rehearsal-round-${round}-salt-${index + 1}`,
    };
  });
}

function createEngine(players: readonly TestPlayer[], round: number) {
  const engine = new MockGameEngine({ gameId: `LOCAL-TEST-R${round}`, packets: PACKETS.map((packet) => ({ id: packet.id, label: packet.name })) });
  for (const player of players) engine.join({ id: player.id, nickname: player.nickname.trim() || player.id }, BigInt(player.stakeUnits) * ONE_MON);
  return engine;
}

function totalPot(players: readonly TestPlayer[]) {
  return players.reduce((total, player) => total + BigInt(player.stakeUnits) * ONE_MON, 0n);
}

function packetCounts(packetIds: readonly PacketId[]) {
  return packetIds.reduce((counts, packetId) => {
    counts[packetId] += 1;
    return counts;
  }, [0, 0, 0, 0]);
}

function phaseActionLabel(phase: GamePhase, round: number) {
  if (phase === "lobby") return "开始公开站队";
  if (phase === "signal") return "进入秘密选择";
  if (phase === "commit") return "锁定全部选择";
  if (phase === "reveal") return "统一揭晓并结算";
  return `进入第 ${round + 1} 轮`;
}

function screenPhaseLabel(phase: GamePhase) {
  if (phase === "lobby") return "等待本轮开始";
  if (phase === "signal") return "公开站队";
  if (phase === "commit") return "秘密锁定";
  if (phase === "reveal") return "守约 / 反水统计";
  return "少数派结算";
}
