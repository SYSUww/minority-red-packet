import type { Address } from "viem";

import type { ChainGameSnapshot } from "./onchain-game-gateway";
import type { PacketId } from "./game-config";

const persistedRounds = new Set<string>();

export async function persistChainRoundHistory(
  contractAddress: Address,
  gameId: bigint,
  snapshot: ChainGameSnapshot,
) {
  if (snapshot.phase !== "settled" && snapshot.phase !== "cancelled") return false;
  const roundNumber = Number(snapshot.game.roundNumber);
  const roundId = `monad-10143:${contractAddress.toLowerCase()}:${gameId.toString()}:round-${roundNumber}`;
  if (persistedRounds.has(roundId)) return false;
  persistedRounds.add(roundId);

  const winningPacketId = snapshot.game.winnerPacket < 4
    ? snapshot.game.winnerPacket as PacketId
    : null;
  const packetCounts = snapshot.revealedCounts as [number, number, number, number];
  const records = snapshot.players.map((player) => {
    const publicPacketId = player.hasSignaled ? player.signalPacket as PacketId : null;
    const secretPacketId = player.revealed ? player.revealedPacket as PacketId : null;
    const behavior = !player.revealed
      ? "abstained"
      : player.hasSignaled && player.signalPacket === player.revealedPacket
        ? "kept"
        : "switched";
    const outcome = winningPacketId === null
      ? "refunded"
      : player.revealed && player.revealedPacket === winningPacketId
        ? "won"
        : "lost";
    return {
      roundId,
      source: "onchain",
      roomId: `MONAD-10143:${contractAddress.toLowerCase()}:${gameId.toString()}`,
      round: roundNumber,
      playerId: player.address.toLowerCase(),
      displayName: player.address,
      isMock: false,
      publicPacketId,
      secretPacketId,
      stakeWei: player.stakeAmount.toString(),
      winningPacketId,
      packetCounts,
      winnerCount: snapshot.game.winnerCount,
      behavior,
      outcome,
      payoutWei: player.payout.toString(),
    };
  });

  try {
    const response = await fetch("/api/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ records }),
    });
    if (!response.ok) throw new Error(`history API returned ${response.status}`);
    return true;
  } catch (error) {
    persistedRounds.delete(roundId);
    throw error;
  }
}
