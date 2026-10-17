"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, ExternalLink, LoaderCircle, LockKeyhole, WalletCards } from "lucide-react";
import { formatEther, parseEther, type Address } from "viem";
import { CommitVault } from "@/lib/commit-vault";
import { createCommitment } from "@/lib/commitment";
import { PACKETS, type PacketId } from "@/lib/game-config";
import {
  CONTRACT_STORAGE_KEY,
  DEFAULT_LOBBY_BLOCKS,
  configuredContractAddress,
  connectInjectedWallet,
  createOnchainGateway,
  explorerTransactionUrl,
  humanizeWalletError,
  metaMaskMobileUrl,
  readWalletBalance,
  shortAddress,
} from "@/lib/injected-wallet";
import type { ChainGameSnapshot, ChainPlayer, TransactionProgress } from "@/lib/onchain-game-gateway";
import { monadTestnet } from "@/lib/chain";
import { persistChainRoundHistory } from "@/lib/persist-chain-history";
import { buildPlayerIntelProfiles, loadRoomPlayerHistory, type PlayerIntelRound } from "@/lib/player-intelligence";
import type { PlayerHistoryRecord } from "@/lib/player-history";
import { loadRoundSwitches, upsertRoundSwitch, type RoundSwitchSummary } from "@/lib/round-switch-history";
import { PlayerIntelligencePanel } from "@/components/player-intelligence-panel";
import { ChoiceTrail, PacketChoiceGrid, PacketDistribution, PlayerFlowRail, RoundLiveStatus, RoundSwitchHistory, StakeAmountPicker, type PlayerFlowStep } from "@/components/player-flow-ui";

const vault = new CommitVault();

