import { parseAbi } from "viem";

// Kept deliberately small so the frontend can compile before regenerated
// artifacts from packages/contracts are available.
export const minorityRedPacketAbi = parseAbi([
  "function createGame(uint64 lobbyBlocks) returns (uint256 gameId)",
  "function openNextRound(uint256 gameId, uint64 lobbyBlocks) returns (uint64 roundNumber)",
  "function joinGame(uint256 gameId) payable",
  "function expireGame(uint256 gameId)",
  "function signalChoice(uint256 gameId, uint8 packetId)",
  "function commitChoice(uint256 gameId, bytes32 commitment)",
  "function revealChoice(uint256 gameId, uint8 packetId, bytes32 salt)",
  "function settle(uint256 gameId)",
  "function claim(uint256 gameId, address recipient)",
  "function phase(uint256 gameId) view returns (uint8)",
  "function makeCommitment(uint256 gameId, address player, uint8 packetId, bytes32 salt) view returns (bytes32)",
  "function getCurrentRound(uint256 gameId) view returns (uint64)",
  "function getRoom(uint256 gameId) view returns ((uint64 currentRound, bool exists, uint256 outstandingPrize) room)",
  "function claimable(uint256 gameId, address player) view returns (uint256)",
  "function getPlayers(uint256 gameId) view returns (address[])",
  "function getGame(uint256 gameId) view returns ((uint64 roundNumber, uint64 joinEndBlock, uint64 startBlock, uint64 signalEndBlock, uint64 commitEndBlock, uint64 revealEndBlock, uint8 playerCount, uint8 winnerPacket, uint8 winnerCount, bool exists, bool settled, bool cancelled, uint256 pot, uint256 winningStake, uint256 losingPot, uint256 remainder) game)",
  "function getPlayerAction(uint256 gameId, address player) view returns ((uint96 stakeAmount, bytes32 commitment, uint8 signalPacket, uint8 revealedPacket, bool joined, bool hasSignaled, bool revealed, uint256 payout) action)",
  "function getRevealedCounts(uint256 gameId) view returns (uint8[4])",
  "event GameCreated(uint256 indexed gameId, uint64 startBlock)",
  "event RoundOpened(uint256 indexed gameId, uint64 indexed roundNumber, uint64 startBlock)",
  "event PlayerJoined(uint256 indexed gameId, uint64 indexed roundNumber, address indexed player, uint8 registrationIndex, uint96 stakeAmount)",
  "event SignalUpdated(uint256 indexed gameId, uint64 indexed roundNumber, address indexed player, uint8 packetId)",
  "event ChoiceCommitted(uint256 indexed gameId, uint64 indexed roundNumber, address indexed player, bytes32 commitment)",
  "event ChoiceRevealed(uint256 indexed gameId, uint64 indexed roundNumber, address indexed player, uint8 packetId)",
  "event GameSettled(uint256 indexed gameId, uint64 indexed roundNumber, uint8[4] counts, uint8 winnerPacket, uint8 winnerCount, uint256 pot, uint256 winningStake, uint256 losingPot, uint256 remainder)",
  "event PrizeClaimed(uint256 indexed gameId, address indexed player, address indexed recipient, uint256 amount)",
]);
