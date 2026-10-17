import { encodeAbiParameters, keccak256, parseAbiParameters } from "viem";

export const COMMIT_TYPEHASH = keccak256(
  new TextEncoder().encode(
    "MinorityRedPacketCommit(uint256 chainId,address verifyingContract,uint256 gameId,uint64 roundNumber,address player,uint8 packetId,bytes32 salt)",
  ),
);

export function createCommitment(input: {
  chainId: bigint;
  contractAddress: `0x${string}`;
  gameId: bigint;
  roundNumber: bigint;
  player: `0x${string}`;
  packetId: number;
  salt: `0x${string}`;
}) {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32 typehash, uint256 chainId, address verifyingContract, uint256 gameId, uint64 roundNumber, address player, uint8 packetId, bytes32 salt",
      ),
      [
        COMMIT_TYPEHASH,
        input.chainId,
        input.contractAddress,
        input.gameId,
        input.roundNumber,
        input.player,
        input.packetId,
        input.salt,
      ],
    ),
  );
}

export function randomSalt(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
