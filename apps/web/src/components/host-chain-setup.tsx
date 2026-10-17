"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, ExternalLink, FlaskConical, LoaderCircle, Play, Share2, UserPlus, WalletCards } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { formatEther, type Address, type Hash } from "viem";
import { PACKETS } from "@/lib/game-config";
import {
  CONTRACT_STORAGE_KEY,
  DEFAULT_LOBBY_BLOCKS,
  configuredContractAddress,
  connectInjectedWallet,
  createOnchainGateway,
  deployGameContract,
  explorerTransactionUrl,
  humanizeWalletError,
  readWalletBalance,
  shortAddress,
  validateContractAddress,
} from "@/lib/injected-wallet";
import type { ChainGameSnapshot, TransactionProgress } from "@/lib/onchain-game-gateway";
import { persistChainRoundHistory } from "@/lib/persist-chain-history";
import { PlayerFlowRail, type PlayerFlowStep } from "@/components/player-flow-ui";

const PHASE_LABELS = ["等待加入", "公开站队", "秘密锁定", "同时揭晓", "等待结算", "结算完成", "已取消"];

export function ChainHostConsole() {
  const [account, setAccount] = useState<Address | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [contractAddress, setContractAddress] = useState<Address | null>(null);
  const [contractInput, setContractInput] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [gameId, setGameId] = useState<bigint | null>(null);
  const [snapshot, setSnapshot] = useState<ChainGameSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("首次使用先选择协议地址；之后只需输入房间号。");
  const [tx, setTx] = useState<TransactionProgress | null>(null);

  useEffect(() => {
    const candidate = configuredContractAddress(window.localStorage.getItem(CONTRACT_STORAGE_KEY));
    if (!candidate) return;
    void validateContractAddress(candidate).then((valid) => {
      if (!valid) return;
      setContractAddress(valid);
      setContractInput(valid);
      setMessage("输入房间号即可查看；连接 MetaMask 后也可以创建新房间。");
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!contractAddress || gameId === null) return;
    const gateway = await createOnchainGateway(contractAddress);
    const next = await gateway.readSnapshot(gameId);
    setSnapshot(next);
    void persistChainRoundHistory(contractAddress, gameId, next).catch(() => undefined);
  }, [contractAddress, gameId]);

  useEffect(() => {
    if (!contractAddress || gameId === null) return;
    void refresh().catch((error) => setMessage(humanizeWalletError(error)));
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 1_000);
    return () => window.clearInterval(timer);
  }, [contractAddress, gameId, refresh]);

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
      const nextAccount = await connectInjectedWallet();
      setAccount(nextAccount);
      const nextBalance = await readWalletBalance(nextAccount);
      setBalance(nextBalance);
      setMessage(`已连接 Monad Testnet。余额 ${nextBalance} MON。`);
    });
  }

  async function deploy() {
    if (!account) return;
    await run(async () => {
      setMessage("请在 MetaMask 中确认部署交易。");
      const address = await deployGameContract(account, (hash) => setTx({ state: "submitted", hash }));
      window.localStorage.setItem(CONTRACT_STORAGE_KEY, address);
      setContractAddress(address);
      setContractInput(address);
      setMessage("协议合约已部署。任何账户都可以创建和加入房间。");
    });
  }

  async function useExisting() {
    await run(async () => {
      const address = await validateContractAddress(contractInput.trim());
      if (!address) throw new Error("该地址在 Monad Testnet 上没有合约代码。");
      window.localStorage.setItem(CONTRACT_STORAGE_KEY, address);
      setContractAddress(address);
      setMessage("合约地址已验证。");
    });
  }

  async function createGame() {
    if (!account || !contractAddress) return;
    await run(async () => {
      setMessage("请确认创建房间交易；创建者只支付 Gas，不承担奖金本金，也没有特殊权限。");
      const gateway = await createOnchainGateway(contractAddress, account);
      const id = await gateway.createGame(DEFAULT_LOBBY_BLOCKS, setTx);
      setGameId(id);
      setRoomInput(id.toString());
      setMessage(`房间 #${id.toString()} 已创建。分享房间号或二维码即可加入。`);
      setBalance(await readWalletBalance(account));
    });
  }

  async function openRoom() {
    await run(async () => {
      const value = roomInput.trim();
      if (!/^\d+$/.test(value) || BigInt(value) === 0n) throw new Error("请输入有效的房间号。");
      setGameId(BigInt(value));
      setMessage(`正在读取房间 #${value}。`);
    });
  }

  async function settleOrExpire() {
    if (!account || !contractAddress || gameId === null || !snapshot) return;
    await run(async () => {
      const gateway = await createOnchainGateway(contractAddress, account);
      if (snapshot.phase === "lobby" && snapshot.blockNumber >= snapshot.game.joinEndBlock) {
        await gateway.expire(gameId, setTx);
        setMessage("房间人数不足，所有已加入玩家现在可以取回押金。");
      } else if (snapshot.phase === "awaiting-settlement") {
        await gateway.settle(gameId, setTx);
        setMessage("结算已最终确认，赢家现在可以领取。");
      } else if (snapshot.phase === "settled" || snapshot.phase === "cancelled") {
        await gateway.openNextRound(gameId, DEFAULT_LOBBY_BLOCKS, setTx);
        setMessage(`房间 #${gameId.toString()} 已进入下一轮，玩家需要重新投入并加入。`);
      }
      await refresh();
    });
  }

  const joinUrl = useMemo(() => {
    if (typeof window === "undefined" || gameId === null || !contractAddress) return "";
    const publicOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
    const fixedDeployment = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS?.trim();
    const contractQuery = fixedDeployment ? "" : `?contract=${contractAddress}`;
    return `${publicOrigin || window.location.origin}/play/${gameId.toString()}${contractQuery}`;
  }, [contractAddress, gameId]);

  const lobbyExpired = snapshot?.phase === "lobby" && snapshot.blockNumber >= snapshot.game.joinEndBlock;
  const canControl = Boolean(account && (lobbyExpired || snapshot?.phase === "awaiting-settlement" || snapshot?.phase === "settled" || snapshot?.phase === "cancelled"));
  const controlLabel = lobbyExpired ? "退还全部押金" : snapshot?.phase === "awaiting-settlement" ? "任何人可结算" : snapshot?.phase === "settled" || snapshot?.phase === "cancelled" ? `开启第 ${Number(snapshot.game.roundNumber) + 1} 轮` : "阶段自动流转";

  return (
    <div className="host-console chain-console">
      <header className="console-header">
        <div>
          <Link href="/" className="back-link"><ArrowLeft size={16} /> 返回首页</Link>
          <h1>少数派红包 <span>{gameId === null ? "链上房间大厅" : `房间 #${gameId}${snapshot ? ` · R${snapshot.game.roundNumber.toString().padStart(2, "0")}` : ""}`}</span></h1>
        </div>
        <div className="console-meta">
          <span className="mode-tag chain-mode-tag">MetaMask 开发模式</span>
          <span>Monad 区块 <strong>#{snapshot?.blockNumber.toLocaleString() ?? "—"}</strong></span>
        </div>
      </header>

      <section className="chain-setup chain-onboarding">
        <div className="chain-setup__copy">
          <p className="eyebrow">REAL TRANSACTIONS · MONAD TESTNET</p>
          <h2>没有主持人，只有房间号</h2>
          <p className="chain-message">{message}</p>
          {tx?.hash && <a className="chain-link" href={explorerTransactionUrl(tx.hash)} target="_blank" rel="noreferrer">{txLabel(tx)} <ExternalLink size={13} /></a>}
        </div>
        <div className="chain-setup__actions">
          <Link className="button chain-button test-mode-button" href="/test"><FlaskConical size={17} />本地多人测试</Link>
          {!account ? (
            <button className="button chain-button" onClick={connect} disabled={busy}><WalletCards size={17} />连接 MetaMask</button>
          ) : <div className="wallet-summary"><span><i />{shortAddress(account)}</span><strong>{balance ?? "—"} MON</strong></div>}
          {account && !contractAddress && <button className="button chain-button" onClick={deploy} disabled={busy}>{busy && <LoaderCircle className="spin" size={17} />}部署合约</button>}
          {!contractAddress && <div className="existing-contract"><input value={contractInput} onChange={(event) => setContractInput(event.target.value)} placeholder="首次使用：粘贴协议地址" /><button onClick={useExisting} disabled={busy}>使用</button></div>}
          {contractAddress && gameId === null && <div className="existing-contract room-number-entry"><input inputMode="numeric" value={roomInput} onChange={(event) => setRoomInput(event.target.value)} placeholder="输入房间号" /><button onClick={openRoom} disabled={busy}>进入</button></div>}
          {account && contractAddress && gameId === null && <button className="button chain-button is-fund" onClick={createGame} disabled={busy}>创建新房间</button>}
        </div>
      </section>

      {snapshot ? (
        <section className="console-stage">
          <div className="console-titlebar">
            <div><p className="eyebrow">{PHASE_LABELS[snapshot.phaseIndex]} · ROOM #{gameId?.toString()} · ROUND {snapshot.game.roundNumber.toString()}</p><h2>{phaseTitle(snapshot)}</h2></div>
            <div className="block-clock"><strong>{snapshot.game.playerCount} / 8</strong><span>已付费加入</span></div>
          </div>
          <PlayerFlowRail current={hostFlowStep(snapshot)} dark />
          {snapshot.phase === "lobby" && joinUrl && gameId !== null ? <ChainLobby account={account} busy={busy} gameId={gameId} joinUrl={joinUrl} snapshot={snapshot} /> : <ChainBoard snapshot={snapshot} />}
        </section>
      ) : (
        <section className="console-stage chain-empty"><strong>输入房间号，或创建新房间</strong><p>房间没有主持人权限；报名截止后按区块自动进入站队、锁定和揭晓阶段。</p></section>
      )}

      <footer className="console-controls">
        <div className="player-total"><strong>{snapshot?.game.playerCount ?? 0} / 8</strong><span>名房间玩家</span></div>
        <p>满 8 人会提前开始；否则报名截止后，4 人以上自动开局。</p>
        <button className="button console-button" onClick={settleOrExpire} disabled={!canControl || busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Play size={18} />}{controlLabel}</button>
      </footer>
    </div>
  );
}