export function ChainPlayerGame({ gameId: gameIdParam }: { gameId: string }) {
  const searchParams = useSearchParams();
  const gameId = useMemo(() => /^\d+$/.test(gameIdParam) && BigInt(gameIdParam) > 0n ? BigInt(gameIdParam) : null, [gameIdParam]);
  const [contractAddress, setContractAddress] = useState<Address | null>(() => configuredContractAddress());
  const [account, setAccount] = useState<Address | null>(null);
  const [snapshot, setSnapshot] = useState<ChainGameSnapshot | null>(null);
  const [signalPacket, setSignalPacket] = useState<PacketId | null>(null);
  const [finalPacket, setFinalPacket] = useState<PacketId | null>(null);
  const [stakeUnits, setStakeUnits] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("连接 MetaMask 后，凭房间号加入链上游戏。");
  const [tx, setTx] = useState<TransactionProgress | null>(null);
  const [mobileWalletUrl, setMobileWalletUrl] = useState("");
  const [claimableAmount, setClaimableAmount] = useState(0n);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [switchHistory, setSwitchHistory] = useState<readonly RoundSwitchSummary[]>([]);
  const [historyRecords, setHistoryRecords] = useState<readonly PlayerHistoryRecord[]>([]);
  const historyRoomId = useMemo(() => contractAddress && gameId !== null
    ? `MONAD-10143:${contractAddress.toLowerCase()}:${gameId.toString()}`
    : null, [contractAddress, gameId]);

  useEffect(() => {
    setMobileWalletUrl(metaMaskMobileUrl(window.location.href));
    const fromQuery = searchParams.get("contract");
    let fromStorage: string | null = null;
    try {
      fromStorage = window.localStorage?.getItem(CONTRACT_STORAGE_KEY) ?? null;
    } catch {
      // The fixed deployment address must still work when browser storage is unavailable.
    }
    setContractAddress(configuredContractAddress(fromQuery || fromStorage));
  }, [searchParams]);

  useEffect(() => {
    if (!historyRoomId) return;
    void Promise.all([
      loadRoundSwitches(historyRoomId, "onchain"),
      loadRoomPlayerHistory(historyRoomId, "onchain"),
    ]).then(([switches, records]) => {
      setSwitchHistory(switches);
      setHistoryRecords(records);
    }).catch(() => undefined);
  }, [historyRoomId]);

  const refresh = useCallback(async () => {
    if (!contractAddress || gameId === null) return;
    const gateway = await createOnchainGateway(contractAddress);
    const next = await gateway.readSnapshot(gameId);
    setSnapshot(next);
    void persistChainRoundHistory(contractAddress, gameId, next).then((saved) => {
      if (!saved) return;
      const roomId = `MONAD-10143:${contractAddress.toLowerCase()}:${gameId.toString()}`;
      return loadRoomPlayerHistory(roomId, "onchain").then(setHistoryRecords);
    }).catch(() => undefined);
    if (next.phase === "settled" || next.phase === "cancelled") {
      const revealed = next.players.filter((player) => player.revealed);
      const summary = {
        round: Number(next.game.roundNumber),
        switchedCount: revealed.filter((player) => player.hasSignaled && player.signalPacket !== player.revealedPacket).length,
        totalPlayers: next.players.length,
      };
      setSwitchHistory((current) => upsertRoundSwitch(current, summary));
    }
    if (account) {
      const [nextClaimable, nextBalance] = await Promise.all([
        gateway.readClaimable(gameId, account),
        readWalletBalance(account),
      ]);
      setClaimableAmount(nextClaimable);
      setWalletBalance(nextBalance);
      const own = next.players.find((player) => player.address.toLowerCase() === account.toLowerCase());
      if (own?.hasSignaled) setSignalPacket(own.signalPacket as PacketId);
      else setSignalPacket(null);
      const stored = vault.load(gameId, next.game.roundNumber, account);
      if (stored) setFinalPacket(stored.packetId);
      else setFinalPacket(null);
    }
  }, [account, contractAddress, gameId]);

  useEffect(() => {
    if (!contractAddress || gameId === null) return;
    void refresh().catch((error) => setMessage(humanizeWalletError(error)));
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 1_000);
    return () => window.clearInterval(timer);
  }, [contractAddress, gameId, refresh]);

  const ownAction = useMemo(() => snapshot?.players.find((player) => account && player.address.toLowerCase() === account.toLowerCase()) ?? null, [account, snapshot]);
  const currentIntelRounds = useMemo(() => snapshot && (snapshot.phase === "settled" || snapshot.phase === "cancelled")
    ? chainIntelRounds(snapshot)
    : {}, [snapshot]);
  const playerProfiles = useMemo(() => buildPlayerIntelProfiles(
    historyRecords,
    (snapshot?.players ?? []).map((player, index) => ({
      id: player.address.toLowerCase(),
      displayName: shortAddress(player.address),
      isSelf: Boolean(account && player.address.toLowerCase() === account.toLowerCase()),
      fallbackPreferencePacketId: player.revealed
        ? player.revealedPacket as PacketId
        : player.hasSignaled
          ? player.signalPacket as PacketId
          : index % 4 as PacketId,
    })),
    currentIntelRounds,
  ), [account, currentIntelRounds, historyRecords, snapshot?.players]);
  const settledRoundProfit = snapshot && ownAction && (snapshot.phase === "settled" || snapshot.phase === "cancelled")
    ? ownAction.payout - ownAction.stakeAmount
    : null;
  const lobbyExpired = snapshot?.phase === "lobby" && snapshot.blockNumber >= snapshot.game.joinEndBlock;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setTx(null);
    try {
      await action();
    } catch (error) {
      setMessage(humanizeWalletError(error));
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    await run(async () => {
      const next = await connectInjectedWallet();
      setAccount(next);
      setWalletBalance(await readWalletBalance(next));
      setMessage(`已连接 ${shortAddress(next)}。每笔操作都需要 MetaMask 确认并自付 Gas。`);
    });
  }

  async function transact(action: (gateway: Awaited<ReturnType<typeof createOnchainGateway>>) => Promise<unknown>, success: string) {
    if (!account || !contractAddress || gameId === null) return;
    await run(async () => {
      const gateway = await createOnchainGateway(contractAddress, account);
      await action(gateway);
      setMessage(success);
      await refresh();
    });
  }

  async function join() {
    if (!snapshot || gameId === null || signalPacket === null) return;
    const stakeAmount = parseEther(String(stakeUnits));
    await transact((gateway) => gateway.join(gameId, stakeAmount, setTx), `已投入 ${stakeUnits} MON；${PACKETS[signalPacket].name}已预选，公开阶段确认后上链。`);
  }

  async function signal() {
    if (signalPacket === null || gameId === null) return;
    await transact((gateway) => gateway.signal(gameId, signalPacket, setTx), "公开选择已上链；在阶段结束前仍可更新。 ");
  }

  async function commit() {
    if (!account || !contractAddress || finalPacket === null || gameId === null) return;
    const pending = vault.create(finalPacket);
    if (!snapshot) return;
    const commitment = createCommitment({ chainId: BigInt(monadTestnet.id), contractAddress, gameId, roundNumber: snapshot.game.roundNumber, player: account, packetId: finalPacket, salt: pending.salt });
    await transact(async (gateway) => {
      await gateway.commit(gameId, commitment, setTx);
      vault.save(gameId, snapshot.game.roundNumber, account, { ...pending, commitment });
    }, "最终选择的 commitment 已上链；Salt 只保存在此浏览器。 ");
  }

  async function reveal() {
    if (!account || gameId === null) return;
    if (!snapshot) return;
    const stored = vault.load(gameId, snapshot.game.roundNumber, account);
    if (!stored) {
      setMessage("本机没有这局的 Salt，无法 Reveal。请使用提交 commitment 时的浏览器与账户。");
      return;
    }
    await transact((gateway) => gateway.reveal(gameId, stored.packetId, stored.salt, setTx), "最终选择已公开并验证通过。 ");
  }

  async function claim() {
    if (!account || gameId === null) return;
    await transact((gateway) => gateway.claim(gameId, account, setTx), "奖金已领取到当前账户。 ");
  }

  async function openNextRound() {
    if (gameId === null) return;
    await transact((gateway) => gateway.openNextRound(gameId, DEFAULT_LOBBY_BLOCKS, setTx), "下一轮已经开放，请重新选择投入并加入。 ");
  }

  async function settle() {
    if (gameId === null) return;
    await transact((gateway) => gateway.settle(gameId, setTx), "本轮已经结算，所有玩家都能查看结果。 ");
  }

  async function expire() {
    if (gameId === null) return;
    await transact((gateway) => gateway.expire(gameId, setTx), "房间人数不足，押金已进入可领取退款。 ");
  }

  if (gameId === null) return <PlayerError message="房间号无效，请重新输入。" />;
  if (!contractAddress) return <PlayerError message="当前环境还没有配置统一协议地址。请先从房间二维码进入，或配置 NEXT_PUBLIC_CONTRACT_ADDRESS。" />;

  const liveStatus = snapshot ? chainLiveStatus(snapshot, ownAction) : null;

  return (
    <main className="player-shell chain-player">
      <header className="player-header"><Link href="/" aria-label="返回首页"><ArrowLeft size={19} /></Link><span className="mode-tag chain-mode-tag">MetaMask 开发模式</span><p>#{gameId.toString()}{snapshot ? ` · R${snapshot.game.roundNumber.toString().padStart(2, "0")}` : ""}</p></header>
      <section className="chain-player-status">
        <span>{snapshot ? phaseLabel(snapshot.phase) : "读取链上状态"}</span>
        <p>{message}</p>
        {tx?.hash && <a href={explorerTransactionUrl(tx.hash)} target="_blank" rel="noreferrer">{txLabel(tx)} <ExternalLink size={12} /></a>}
      </section>
      {snapshot && <PlayerIntelligencePanel
        profiles={playerProfiles}
        balanceLabel={account ? walletBalance ? `${walletBalance} MON` : "读取中…" : "连接钱包后显示"}
        roundProfitLabel={settledRoundProfit === null ? ownAction?.joined ? "待结算" : "—" : `${settledRoundProfit > 0n ? "+" : ""}${formatEther(settledRoundProfit)} MON`}
        roundProfitTone={settledRoundProfit === null ? "neutral" : settledRoundProfit > 0n ? "positive" : settledRoundProfit < 0n ? "negative" : "neutral"}
      />}
      {snapshot && liveStatus && <RoundLiveStatus roundNumber={snapshot.game.roundNumber} counts={liveStatus.counts} mode={liveStatus.mode} switchedCount={liveStatus.switchedCount} revealedCount={liveStatus.revealedCount} totalPlayers={snapshot.game.playerCount} />}
      {snapshot && <RoundSwitchHistory items={switchHistory} currentRound={snapshot.game.roundNumber} />}
      <PlayerFlowRail current={playerFlowStep(snapshot, ownAction, Boolean(account))} />
      {account && claimableAmount > 0n && snapshot && snapshot.phase !== "settled" && snapshot.phase !== "cancelled" && <aside className="carryover-prize"><p><span>往轮待领取</span><strong>{formatEther(claimableAmount)} MON</strong></p><button onClick={claim} disabled={busy}>{busy ? "领取中…" : "领取"}</button></aside>}

      {!account ? <ConnectPanel busy={busy} gameId={gameId} mobileWalletUrl={mobileWalletUrl} onConnect={connect} snapshot={snapshot} /> : !snapshot ? <LoadingPanel /> : !ownAction?.joined ? (
        <section className="player-panel picker-panel public-decision-panel"><p className="eyebrow">第 {snapshot.game.roundNumber.toString()} 轮 · 公开站队与投入</p><h1>先站队，再决定本轮筹码</h1><p className="mobile-lead">两项一起确认。金额现在进入本轮资金池；为避免后加入者提前看到，站队将在公开阶段再确认上链。</p><PacketChoiceGrid selected={signalPacket} onSelect={setSignalPacket} disabled={busy} /><div className="public-stake-block"><div className="join-stake-heading"><span>本轮投入金额</span><strong>{stakeUnits} MON</strong></div><StakeAmountPicker value={stakeUnits} onChange={setStakeUnits} disabled={busy} /></div><button className="mobile-primary" disabled={busy || signalPacket === null || snapshot.phase !== "lobby" || lobbyExpired} onClick={join}>{busy ? "交易处理中…" : snapshot.phase !== "lobby" || lobbyExpired ? "加入阶段已结束" : signalPacket === null ? "先选择公开阵营" : `确认${PACKETS[signalPacket].name}并投入 ${stakeUnits} MON`}</button><WalletDisclosure /></section>
      ) : snapshot.phase === "signal" ? (
        <ChainPacketPicker title="确认公开站队" description="站队和投入在同一屏核对；本轮金额已经锁定，公开选择在阶段结束前仍可更新。" selected={signalPacket} onSelect={setSignalPacket} onContinue={signal} button={ownAction.hasSignaled ? "更新公开选择" : "确认并公开上链"} busy={busy} lockedStake={formatEther(ownAction.stakeAmount)} />
      ) : snapshot.phase === "commit" ? (
        !ownAction.hasSignaled ? <WaitingPanel title="你错过了公开站队" description="合约要求先 Signal 才能 Commit；本轮将按弃权处理，请等待结算。" /> : ownAction.commitment !== `0x${"0".repeat(64)}` ? <WaitingPanel title="最终选择已锁定" description="链上只有 commitment。请保留此浏览器中的 Salt，等待 Reveal 阶段。" /> : <ChainPacketPicker title="秘密选择" description="可以守约，也可以反水。只提交哈希，红包编号和 Salt 不会上链。" selected={finalPacket} onSelect={setFinalPacket} onContinue={commit} button="秘密锁定选择" busy={busy} secret />
      ) : snapshot.phase === "reveal" ? (
        ownAction.revealed ? <RevealCard player={ownAction} /> : ownAction.commitment === `0x${"0".repeat(64)}` ? <WaitingPanel title="你没有提交秘密选择" description="本轮无法 Reveal，将按弃权处理；不会阻塞其他玩家结算。" /> : <WaitingPanel title="现在公开最终选择" description="使用本机保存的红包编号与 Salt 验证 commitment。" action="Reveal 最终选择" onAction={reveal} busy={busy} />
      ) : snapshot.phase === "settled" || snapshot.phase === "cancelled" ? (
        <Settlement snapshot={snapshot} ownAction={ownAction} claimableAmount={claimableAmount} busy={busy} onClaim={claim} onNextRound={openNextRound} />
      ) : snapshot.phase === "awaiting-settlement" ? (
        <WaitingPanel title="揭晓结束，任何人都能结算" description="结算交易只执行公开规则，不会给发起者额外权限。" action="结算本轮" onAction={settle} busy={busy} />
      ) : snapshot.phase === "lobby" && lobbyExpired ? (
        <WaitingPanel title="人数不足，任何人都能关闭房间" description="关闭后，每位已加入玩家都能原额取回押金。" action="关闭并开放退款" onAction={expire} busy={busy} />
      ) : <WaitingPanel title="已加入，等待房间自动开始" description="满 8 人会提前开始；否则报名截止后，4 人以上自动进入公开站队。" />}
    </main>
  );
}

