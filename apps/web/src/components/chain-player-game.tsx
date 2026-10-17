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
  configuredContractAddress,
  connectInjectedWallet,
  createOnchainGateway,
  explorerTransactionUrl,
  humanizeWalletError,
  metaMaskMobileUrl,
  shortAddress,
} from "@/lib/injected-wallet";
import type { ChainGameSnapshot, ChainPlayer, TransactionProgress } from "@/lib/onchain-game-gateway";
import { monadTestnet } from "@/lib/chain";
import { persistChainRoundHistory } from "@/lib/persist-chain-history";

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

  const refresh = useCallback(async () => {
    if (!contractAddress || gameId === null) return;
    const gateway = await createOnchainGateway(contractAddress);
    const next = await gateway.readSnapshot(gameId);
    setSnapshot(next);
    void persistChainRoundHistory(contractAddress, gameId, next).catch(() => undefined);
    if (account) {
      const own = next.players.find((player) => player.address.toLowerCase() === account.toLowerCase());
      if (own?.hasSignaled) setSignalPacket(own.signalPacket as PacketId);
      const stored = vault.load(gameId, account);
      if (stored) setFinalPacket(stored.packetId);
    }
  }, [account, contractAddress, gameId]);

  useEffect(() => {
    if (!contractAddress || gameId === null) return;
    void refresh().catch((error) => setMessage(humanizeWalletError(error)));
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 1_000);
    return () => window.clearInterval(timer);
  }, [contractAddress, gameId, refresh]);

  const ownAction = useMemo(() => snapshot?.players.find((player) => account && player.address.toLowerCase() === account.toLowerCase()) ?? null, [account, snapshot]);
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
    if (!snapshot || gameId === null) return;
    const stakeAmount = parseEther(String(stakeUnits));
    await transact((gateway) => gateway.join(gameId, stakeAmount, setTx), `已投入 ${stakeUnits} MON 并加入房间。`);
  }

  async function signal() {
    if (signalPacket === null || gameId === null) return;
    await transact((gateway) => gateway.signal(gameId, signalPacket, setTx), "公开选择已上链；在阶段结束前仍可更新。 ");
  }

  async function commit() {
    if (!account || !contractAddress || finalPacket === null || gameId === null) return;
    const pending = vault.create(finalPacket);
    const commitment = createCommitment({ chainId: BigInt(monadTestnet.id), contractAddress, gameId, player: account, packetId: finalPacket, salt: pending.salt });
    await transact(async (gateway) => {
      await gateway.commit(gameId, commitment, setTx);
      vault.save(gameId, account, { ...pending, commitment });
    }, "最终选择的 commitment 已上链；Salt 只保存在此浏览器。 ");
  }

  async function reveal() {
    if (!account || gameId === null) return;
    const stored = vault.load(gameId, account);
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

  return (
    <main className="player-shell chain-player">
      <header className="player-header"><Link href="/" aria-label="返回首页"><ArrowLeft size={19} /></Link><span className="mode-tag chain-mode-tag">MetaMask 开发模式</span><p>#{gameId.toString()}</p></header>
      <section className="chain-player-status">
        <span>{snapshot ? phaseLabel(snapshot.phase) : "读取链上状态"}</span>
        <p>{message}</p>
        {tx?.hash && <a href={explorerTransactionUrl(tx.hash)} target="_blank" rel="noreferrer">{txLabel(tx)} <ExternalLink size={12} /></a>}
      </section>

      {!account ? <ConnectPanel busy={busy} gameId={gameId} mobileWalletUrl={mobileWalletUrl} onConnect={connect} snapshot={snapshot} /> : !snapshot ? <LoadingPanel /> : !ownAction?.joined ? (
        <section className="player-panel join-panel"><p className="eyebrow">链上房间 #{gameId.toString()}</p><h1>选择本轮投入</h1><p className="mobile-lead">选择 <strong>1～10 MON</strong>。少数派按人数产生；如果你获胜，投入越多，分得败者资金的权重越高。</p><StakePicker value={stakeUnits} onChange={setStakeUnits} disabled={busy} /><button className="mobile-primary" disabled={busy || snapshot.phase !== "lobby" || lobbyExpired} onClick={join}>{busy ? "交易处理中…" : snapshot.phase !== "lobby" || lobbyExpired ? "加入阶段已结束" : `投入 ${stakeUnits} MON 并加入`}</button><WalletDisclosure /></section>
      ) : snapshot.phase === "signal" ? (
        <ChainPacketPicker title="公开站队" description="这里的选择所有人可见，阶段结束前可以更新。编号越高，人数平票时优先级越高。" selected={signalPacket} onSelect={setSignalPacket} onContinue={signal} button={ownAction.hasSignaled ? "更新公开选择" : "公开我的选择"} busy={busy} />
      ) : snapshot.phase === "commit" ? (
        !ownAction.hasSignaled ? <WaitingPanel title="你错过了公开站队" description="合约要求先 Signal 才能 Commit；本轮将按弃权处理，请等待结算。" /> : ownAction.commitment !== `0x${"0".repeat(64)}` ? <WaitingPanel title="最终选择已锁定" description="链上只有 commitment。请保留此浏览器中的 Salt，等待 Reveal 阶段。" /> : <ChainPacketPicker title="秘密选择" description="可以守约，也可以反水。只提交哈希，红包编号和 Salt 不会上链。" selected={finalPacket} onSelect={setFinalPacket} onContinue={commit} button="秘密锁定选择" busy={busy} secret />
      ) : snapshot.phase === "reveal" ? (
        ownAction.revealed ? <RevealCard player={ownAction} /> : ownAction.commitment === `0x${"0".repeat(64)}` ? <WaitingPanel title="你没有提交秘密选择" description="本轮无法 Reveal，将按弃权处理；不会阻塞其他玩家结算。" /> : <WaitingPanel title="现在公开最终选择" description="使用本机保存的红包编号与 Salt 验证 commitment。" action="Reveal 最终选择" onAction={reveal} busy={busy} />
      ) : snapshot.phase === "settled" || snapshot.phase === "cancelled" ? (
        <Settlement snapshot={snapshot} ownAction={ownAction} busy={busy} onClaim={claim} />
      ) : snapshot.phase === "awaiting-settlement" ? (
        <WaitingPanel title="揭晓结束，任何人都能结算" description="结算交易只执行公开规则，不会给发起者额外权限。" action="结算本轮" onAction={settle} busy={busy} />
      ) : snapshot.phase === "lobby" && lobbyExpired ? (
        <WaitingPanel title="人数不足，任何人都能关闭房间" description="关闭后，每位已加入玩家都能原额取回押金。" action="关闭并开放退款" onAction={expire} busy={busy} />
      ) : <WaitingPanel title="已加入，等待房间自动开始" description="满 8 人会提前开始；否则报名截止后，4 人以上自动进入公开站队。" />}
    </main>
  );
}