function ChainLobby({ account, busy, gameId, joinUrl, snapshot }: { account: Address | null; busy: boolean; gameId: bigint; joinUrl: string; snapshot: ChainGameSnapshot }) {
  const [copied, setCopied] = useState(false);
  const invitation = `加入少数派红包房间 #${gameId.toString()}\n每人选择投入 1～10 MON，少数派按投入权重分败者资金\n${joinUrl}`;
  const localOnly = /^https?:\/\/(localhost|127\.0\.0\.1)(?::|\/)/.test(joinUrl);
  const joined = Boolean(account && snapshot.players.some((player) => player.address.toLowerCase() === account.toLowerCase()));
  const canJoin = snapshot.blockNumber < snapshot.game.joinEndBlock && snapshot.game.playerCount < 8;

  async function copyInvite() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(invitation);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = invitation;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  async function shareInvite() {
    if (navigator.share) {
      try {
        await navigator.share({ title: `少数派红包 · 房间 #${gameId.toString()}`, text: invitation, url: joinUrl });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        await copyInvite();
      }
      return;
    }
    await copyInvite();
  }

  return <div className="lobby-grid"><div className="qr-card invite-card"><p className="invite-room-label">房间号</p><b>#{gameId.toString()}</b><QRCodeSVG value={joinUrl} size={176} bgColor="#fffdf8" fgColor="#17131f" level="M" /><div><strong>扫码立即加入</strong><span>{joinUrl.replace(/^https?:\/\//, "")}</span></div>{account && (joined ? <a className="creator-join-action is-joined" href={joinUrl}><Play size={15} />进入我的玩家界面</a> : <a className={`creator-join-action${!canJoin || busy ? " is-disabled" : ""}`} href={canJoin && !busy ? joinUrl : undefined}><UserPlus size={15} />{canJoin ? "选择金额并加入本房间" : "加入阶段已结束"}</a>)}<div className="invite-actions"><button onClick={copyInvite}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "已复制" : "复制邀请"}</button><button onClick={shareInvite}><Share2 size={14} />分享</button></div>{localOnly && <p className="invite-warning">当前二维码是 localhost，手机无法访问。请配置 NEXT_PUBLIC_APP_URL 为公网域名或本机局域网地址。</p>}</div><div className="lobby-players">{snapshot.players.map((player, index) => <div className="lobby-player" key={player.address}><span>{index + 1}</span><p><strong>{shortAddress(player.address)}</strong><small>已投入 {formatEther(player.stakeAmount)} MON</small></p><i /></div>)}</div></div>;
}

