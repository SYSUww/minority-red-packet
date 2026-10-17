import {
  type Account,
  type Address,
  type Chain,
  type Hash,
  type PublicClient,
  type Transport,
  type WalletClient,
  getContract,
} from "viem";
import type { PacketId } from "@/lib/game-config";
import { minorityRedPacketAbi } from "@/lib/contract-abi";

export type TransactionState = "submitted" | "included" | "finalized";

export type TransactionProgress = Readonly<{
  hash: Hash;
  state: TransactionState;
}>;

export class OnchainGameGateway {
  private readonly contract;

  constructor(
    public readonly address: Address,
    private readonly publicClient: PublicClient<Transport, Chain>,
    private readonly walletClient: WalletClient<Transport, Chain, Account>,
  ) {
    this.contract = getContract({
      address,
      abi: minorityRedPacketAbi,
      client: { public: publicClient, wallet: walletClient },
    });
  }

  get playerAddress() {
    return this.walletClient.account.address;
  }

  async signal(gameId: bigint, packetId: PacketId) {
    return this.send("signalChoice", [gameId, packetId]);
  }

  async commit(gameId: bigint, commitment: Hash) {
    return this.send("commitChoice", [gameId, commitment]);
  }

  async reveal(gameId: bigint, packetId: PacketId, salt: Hash) {
    return this.send("revealChoice", [gameId, packetId, salt]);
  }

  async settle(gameId: bigint) {
    return this.send("settle", [gameId]);
  }

  async claim(gameId: bigint, recipient: Address = this.playerAddress) {
    return this.send("claim", [gameId, recipient]);
  }

  async readPlayer(gameId: bigint, player: Address = this.playerAddress) {
    return this.contract.read.getPlayerAction([gameId, player]);
  }

  async readPhase(gameId: bigint) {
    return Number(await this.contract.read.phase([gameId]));
  }

  private async send(
    functionName: "signalChoice" | "commitChoice" | "revealChoice" | "settle" | "claim",
    args: readonly unknown[],
  ): Promise<TransactionProgress[]> {
    const hash = await this.walletClient.writeContract({
      address: this.address,
      abi: minorityRedPacketAbi,
      functionName,
      args,
      account: this.walletClient.account,
      chain: this.walletClient.chain,
    } as never);
    const progress: TransactionProgress[] = [{ hash, state: "submitted" }];
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("交易已进入区块，但执行失败");
    progress.push({ hash, state: "included" });

    while ((await this.publicClient.getBlock({ blockTag: "finalized" })).number < receipt.blockNumber) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    progress.push({ hash, state: "finalized" });
    return progress;
  }
}