function ConnectPanel({ busy, gameId, mobileWalletUrl, onConnect, snapshot }: { busy: boolean; gameId: bigint; mobileWalletUrl: string; onConnect: () => void; snapshot: ChainGameSnapshot | null }) {
  return <section className="player-panel join-panel"><div className="tiny-packets" aria-hidden="true">{PACKETS.map((packet) => <i key={packet.id} style={{ background: packet.color }} />)}</div><p className="eyebrow">第 1 步 · 钱包登录 · 房间 #{gameId.toString()}</p><h1>{snapshot ? "确认房间并登录" : "正在核对链上房间"}</h1>{snapshot ? <><p className="mobile-lead">钱包地址就是本局的玩家身份；登录后选择 1～10 MON 的投入，再选择阵营。</p><div className="result-ticket"><span>投入范围</span><strong>1～10 MON</strong><span>已加入</span><strong>{snapshot.game.playerCount} / 8 人</strong><span>当前阶段</span><strong>{phaseLabel(snapshot.phase)}</strong></div></> : <p className="mobile-lead">先读取房间和参与人数，确认后再请求钱包权限。</p>}<button className="mobile-primary wallet-connect" onClick={onConnect} disabled={busy || !snapshot}>{busy ? <LoaderCircle className="spin" size={18} /> : <WalletCards size={18} />}{busy ? "登录中…" : snapshot ? "使用 MetaMask 登录" : "等待房间数据"}</button>{mobileWalletUrl && <a className="mobile-wallet-link" href={mobileWalletUrl}><ExternalLink size={15} />在 MetaMask 手机 App 中打开</a>}<WalletDisclosure /></section>;
}

function StakePicker({ value, onChange, disabled }: { value: number; onChange: (value: number) => void; disabled?: boolean }) {
  return <div className="stake-picker" role="group" aria-label="选择投入金额">{Array.from({ length: 10 }, (_, index) => index + 1).map((amount) => <button type="button" key={amount} className={value === amount ? "is-selected" : ""} aria-pressed={value === amount} disabled={disabled} onClick={() => onChange(amount)}><strong>{amount}</strong><span>MON</span></button>)}</div>;
}