function ChainBoard({ snapshot }: { snapshot: ChainGameSnapshot }) {
  const showReveal = snapshot.phase === "reveal" || snapshot.phase === "awaiting-settlement" || snapshot.phase === "settled";
  const winnerPacket = snapshot.phase === "settled" && snapshot.game.winnerPacket < PACKETS.length ? PACKETS[snapshot.game.winnerPacket] : null;
  return <div className="chain-board-wrap">{snapshot.phase === "settled" && <div className="host-result-summary" style={winnerPacket ? { "--result-color": winnerPacket.color, "--result-ink": winnerPacket.ink } as React.CSSProperties : undefined}><p><span>FINAL RESULT</span><strong>{winnerPacket ? `${winnerPacket.name}成为本轮少数派` : "本轮没有形成少数派"}</strong></p><div><span>赢家</span><strong>{snapshot.game.winnerCount} 人</strong><span>总资金池</span><strong>{formatEther(snapshot.game.pot)} MON</strong><span>败者资金</span><strong>{formatEther(snapshot.game.losingPot)} MON</strong></div></div>}<div className={`host-packet-grid phase-${snapshot.phase}`}>{PACKETS.map((packet) => {
    const grouped = snapshot.players.filter((player) => showReveal ? player.revealed && player.revealedPacket === packet.id : player.hasSignaled && player.signalPacket === packet.id);
    const winner = snapshot.phase === "settled" && snapshot.game.winnerPacket === packet.id;
    const groupedStake = grouped.reduce((total, player) => total + player.stakeAmount, 0n);
    return <article className={winner ? "host-packet is-winner" : "host-packet"} key={packet.id} style={{ "--packet-color": packet.color, "--packet-ink": packet.ink } as React.CSSProperties}>{winner && <span className="winner-ribbon">少数派</span>}<div className="host-packet__head"><span>{packet.name}</span><small>0{packet.id + 1}</small></div><strong>0{packet.id + 1}</strong><em>平票优先级 {packet.id + 1}</em><div className="host-player-list">{grouped.map((player) => <span key={player.address}>{shortAddress(player.address).slice(2, 4)}<small>{formatEther(player.stakeAmount)} MON</small></span>)}</div><p>{grouped.length} 人 · {formatEther(groupedStake)} MON</p></article>;
  })}</div>{snapshot.phase === "settled" && <div className="host-public-results">{snapshot.players.map((player) => {
    const status = !player.revealed ? "弃权" : player.hasSignaled && player.signalPacket === player.revealedPacket ? "守约" : "反水";
    return <div key={player.address}><code>{shortAddress(player.address)} · 投入 {formatEther(player.stakeAmount)}</code><span>{player.hasSignaled ? PACKETS[player.signalPacket as 0 | 1 | 2 | 3].name : "未站队"} → {player.revealed ? PACKETS[player.revealedPacket as 0 | 1 | 2 | 3].name : "未揭晓"}</span><em>{player.payout > 0n ? `领取 ${formatEther(player.payout)}` : "—"}</em><strong data-status={status}>{status}</strong></div>;
  })}</div>}</div>;
}