function ConnectPanel({ busy, gameId, mobileWalletUrl, onConnect, snapshot }: { busy: boolean; gameId: bigint; mobileWalletUrl: string; onConnect: () => void; snapshot: ChainGameSnapshot | null }) {
  return <section className="player-panel join-panel"><div className="tiny-packets" aria-hidden="true">{PACKETS.map((packet) => <i key={packet.id} style={{ background: packet.color }} />)}</div><p className="eyebrow">第 1 步 · 钱包登录 · 房间 #{gameId.toString()}</p><h1>{snapshot ? "确认房间并登录" : "正在核对链上房间"}</h1>{snapshot ? <><p className="mobile-lead">钱包地址就是玩家身份；登录后在同一屏选择公开阵营和 1～10 MON 投入。</p><div className="result-ticket"><span>投入范围</span><strong>1～10 MON</strong><span>已加入</span><strong>{snapshot.game.playerCount} / 8 人</strong><span>当前阶段</span><strong>{phaseLabel(snapshot.phase)}</strong></div></> : <p className="mobile-lead">先读取房间和参与人数，确认后再请求钱包权限。</p>}<button className="mobile-primary wallet-connect" onClick={onConnect} disabled={busy || !snapshot}>{busy ? <LoaderCircle className="spin" size={18} /> : <WalletCards size={18} />}{busy ? "登录中…" : snapshot ? "使用 MetaMask 登录" : "等待房间数据"}</button>{mobileWalletUrl && <a className="mobile-wallet-link" href={mobileWalletUrl}><ExternalLink size={15} />在 MetaMask 手机 App 中打开</a>}<WalletDisclosure /></section>;
}