function ChainPacketPicker({ title, description, selected, onSelect, onContinue, button, busy, secret = false }: { title: string; description: string; selected: PacketId | null; onSelect: (id: PacketId) => void; onContinue: () => void; button: string; busy: boolean; secret?: boolean }) {
  return <section className="player-panel picker-panel"><p className="eyebrow">{secret ? "仅你可见" : "全场可见"}</p><h1>{title}</h1><p className="mobile-lead">{description}</p><div className="mobile-packets">{PACKETS.map((packet) => <button key={packet.id} onClick={() => onSelect(packet.id)} className={selected === packet.id ? "mobile-packet is-selected" : "mobile-packet"} style={{ "--packet-color": packet.color, "--packet-ink": packet.ink } as React.CSSProperties} aria-pressed={selected === packet.id}><span>{packet.name}</span><strong>0{packet.id + 1}</strong><small>平票优先级 {packet.id + 1}</small>{selected === packet.id && <i><Check size={14} /></i>}</button>)}</div>{secret && <p className="secret-note"><LockKeyhole size={15} /> Salt 仅保存在当前浏览器；清除数据或换设备会导致无法 Reveal。</p>}<button className="mobile-primary" disabled={selected === null || busy} onClick={onContinue}>{busy ? "等待链上确认…" : button}</button></section>;
}

function WaitingPanel({ title, description, action, onAction, busy }: { title: string; description: string; action?: string; onAction?: () => void; busy?: boolean }) {
  return <section className="player-panel locked-panel"><div className="lock-medallion"><LockKeyhole size={29} /></div><p className="eyebrow">链上状态同步中</p><h1>{title}</h1><p className="mobile-lead">{description}</p>{action && <button className="mobile-primary" onClick={onAction} disabled={busy}>{busy ? "等待链上确认…" : action}</button>}</section>;
}

function RevealCard({ player }: { player: ChainPlayer }) {
  const packet = PACKETS[player.revealedPacket as PacketId];
  return <section className="player-panel reveal-inline" style={{ "--packet-color": packet.color, "--packet-ink": packet.ink } as React.CSSProperties}><p>最终选择已公开</p><h1>{packet.name}</h1><strong>0{packet.id + 1}</strong><span>举起手机，让全场看到你的颜色</span></section>;
}

function Settlement({ snapshot, ownAction, busy, onClaim }: { snapshot: ChainGameSnapshot; ownAction: ChainPlayer; busy: boolean; onClaim: () => void }) {
  const hasPayout = ownAction.payout > 0n;
  const isRefund = snapshot.phase === "cancelled" || snapshot.game.winnerPacket >= PACKETS.length;
  const won = !isRefund && ownAction.revealed && ownAction.revealedPacket === snapshot.game.winnerPacket;
  const title = snapshot.phase === "cancelled" ? "本局已取消，可取回 stake" : isRefund ? "没有形成少数派，可取回 stake" : won ? "你进入了少数派" : "这次没有获胜";
  return <section className="player-panel settlement-panel"><p className="eyebrow">结算完成</p><h1>{title}</h1><div className="result-ticket"><span>总资金池</span><strong>{formatEther(snapshot.game.pot)} MON</strong><span>{isRefund ? "你的退款" : "你的可领取金额"}</span><strong>{formatEther(ownAction.payout)} MON</strong><span>你的投入</span><strong>{formatEther(ownAction.stakeAmount)} MON</strong></div>{hasPayout && !ownAction.claimed && <button className="mobile-primary" onClick={onClaim} disabled={busy}>{busy ? "领取中…" : isRefund ? "取回投入" : "领取到当前钱包"}</button>}<h2 className="public-result-title">全员公开结果</h2><div className="public-results">{snapshot.players.map((player) => <div key={player.address}><code>{shortAddress(player.address)} · {formatEther(player.stakeAmount)} MON</code><span>{player.hasSignaled ? PACKETS[player.signalPacket as PacketId].name : "未站队"} → {player.revealed ? PACKETS[player.revealedPacket as PacketId].name : "未揭晓"}</span><strong className={`result-behavior is-${behavior(player)}`}>{behaviorLabel(player)}</strong></div>)}</div></section>;
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
function phaseLabel(phase: ChainGameSnapshot["phase"]) { return ({ lobby: "等待加入", signal: "公开站队", commit: "秘密锁定", reveal: "同时揭晓", "awaiting-settlement": "等待结算", settled: "结算完成", cancelled: "游戏取消" } as const)[phase]; }
function txLabel(tx: TransactionProgress) { return tx.state === "submitted" ? "交易已提交" : tx.state === "included" ? "已进入区块" : tx.state === "finalized" ? "已最终确认" : "等待 MetaMask"; }