function hostFlowStep(snapshot: ChainGameSnapshot): PlayerFlowStep {
  if (snapshot.phase === "lobby") return "join";
  if (snapshot.phase === "signal") return "signal";
  if (snapshot.phase === "commit") return "commit";
  if (snapshot.phase === "reveal" || snapshot.phase === "awaiting-settlement") return "reveal";
  return "result";
}

function phaseTitle(snapshot: ChainGameSnapshot) {
  if (snapshot.phase === "lobby") return "凭房间号加入，截止后自动开始。";
  if (snapshot.phase === "signal") return "公开选择已经上链。";
  if (snapshot.phase === "commit") return "只显示锁定进度，不泄露最终选择。";
  if (snapshot.phase === "reveal") return "玩家正在公开最终选择。";
  if (snapshot.phase === "awaiting-settlement") return "揭晓结束，可以执行结算。";
  if (snapshot.phase === "settled") return snapshot.game.winnerPacket < 4 ? `${PACKETS[snapshot.game.winnerPacket].name}是本轮少数派，可以继续下一轮。` : "本轮没有形成少数派，可以继续下一轮。";
  return "本轮已取消，玩家可取回投入并继续下一轮。";
}

function txLabel(tx: TransactionProgress) {
  if (tx.state === "submitted") return "已提交，查看交易";
  if (tx.state === "included") return "已进入区块，查看交易";
  if (tx.state === "finalized") return "已最终确认，查看交易";
  return "等待 MetaMask 确认";
}
