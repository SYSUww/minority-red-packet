import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  formatEther,
  getAddress,
  http,
  isAddress,
  parseEther,
  type Address,
  type EIP1193Provider,
  type Hash,
  type Hex,
} from "viem";
import minorityRedPacketArtifact from "../../../../packages/contracts/artifacts/contracts/MinorityRedPacket.sol/MinorityRedPacket.json";
import { monadTestnet } from "@/lib/chain";
import { minorityRedPacketAbi } from "@/lib/contract-abi";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export const GAME_DEPOSIT = parseEther("0.11");
export const DEFAULT_PACKET_AMOUNTS = ["0.01", "0.02", "0.03", "0.05"].map((amount) => parseEther(amount)) as [
  bigint,
  bigint,
  bigint,
  bigint,
];

const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(monadTestnet.rpcUrls.default.http[0]),
});

function requireProvider() {
  if (!window.ethereum) {
    throw new Error("未检测到 MetaMask。请用已安装 MetaMask 的 Chrome 打开此页。");
  }
  return window.ethereum;
}

async function switchToMonad(provider: EIP1193Provider) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${monadTestnet.id.toString(16)}` }],
    } as never);
  } catch (error) {
    if (getErrorCode(error) !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: `0x${monadTestnet.id.toString(16)}`,
          chainName: monadTestnet.name,
          nativeCurrency: monadTestnet.nativeCurrency,
          rpcUrls: monadTestnet.rpcUrls.default.http,
          blockExplorerUrls: [monadTestnet.blockExplorers.default.url],
        },
      ],
    } as never);
  }
}

async function walletFor(account: Address) {
  const provider = requireProvider();
  await switchToMonad(provider);
  return createWalletClient({
    account,
    chain: monadTestnet,
    transport: custom(provider),
  });
}

export async function connectInjectedWallet() {
  const provider = requireProvider();
  await switchToMonad(provider);
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const account = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof account !== "string" || !isAddress(account)) throw new Error("没有可用的钱包账户。");
  return getAddress(account);
}

export async function readWalletBalance(account: Address) {
  const balance = await publicClient.getBalance({ address: account });
  return Number(formatEther(balance)).toFixed(3);
}

export async function deployGameContract(account: Address, onSubmitted?: (hash: Hash) => void) {
  const walletClient = await walletFor(account);
  const hash = await walletClient.deployContract({
    account,
    chain: monadTestnet,
    abi: minorityRedPacketArtifact.abi,
    bytecode: minorityRedPacketArtifact.bytecode as Hex,
    args: [60n, 60n, 60n, 1_200n],
  } as never);
  onSubmitted?.(hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("合约部署失败。");
  return getAddress(receipt.contractAddress);
}

export async function createFundedGame(
  account: Address,
  contractAddress: Address,
  onSubmitted?: (hash: Hash) => void,
) {
  const walletClient = await walletFor(account);
  const { request } = await publicClient.simulateContract({
    account,
    address: contractAddress,
    abi: minorityRedPacketAbi,
    functionName: "createGame",
    args: [DEFAULT_PACKET_AMOUNTS, 1_200n],
    value: GAME_DEPOSIT,
  });
  const hash = await walletClient.writeContract(request);
  onSubmitted?.(hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("创建游戏交易执行失败。");

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: minorityRedPacketAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "GameCreated") {
        return { gameId: decoded.args.gameId, hash };
      }
    } catch {
      // Other contracts can emit logs in the same transaction; only our event matters here.
    }
  }
  throw new Error("交易已成功，但未找到 GameCreated 事件。");
}

export async function validateContractAddress(value: string) {
  if (!isAddress(value)) return null;
  const address = getAddress(value);
  const code = await publicClient.getBytecode({ address });
  return code && code !== "0x" ? address : null;
}

export function explorerTransactionUrl(hash: Hash) {
  return `${monadTestnet.blockExplorers.default.url}/tx/${hash}`;
}

function getErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return Number((error as { code: unknown }).code);
}