function ChainPacketPicker({ title, description, selected, onSelect, onContinue, button, busy, secret = false, lockedStake }: { title: string; description: string; selected: PacketId | null; onSelect: (id: PacketId) => void; onContinue: () => void; button: string; busy: boolean; secret?: boolean; lockedStake?: string }) {
  return <section className="player-panel picker-panel"><p className="eyebrow">{secret ? "仅你可见" : "全场可见"}</p><h1>{title}</h1><p className="mobile-lead">{description}</p><PacketChoiceGrid selected={selected} onSelect={onSelect} disabled={busy} />{lockedStake !== undefined && <div className="locked-stake-summary"><span>本轮投入已锁定</span><strong>{lockedStake} MON</strong></div>}{secret && <p className="secret-note"><LockKeyhole size={15} /> Salt 仅保存在当前浏览器；清除数据或换设备会导致无法 Reveal。</p>}<button className="mobile-primary" disabled={selected === null || busy} onClick={onContinue}>{busy ? "等待链上确认…" : button}</button></section>;
}

function WaitingPanel({ title, description, action, onAction, busy }: { title: string; description: string; action?: string; onAction?: () => void; busy?: boolean }) {
  return <section className="player-panel locked-panel"><div className="lock-medallion"><LockKeyhole size={29} /></div><p className="eyebrow">链上状态同步中</p><h1>{title}</h1><p className="mobile-lead">{description}</p>{action && <button className="mobile-primary" onClick={onAction} disabled={busy}>{busy ? "等待链上确认…" : action}</button>}</section>;
}

