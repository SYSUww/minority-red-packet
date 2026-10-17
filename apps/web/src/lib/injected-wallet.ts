import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  getAddress,
  http,
  isAddress,
  type Address,
  type EIP1193Provider,
  type Hash,
  type Hex,
} from "viem";
import minorityRedPacketArtifact from "../../../../packages/contracts/artifacts/contracts/MinorityRedPacket.sol/MinorityRedPacket.json";
import { monadTestnet } from "@/lib/chain";
import { resolveContractAddress } from "@/lib/contract-address";
import { OnchainGameGateway } from "@/lib/onchain-game-gateway";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export const DEFAULT_LOBBY_BLOCKS = 120n;
export const CONTRACT_STORAGE_KEY = "minority-red-packet:contract:10143";

export const monadPublicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(monadTestnet.rpcUrls.default.http[0]),
});

function requireProvider() {
  if (!window.ethereum) {
    throw new Error("未检测到 MetaMask。当前没有 Privy 凭据，请使用安装了 MetaMask 的浏览器。");
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
      params: [{
        chainId: `0x${monadTestnet.id.toString(16)}`,
        chainName: monadTestnet.name,
        nativeCurrency: monadTestnet.nativeCurrency,
        rpcUrls: monadTestnet.rpcUrls.default.http,
        blockExplorerUrls: [monadTestnet.blockExplorers.default.url],
      }],
    } as never);
  }
}

export async function connectInjectedWallet() {
  const provider = requireProvider();
  await switchToMonad(provider);
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const account = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof account !== "string" || !isAddress(account)) throw new Error("没有可用的钱包账户。");
  return getAddress(account);
}

export async function createOnchainGateway(contractAddress: Address, account?: Address) {
  if (!account) return new OnchainGameGateway(contractAddress, monadPublicClient);
  const provider = requireProvider();
  await switchToMonad(provider);
  const walletClient = createWalletClient({ account, chain: monadTestnet, transport: custom(provider) });
  return new OnchainGameGateway(contractAddress, monadPublicClient, walletClient);
}

export async function readWalletBalance(account: Address) {
  const balance = await monadPublicClient.getBalance({ address: account });
  return Number(formatEther(balance)).toFixed(3);
}

export async function deployGameContract(account: Address, onSubmitted?: (hash: Hash) => void) {
  const provider = requireProvider();
  await switchToMonad(provider);
  const walletClient = createWalletClient({ account, chain: monadTestnet, transport: custom(provider) });
  const hash = await walletClient.deployContract({
    account,
    chain: monadTestnet,
    abi: minorityRedPacketArtifact.abi,
    bytecode: minorityRedPacketArtifact.bytecode as Hex,
    args: [100n, 100n, 100n],
  } as never);
  onSubmitted?.(hash);
  const receipt = await monadPublicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("合约部署失败。");
  return getAddress(receipt.contractAddress);
}

export async function validateContractAddress(value: string) {
  if (!isAddress(value)) return null;
  const address = getAddress(value);
  const code = await monadPublicClient.getBytecode({ address });
  return code && code !== "0x" ? address : null;
}

export function configuredContractAddress(candidate?: string | null): Address | null {
  return resolveContractAddress(process.env.NEXT_PUBLIC_CONTRACT_ADDRESS, candidate);
}

export function explorerTransactionUrl(hash: Hash) {
  return `${monadTestnet.blockExplorers.default.url}/tx/${hash}`;
}

export function metaMaskMobileUrl(url: string) {
  return `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//, "")}`;
}

export function shortAddress(address: Address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function humanizeWalletError(error: unknown) {
  if (getErrorCode(error) === 4001) return "你已在 MetaMask 中取消操作。";
  if (error instanceof Error) {
    if (/insufficient funds/i.test(error.message)) return "MON 余额不足，无法支付 stake 或 Gas。";
    return error.message.split("\n")[0];
  }
  return "钱包操作失败，请重试。";
}

function getErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return Number((error as { code: unknown }).code);
}
