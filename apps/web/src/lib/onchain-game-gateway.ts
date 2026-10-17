import {
  type Account,
  type Address,
  type Chain,
  decodeEventLog,
  formatEther,
  type Hash,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import type { PacketId } from "./game-config";
import { minorityRedPacketAbi } from "./contract-abi";

export const CHAIN_PHASES = ["lobby", "signal", "commit", "reveal", "awaiting-settlement", "settled", "cancelled"] as const;
export type ChainPhase = (typeof CHAIN_PHASES)[number];
export type TransactionState = "awaiting-signature" | "submitted" | "included" | "finalized";
export type TransactionProgress = Readonly<{ hash?: Hash; state: TransactionState }>;

export type ChainGame = Readonly<{
  roundNumber: bigint;
  joinEndBlock: bigint;
  startBlock: bigint;
  signalEndBlock: bigint;
  commitEndBlock: bigint;
  revealEndBlock: bigint;
  playerCount: number;
  winnerPacket: number;
  winnerCount: number;
  exists: boolean;
  settled: boolean;
  cancelled: boolean;
  pot: bigint;
  winningStake: bigint;
  losingPot: bigint;
  remainder: bigint;
}>;

export type ChainPlayer = Readonly<{
  address: Address;
  stakeAmount: bigint;
  commitment: Hash;
  signalPacket: number;
  revealedPacket: number;
  joined: boolean;
  hasSignaled: boolean;
  revealed: boolean;
  payout: bigint;
}>;

export type ChainGameSnapshot = Readonly<{
  game: ChainGame;
  phase: ChainPhase;
  phaseIndex: number;
  players: ChainPlayer[];
  revealedCounts: readonly number[];
  blockNumber: bigint;
}>;

type ProgressListener = (progress: TransactionProgress) => void;

export class OnchainGameGateway {
  constructor(
    public readonly address: Address,
    private readonly publicClient: PublicClient<Transport, Chain>,
    private readonly walletClient?: WalletClient<Transport, Chain, Account>,
  ) {}

  get playerAddress() {
    return this.requireWallet().account.address;
  }

  async createGame(lobbyBlocks: bigint, onProgress?: ProgressListener) {
    const receipt = await this.send("createGame", [lobbyBlocks], undefined, onProgress);
    for (const log of receipt.logs) {
      try {
        const event = decodeEventLog({ abi: minorityRedPacketAbi, data: log.data, topics: log.topics });
        if (event.eventName === "GameCreated") return event.args.gameId;
      } catch {
        // Receipts can contain unrelated logs.
      }
    }
    throw new Error("创建交易已成功，但没有找到 GameCreated 事件。");
  }

  async join(gameId: bigint, stakeAmount: bigint, onProgress?: ProgressListener) {
    return this.send("joinGame", [gameId], stakeAmount, onProgress);
  }

  async openNextRound(gameId: bigint, lobbyBlocks: bigint, onProgress?: ProgressListener) {
    return this.send("openNextRound", [gameId, lobbyBlocks], undefined, onProgress);
  }

  async expire(gameId: bigint, onProgress?: ProgressListener) {
    return this.send("expireGame", [gameId], undefined, onProgress);
  }

  async signal(gameId: bigint, packetId: PacketId, onProgress?: ProgressListener) {
    return this.send("signalChoice", [gameId, packetId], undefined, onProgress);
  }

  async commit(gameId: bigint, commitment: Hash, onProgress?: ProgressListener) {
    return this.send("commitChoice", [gameId, commitment], undefined, onProgress);
  }

  async reveal(gameId: bigint, packetId: PacketId, salt: Hash, onProgress?: ProgressListener) {
    return this.send("revealChoice", [gameId, packetId, salt], undefined, onProgress);
  }

  async settle(gameId: bigint, onProgress?: ProgressListener) {
    return this.send("settle", [gameId], undefined, onProgress);
  }

  async claim(gameId: bigint, recipient: Address = this.playerAddress, onProgress?: ProgressListener) {
    return this.send("claim", [gameId, recipient], undefined, onProgress);
  }

  async readClaimable(gameId: bigint, player: Address) {
    return this.publicClient.readContract({
      address: this.address,
      abi: minorityRedPacketAbi,
      functionName: "claimable",
      args: [gameId, player],
    });
  }

  async readPlayer(gameId: bigint, player: Address): Promise<ChainPlayer> {
    const action = await this.publicClient.readContract({
      address: this.address,
      abi: minorityRedPacketAbi,
      functionName: "getPlayerAction",
      args: [gameId, player],
    });
    return { address: player, ...action } as ChainPlayer;
  }

  async readSnapshot(gameId: bigint): Promise<ChainGameSnapshot> {
    const [game, rawPhase, addresses, counts, blockNumber] = await Promise.all([
      this.publicClient.readContract({ address: this.address, abi: minorityRedPacketAbi, functionName: "getGame", args: [gameId] }),
      this.publicClient.readContract({ address: this.address, abi: minorityRedPacketAbi, functionName: "phase", args: [gameId] }),
      this.publicClient.readContract({ address: this.address, abi: minorityRedPacketAbi, functionName: "getPlayers", args: [gameId] }),
      this.publicClient.readContract({ address: this.address, abi: minorityRedPacketAbi, functionName: "getRevealedCounts", args: [gameId] }),
      this.publicClient.getBlockNumber(),
    ]);
    const players = await Promise.all(addresses.map((player) => this.readPlayer(gameId, player)));
    const phaseIndex = Number(rawPhase);
    return {
      game: { ...game, playerCount: Number(game.playerCount), winnerPacket: Number(game.winnerPacket), winnerCount: Number(game.winnerCount) },
      phase: CHAIN_PHASES[phaseIndex] ?? "cancelled",
      phaseIndex,
      players,
      revealedCounts: counts.map(Number),
      blockNumber,
    };
  }

  private requireWallet() {
    if (!this.walletClient) throw new Error("请先连接 MetaMask。");
    return this.walletClient;
  }

  private async send(
    functionName: "createGame" | "openNextRound" | "joinGame" | "expireGame" | "signalChoice" | "commitChoice" | "revealChoice" | "settle" | "claim",
    args: readonly unknown[],
    value?: bigint,
    onProgress?: ProgressListener,
  ) {
    const wallet = this.requireWallet();
    const contractRequest = {
      address: this.address,
      abi: minorityRedPacketAbi,
      functionName,
      args,
      value,
      account: wallet.account,
      chain: wallet.chain,
    } as const;
    const [balance, gasPrice, gas] = await Promise.all([
      this.publicClient.getBalance({ address: wallet.account.address }),
      this.publicClient.getGasPrice(),
      this.publicClient.estimateContractGas(contractRequest as never),
    ]);
    const required = (value ?? 0n) + gas * gasPrice;
    if (balance < required) {
      throw new Error(`MON 余额不足：本次至少需要约 ${formatEther(required)} MON（含 Gas）。`);
    }
    const { request } = await this.publicClient.simulateContract(contractRequest as never);
    onProgress?.({ state: "awaiting-signature" });
    const hash = await wallet.writeContract({ ...request, gas } as never);
    onProgress?.({ hash, state: "submitted" });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("交易已进入区块，但执行失败。");
    onProgress?.({ hash, state: "included" });
    while ((await this.publicClient.getBlock({ blockTag: "finalized" })).number < receipt.blockNumber) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    onProgress?.({ hash, state: "finalized" });
    return receipt;
  }
}