function RevealCard({ player }: { player: ChainPlayer }) {
  const packet = PACKETS[player.revealedPacket as PacketId];
  return <section className="player-panel reveal-inline" style={{ "--packet-color": packet.color, "--packet-ink": packet.ink } as React.CSSProperties}><p>最终选择已公开</p><h1>{packet.name}</h1><strong>0{packet.id + 1}</strong><span>举起手机，让全场看到你的颜色</span></section>;
}

function Settlement({ snapshot, ownAction, claimableAmount, busy, onClaim, onNextRound }: { snapshot: ChainGameSnapshot; ownAction: ChainPlayer; claimableAmount: bigint; busy: boolean; onClaim: () => void; onNextRound: () => void }) {
  const hasPayout = claimableAmount > 0n;
  const isRefund = snapshot.phase === "cancelled" || snapshot.game.winnerPacket >= PACKETS.length;
  const won = !isRefund && ownAction.revealed && ownAction.revealedPacket === snapshot.game.winnerPacket;
  const winnerPacketId = isRefund ? null : snapshot.game.winnerPacket as PacketId;
  const winnerPacket = winnerPacketId === null ? null : PACKETS[winnerPacketId];
  const publicPacketId = ownAction.hasSignaled ? ownAction.signalPacket as PacketId : null;
  const secretPacketId = ownAction.revealed ? ownAction.revealedPacket as PacketId : null;
  const net = ownAction.payout - ownAction.stakeAmount;
  const netLabel = `${net > 0n ? "+" : ""}${formatEther(net)} MON`;
  const title = snapshot.phase === "cancelled" ? "本局已取消，投入可原额取回" : isRefund ? "没有形成少数派，投入可原额取回" : won ? "你站进了真正的少数派" : "你看见了少数派，但不在其中";
  const heroStyle = winnerPacket ? { "--result-color": winnerPacket.color, "--result-ink": winnerPacket.ink } as React.CSSProperties : undefined;

  return (
    <section className="player-panel settlement-panel">
      <div className={`settlement-hero${won ? " is-won" : isRefund ? " is-refund" : " is-lost"}`} style={heroStyle}>
        <div className="settlement-hero__label"><span>ROUND RESULT</span><strong>{winnerPacket ? `${winnerPacket.name} · 少数派` : "本轮退款"}</strong></div>
        <h1>{title}</h1>
        <div className="settlement-hero__numbers">
          <p><span>{isRefund ? "可退回" : "累计可领取"}</span><strong>{formatEther(claimableAmount)}<small> MON</small></strong></p>
          <p><span>本轮净结果</span><strong>{netLabel}</strong></p>
          <p><span>你的投入</span><strong>{formatEther(ownAction.stakeAmount)} MON</strong></p>
        </div>
      </div>

      {hasPayout ? <button className="mobile-primary result-claim" onClick={onClaim} disabled={busy}>{busy ? "领取中…" : isRefund ? "取回全部待领取资金" : "领取到当前钱包"}</button> : <p className="claim-state"><Check size={15} />本轮没有待领取资金</p>}
      <button className="next-round-action" onClick={onNextRound} disabled={busy}>{busy ? "等待链上确认…" : `开启第 ${Number(snapshot.game.roundNumber) + 1} 轮`}</button>
      <p className="next-round-note">房间号保持不变；所有玩家下一轮重新选择投入和阵营。</p>

      <ChoiceTrail publicPacketId={publicPacketId} secretPacketId={secretPacketId} />
      <PacketDistribution counts={snapshot.revealedCounts} winnerPacketId={winnerPacketId} />

      <div className="result-section-title public-result-title">
        <div><span>公开账本</span><h2>每个人的真实提交</h2></div>
        <p>公开战队 → 秘密战队</p>
      </div>
      <div className="public-results">
        {snapshot.players.map((player) => {
          const playerWon = winnerPacketId !== null && player.revealed && player.revealedPacket === winnerPacketId;
          return <div className={player.address === ownAction.address ? "is-self" : ""} key={player.address}>
            <p><code>{shortAddress(player.address)}</code><small>{formatEther(player.stakeAmount)} MON</small></p>
            <span>{player.hasSignaled ? PACKETS[player.signalPacket as PacketId].name : "未站队"} → {player.revealed ? PACKETS[player.revealedPacket as PacketId].name : "未揭晓"}</span>
            <em>{playerWon || isRefund ? `${formatEther(player.payout)} MON` : "—"}</em>
            <strong className={`result-behavior is-${behavior(player)}`}>{behaviorLabel(player)}</strong>
          </div>;
        })}
      </div>
    </section>
  );
}

