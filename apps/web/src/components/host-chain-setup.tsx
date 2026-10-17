"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, LoaderCircle, WalletCards } from "lucide-react";
import { type Address, type Hash } from "viem";
import {
  connectInjectedWallet,
  createFundedGame,
  deployGameContract,
  explorerTransactionUrl,
  readWalletBalance,
  validateContractAddress,
} from "@/lib/injected-wallet";

const CONTRACT_STORAGE_KEY = "minority-red-packet:contract:10143";

type ChainStep = "idle" | "connecting" | "deploying" | "creating" | "ready" | "error";

export function HostChainSetup({
  onGameCreated,
}: {
  onGameCreated: (gameId: bigint, contractAddress: Address) => void;
}) {
  const [account, setAccount] = useState<Address | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [contractAddress, setContractAddress] = useState<Address | null>(null);
  const [contractInput, setContractInput] = useState("");
  const [gameId, setGameId] = useState<bigint | null>(null);
  const [step, setStep] = useState<ChainStep>("idle");
  const [message, setMessage] = useState("连接主持人钱包后，即可部署并托管首局奖金。");
  const [txHash, setTxHash] = useState<Hash | null>(null);

  useEffect(() => {
    const configured = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
    const stored = window.localStorage.getItem(CONTRACT_STORAGE_KEY);
    const candidate = configured || stored;
    if (candidate) {
      void validateContractAddress(candidate).then((address) => {
        if (address) {
          setContractAddress(address);
          setContractInput(address);
        }
      });
    }
  }, []);

  async function connect() {
    await run("connecting", "正在请求 MetaMask 授权…", async () => {
      const address = await connectInjectedWallet();
      const nextBalance = await readWalletBalance(address);
      setAccount(address);
      setBalance(nextBalance);
      setMessage(`已连接 Monad Testnet，余额 ${nextBalance} MON。`);
    });
  }

  async function deploy() {
    if (!account) return;
    await run("deploying", "请在 MetaMask 中确认合约部署…", async () => {
      const address = await deployGameContract(account, setTxHash);
      window.localStorage.setItem(CONTRACT_STORAGE_KEY, address);
      setContractAddress(address);
      setContractInput(address);
      setMessage("合约已部署并最终确认，现在可以托管 0.11 MON 创建游戏。");
    });
  }

  async function useExistingContract() {
    await run("connecting", "正在验证合约地址…", async () => {
      const address = await validateContractAddress(contractInput.trim());
      if (!address) throw new Error("该地址无合约字节码，请检查是否为 Monad Testnet 地址。");
      window.localStorage.setItem(CONTRACT_STORAGE_KEY, address);
      setContractAddress(address);
      setMessage("合约地址已验证。");
    });
  }

  async function createGame() {
    if (!account || !contractAddress) return;
    await run("creating", "请在 MetaMask 中确认支付 0.11 MON…", async () => {
      const result = await createFundedGame(account, contractAddress, setTxHash);
      setGameId(result.gameId);
      setStep("ready");
      setMessage(`游戏 #${result.gameId.toString()} 已创建，0.11 MON 已由合约托管。`);
      onGameCreated(result.gameId, contractAddress);
      setBalance(await readWalletBalance(account));
    });
  }

  async function run(activeStep: ChainStep, activeMessage: string, action: () => Promise<void>) {
    setStep(activeStep);
    setMessage(activeMessage);
    setTxHash(null);
    try {
      await action();
      setStep((current) => (current === "ready" ? "ready" : "idle"));
    } catch (error) {
      setStep("error");
      setMessage(humanizeWalletError(error));
    }
  }

  const busy = step === "connecting" || step === "deploying" || step === "creating";

  return (
    <section className="chain-setup" aria-labelledby="chain-setup-title">
      <div className="chain-setup__copy">
        <p className="eyebrow">REAL PAYMENT · MONAD TESTNET</p>
        <h2 id="chain-setup-title">链上资金准备</h2>
        <p className={step === "error" ? "chain-message is-error" : "chain-message"}>{message}</p>
        {txHash && (
          <a href={explorerTransactionUrl(txHash)} target="_blank" rel="noreferrer" className="chain-link">
            查看交易 <ExternalLink size={13} />
          </a>
        )}
      </div>

      <div className="chain-setup__actions">
        {!account ? (
          <button className="button chain-button" onClick={connect} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <WalletCards size={17} />}
            连接 MetaMask
          </button>
        ) : (
          <div className="wallet-summary">
            <span><i />{shortAddress(account)}</span>
            <strong>{balance ?? "—"} MON</strong>
          </div>
        )}

        {account && !contractAddress && (
          <>
            <button className="button chain-button" onClick={deploy} disabled={busy}>
              {step === "deploying" ? <LoaderCircle className="spin" size={17} /> : null}
              部署游戏合约
            </button>
            <div className="existing-contract">
              <input
                aria-label="已部署合约地址"
                value={contractInput}
                onChange={(event) => setContractInput(event.target.value)}
                placeholder="或粘贴已部署的 0x 合约地址"
              />
              <button onClick={useExistingContract} disabled={busy || !contractInput.trim()}>使用</button>
            </div>
          </>
        )}

        {account && contractAddress && gameId === null && (
          <button className="button chain-button is-fund" onClick={createGame} disabled={busy}>
            {step === "creating" ? <LoaderCircle className="spin" size={17} /> : null}
            支付 0.11 MON 并创建
          </button>
        )}

        {gameId !== null && (
          <div className="chain-success"><CheckCircle2 size={18} /><span>游戏 #{gameId.toString()}</span></div>
        )}
      </div>
    </section>
  );
}

function shortAddress(address: Address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function humanizeWalletError(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error && Number((error as { code: unknown }).code) === 4001) {
    return "你已在 MetaMask 中取消操作。";
  }
  if (error instanceof Error) {
    if (/insufficient funds/i.test(error.message)) return "MON 余额不足，无法支付托管金额或 Gas。";
    return error.message.split("\n")[0];
  }
  return "钱包操作失败，请重试。";
}

