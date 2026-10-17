import type { PacketId } from "@/lib/game-config";
import { randomSalt } from "@/lib/commitment";

export type StoredCommit = Readonly<{
  packetId: PacketId;
  salt: `0x${string}`;
  commitment: `0x${string}`;
  transactionHash?: `0x${string}`;
}>;

const PREFIX = "minority-red-packet:commit";

export class CommitVault {
  private key(gameId: bigint, roundNumber: bigint, player: `0x${string}`) {
    return `${PREFIX}:${gameId}:${roundNumber}:${player.toLowerCase()}`;
  }

  create(packetId: PacketId): Pick<StoredCommit, "packetId" | "salt"> {
    return { packetId, salt: randomSalt() };
  }

  save(gameId: bigint, roundNumber: bigint, player: `0x${string}`, value: StoredCommit) {
    localStorage.setItem(this.key(gameId, roundNumber, player), JSON.stringify(value));
  }

  load(gameId: bigint, roundNumber: bigint, player: `0x${string}`): StoredCommit | null {
    const raw = localStorage.getItem(this.key(gameId, roundNumber, player));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCommit;
    if (![0, 1, 2, 3].includes(parsed.packetId) || !/^0x[0-9a-f]{64}$/i.test(parsed.salt)) {
      return null;
    }
    return parsed;
  }

  clear(gameId: bigint, roundNumber: bigint, player: `0x${string}`) {
    localStorage.removeItem(this.key(gameId, roundNumber, player));
  }
}