function chainIntelRounds(snapshot: ChainGameSnapshot): Record<string, PlayerIntelRound> {
  const isRefund = snapshot.phase === "cancelled" || snapshot.game.winnerPacket >= PACKETS.length;
  return Object.fromEntries(snapshot.players.map((player) => {
    const won = !isRefund && player.revealed && player.revealedPacket === snapshot.game.winnerPacket;
    return [player.address.toLowerCase(), {
      round: Number(snapshot.game.roundNumber),
      publicPacketId: player.hasSignaled ? player.signalPacket as PacketId : null,
      secretPacketId: player.revealed ? player.revealedPacket as PacketId : null,
      stakeWei: player.stakeAmount,
      payoutWei: player.payout,
      outcome: isRefund ? "refunded" : won ? "won" : "lost",
    } satisfies PlayerIntelRound];
  }));
}

function behavior(player: ChainPlayer) {
  if (!player.revealed) return "abstained";
  return player.hasSignaled && player.signalPacket === player.revealedPacket ? "kept" : "switched";
}
function behaviorLabel(player: ChainPlayer) {
  const value = behavior(player);
  return value === "abstained" ? "弃权" : value === "kept" ? "守约" : "反水";
}
function WalletDisclosure() { return <div className="privacy-note wallet-warning"><WalletCards size={16} /> MetaMask 开发模式：需要钱包、签名弹窗和 Gas</div>; }
function LoadingPanel() { return <section className="player-panel loading-panel"><LoaderCircle className="spin" size={30} /><p>正在读取游戏状态…</p></section>; }
function PlayerError({ message }: { message: string }) { return <main className="player-shell"><section className="player-panel"><p className="eyebrow">无法进入游戏</p><h1>链接不完整</h1><p className="mobile-lead">{message}</p><Link className="mobile-text" href="/">返回首页</Link></section></main>; }
function playerFlowStep(snapshot: ChainGameSnapshot | null, ownAction: ChainPlayer | null, connected: boolean): PlayerFlowStep {
  if (!snapshot || !connected) return "join";
  if (!ownAction?.joined || snapshot.phase === "lobby" || snapshot.phase === "signal") return "signal";
  if (snapshot.phase === "commit") return "commit";
  if (snapshot.phase === "reveal" || snapshot.phase === "awaiting-settlement") return "reveal";
  return "result";
}
function chainLiveStatus(snapshot: ChainGameSnapshot, ownAction: ChainPlayer | null) {
  const truthVisible = snapshot.phase === "reveal" || snapshot.phase === "awaiting-settlement" || snapshot.phase === "settled";
  if (truthVisible) {
    const revealedPlayers = snapshot.players.filter((player) => player.revealed);
    return {
      counts: snapshot.revealedCounts,
      mode: "secret" as const,
      switchedCount: revealedPlayers.filter((player) => player.hasSignaled && player.signalPacket !== player.revealedPacket).length,
      revealedCount: revealedPlayers.length,
    };
  }
  const counts = [0, 0, 0, 0];
  for (const player of snapshot.players) if (player.hasSignaled) counts[player.signalPacket] += 1;
  return { counts, mode: ownAction?.hasSignaled && (snapshot.phase === "signal" || snapshot.phase === "commit") ? "public" as const : "waiting" as const };
}
function phaseLabel(phase: ChainGameSnapshot["phase"]) { return ({ lobby: "等待加入", signal: "公开站队", commit: "秘密锁定", reveal: "同时揭晓", "awaiting-settlement": "等待结算", settled: "结算完成", cancelled: "游戏取消" } as const)[phase]; }
function txLabel(tx: TransactionProgress) { return tx.state === "submitted" ? "交易已提交" : tx.state === "included" ? "已进入区块" : tx.state === "finalized" ? "已最终确认" : "等待 MetaMask"; }
