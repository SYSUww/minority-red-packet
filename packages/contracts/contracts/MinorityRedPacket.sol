// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

/// @title Minority Red Packet
/// @notice A four-packet, weighted-stake commit-reveal minority game.
contract MinorityRedPacket {
    uint8 public constant PACKET_COUNT = 4;
    uint8 public constant MIN_PLAYERS = 4;
    uint8 public constant MAX_PLAYERS = 8;
    uint8 public constant NO_WINNER = type(uint8).max;
    uint96 public constant MIN_STAKE = 1 ether;
    uint96 public constant MAX_STAKE = 10 ether;

    bytes32 public constant COMMIT_TYPEHASH = keccak256(
        "MinorityRedPacketCommit(uint256 chainId,address verifyingContract,uint256 gameId,address player,uint8 packetId,bytes32 salt)"
    );

    enum Phase {
        Lobby,
        Signal,
        Commit,
        Reveal,
        AwaitingSettlement,
        Settled,
        Cancelled
    }

    struct Game {
        uint64 joinEndBlock;
        uint64 startBlock;
        uint64 signalEndBlock;
        uint64 commitEndBlock;
        uint64 revealEndBlock;
        uint8 playerCount;
        uint8 winnerPacket;
        uint8 winnerCount;
        bool exists;
        bool settled;
        bool cancelled;
        uint256 pot;
        uint256 winningStake;
        uint256 losingPot;
        uint256 remainder;
        uint256 outstandingPrize;
    }

    struct PlayerAction {
        uint96 stakeAmount;
        bytes32 commitment;
        uint8 signalPacket;
        uint8 revealedPacket;
        bool joined;
        bool hasSignaled;
        bool revealed;
        bool claimed;
        uint256 payout;
    }

    error GameNotFound();
    error InvalidDuration();
    error InvalidStake();
    error IncorrectFunding();
    error InvalidPhase();
    error InvalidPacket();
    error InvalidPlayer();
    error DuplicatePlayer();
    error PlayerLimitReached();
    error NotPlayer();
    error MissingSignal();
    error InvalidCommitment();
    error AlreadyCommitted();
    error AlreadyRevealed();
    error CommitmentMismatch();
    error NoPrize();
    error AlreadyClaimed();
    error TransferFailed();
    error ReentrantCall();

    event GameCreated(uint256 indexed gameId, uint64 startBlock);
    event PlayerJoined(
        uint256 indexed gameId,
        address indexed player,
        uint8 registrationIndex,
        uint96 stakeAmount
    );
    event SignalUpdated(uint256 indexed gameId, address indexed player, uint8 packetId);
    event ChoiceCommitted(uint256 indexed gameId, address indexed player, bytes32 commitment);
    event ChoiceRevealed(uint256 indexed gameId, address indexed player, uint8 packetId);
    event GameSettled(
        uint256 indexed gameId,
        uint8[PACKET_COUNT] counts,
        uint8 winnerPacket,
        uint8 winnerCount,
        uint256 pot,
        uint256 winningStake,
        uint256 losingPot,
        uint256 remainder
    );
    event GameCancelled(uint256 indexed gameId);
    event PrizeClaimed(uint256 indexed gameId, address indexed player, address indexed recipient, uint256 amount);

    uint64 public immutable signalDuration;
    uint64 public immutable commitDuration;
    uint64 public immutable revealDuration;

    uint256 public nextGameId = 1;

    mapping(uint256 gameId => Game game) private _games;
    mapping(uint256 gameId => address[] players) private _players;
    mapping(uint256 gameId => mapping(address player => PlayerAction action)) private _actions;
    mapping(uint256 gameId => uint8[PACKET_COUNT] counts) private _revealedCounts;

    uint256 private _lock = 1;

    modifier nonReentrant() {
        if (_lock != 1) revert ReentrantCall();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(uint64 signalBlocks, uint64 commitBlocks, uint64 revealBlocks) {
        if (signalBlocks == 0 || commitBlocks == 0 || revealBlocks == 0) {
            revert InvalidDuration();
        }
        signalDuration = signalBlocks;
        commitDuration = commitBlocks;
        revealDuration = revealBlocks;
    }

    function createGame(uint64 lobbyBlocks) external returns (uint256 gameId) {
        if (lobbyBlocks == 0) revert InvalidDuration();

        gameId = nextGameId++;
        Game storage game = _games[gameId];
        game.exists = true;
        game.winnerPacket = NO_WINNER;
        _schedule(game, block.number + lobbyBlocks);

        emit GameCreated(gameId, game.startBlock);
    }

    function joinGame(uint256 gameId) external payable {
        Game storage game = _getGame(gameId);
        if (phase(gameId) != Phase.Lobby || block.number >= game.startBlock) revert InvalidPhase();
        if (
            msg.value < MIN_STAKE ||
            msg.value > MAX_STAKE ||
            msg.value % 1 ether != 0
        ) revert IncorrectFunding();

        PlayerAction storage action = _actions[gameId][msg.sender];
        if (action.joined) revert DuplicatePlayer();
        if (game.playerCount >= MAX_PLAYERS) revert PlayerLimitReached();

        action.joined = true;
        action.stakeAmount = uint96(msg.value);
        _players[gameId].push(msg.sender);
        uint8 registrationIndex = game.playerCount;
        game.playerCount = registrationIndex + 1;
        game.pot += msg.value;

        // Filling all seats closes registration without relying on a privileged host.
        if (game.playerCount == MAX_PLAYERS) {
            _schedule(game, block.number + 1);
        }

        emit PlayerJoined(gameId, msg.sender, registrationIndex, uint96(msg.value));
    }

    function expireGame(uint256 gameId) external {
        Game storage game = _getGame(gameId);
        if (
            game.cancelled ||
            game.settled ||
            game.playerCount >= MIN_PLAYERS ||
            block.number < game.startBlock
        ) {
            revert InvalidPhase();
        }
        _cancel(gameId, game);
    }

    function signalChoice(uint256 gameId, uint8 packetId) external {
        if (phase(gameId) != Phase.Signal) revert InvalidPhase();
        _requirePacket(packetId);

        PlayerAction storage action = _actions[gameId][msg.sender];
        if (!action.joined) revert NotPlayer();
        action.signalPacket = packetId;
        action.hasSignaled = true;

        emit SignalUpdated(gameId, msg.sender, packetId);
    }

    function commitChoice(uint256 gameId, bytes32 commitment) external {
        if (phase(gameId) != Phase.Commit) revert InvalidPhase();
        if (commitment == bytes32(0)) revert InvalidCommitment();

        PlayerAction storage action = _actions[gameId][msg.sender];
        if (!action.joined) revert NotPlayer();
        if (!action.hasSignaled) revert MissingSignal();
        if (action.commitment != bytes32(0)) revert AlreadyCommitted();

        action.commitment = commitment;
        emit ChoiceCommitted(gameId, msg.sender, commitment);
    }

    function revealChoice(uint256 gameId, uint8 packetId, bytes32 salt) external {
        if (phase(gameId) != Phase.Reveal) revert InvalidPhase();
        _requirePacket(packetId);

        PlayerAction storage action = _actions[gameId][msg.sender];
        if (!action.joined) revert NotPlayer();
        if (action.commitment == bytes32(0)) revert InvalidCommitment();
        if (action.revealed) revert AlreadyRevealed();
        if (action.commitment != makeCommitment(gameId, msg.sender, packetId, salt)) {
            revert CommitmentMismatch();
        }

        action.revealed = true;
        action.revealedPacket = packetId;
        ++_revealedCounts[gameId][packetId];

        emit ChoiceRevealed(gameId, msg.sender, packetId);
    }

    function settle(uint256 gameId) external {
        if (phase(gameId) != Phase.AwaitingSettlement) revert InvalidPhase();
        Game storage game = _games[gameId];
        uint8[PACKET_COUNT] memory counts = _revealedCounts[gameId];

        uint8 nonEmptyPackets;
        for (uint8 packetId = 0; packetId < PACKET_COUNT; ++packetId) {
            if (counts[packetId] > 0) ++nonEmptyPackets;
        }

        if (nonEmptyPackets <= 1) {
            _assignRefunds(gameId);
        } else {
            uint8 winnerPacket;
            uint8 winnerCount = type(uint8).max;
            for (uint8 packetId = 0; packetId < PACKET_COUNT; ++packetId) {
                uint8 count = counts[packetId];
                // Iterating upward and accepting equality gives ties to the higher packet id.
                if (count > 0 && count <= winnerCount) {
                    winnerPacket = packetId;
                    winnerCount = count;
                }
            }

            game.winnerPacket = winnerPacket;
            game.winnerCount = winnerCount;
            address[] storage players = _players[gameId];
            for (uint256 i = 0; i < players.length; ++i) {
                PlayerAction storage action = _actions[gameId][players[i]];
                if (action.revealed && action.revealedPacket == winnerPacket) {
                    game.winningStake += action.stakeAmount;
                }
            }
            game.losingPot = game.pot - game.winningStake;

            uint256 distributed;
            for (uint256 i = 0; i < players.length; ++i) {
                PlayerAction storage action = _actions[gameId][players[i]];
                if (action.revealed && action.revealedPacket == winnerPacket) {
                    uint256 bonus = (game.losingPot * action.stakeAmount) / game.winningStake;
                    action.payout = uint256(action.stakeAmount) + bonus;
                    distributed += action.payout;
                }
            }

            game.remainder = game.pot - distributed;
            uint256 remainderAssigned;
            for (uint256 i = 0; i < players.length && remainderAssigned < game.remainder; ++i) {
                PlayerAction storage action = _actions[gameId][players[i]];
                if (action.revealed && action.revealedPacket == winnerPacket) {
                    ++action.payout;
                    ++remainderAssigned;
                }
            }
        }

        game.settled = true;
        game.outstandingPrize = game.pot;

        emit GameSettled(
            gameId,
            counts,
            game.winnerPacket,
            game.winnerCount,
            game.pot,
            game.winningStake,
            game.losingPot,
            game.remainder
        );
    }

    function claim(uint256 gameId, address payable recipient) external nonReentrant {
        Game storage game = _getGame(gameId);
        Phase currentPhase = phase(gameId);
        if (currentPhase != Phase.Settled && currentPhase != Phase.Cancelled) revert InvalidPhase();
        if (recipient == address(0)) revert InvalidPlayer();

        PlayerAction storage action = _actions[gameId][msg.sender];
        if (!action.joined || action.payout == 0) revert NoPrize();
        if (action.claimed) revert AlreadyClaimed();

        uint256 amount = action.payout;
        action.claimed = true;
        game.outstandingPrize -= amount;

        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit PrizeClaimed(gameId, msg.sender, recipient, amount);
    }

    function phase(uint256 gameId) public view returns (Phase) {
        Game storage game = _getGame(gameId);
        if (game.cancelled) return Phase.Cancelled;
        if (game.settled) return Phase.Settled;
        if (block.number < game.startBlock || game.playerCount < MIN_PLAYERS) return Phase.Lobby;
        if (block.number < game.signalEndBlock) return Phase.Signal;
        if (block.number < game.commitEndBlock) return Phase.Commit;
        if (block.number < game.revealEndBlock) return Phase.Reveal;
        return Phase.AwaitingSettlement;
    }

    function makeCommitment(
        uint256 gameId,
        address player,
        uint8 packetId,
        bytes32 salt
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                COMMIT_TYPEHASH,
                block.chainid,
                address(this),
                gameId,
                player,
                packetId,
                salt
            )
        );
    }

    function getGame(uint256 gameId) external view returns (Game memory) {
        return _getGame(gameId);
    }

    function getPlayers(uint256 gameId) external view returns (address[] memory) {
        _getGame(gameId);
        return _players[gameId];
    }

    function getPlayerAction(uint256 gameId, address player) external view returns (PlayerAction memory) {
        _getGame(gameId);
        return _actions[gameId][player];
    }

    function getRevealedCounts(uint256 gameId) external view returns (uint8[PACKET_COUNT] memory) {
        _getGame(gameId);
        return _revealedCounts[gameId];
    }

    function _cancel(uint256 gameId, Game storage game) private {
        game.cancelled = true;
        game.outstandingPrize = game.pot;
        _assignRefunds(gameId);
        emit GameCancelled(gameId);
    }

    function _assignRefunds(uint256 gameId) private {
        address[] storage players = _players[gameId];
        for (uint256 i = 0; i < players.length; ++i) {
            PlayerAction storage action = _actions[gameId][players[i]];
            action.payout = action.stakeAmount;
        }
    }

    function _getGame(uint256 gameId) private view returns (Game storage game) {
        game = _games[gameId];
        if (!game.exists) revert GameNotFound();
    }

    function _schedule(Game storage game, uint256 startBlock) private {
        uint256 revealEnd = startBlock + signalDuration + commitDuration + revealDuration;
        if (revealEnd > type(uint64).max) revert InvalidDuration();

        game.joinEndBlock = uint64(startBlock);
        game.startBlock = uint64(startBlock);
        game.signalEndBlock = uint64(startBlock + signalDuration);
        game.commitEndBlock = uint64(startBlock + signalDuration + commitDuration);
        game.revealEndBlock = uint64(revealEnd);
    }

    function _requirePacket(uint8 packetId) private pure {
        if (packetId >= PACKET_COUNT) revert InvalidPacket();
    }
}
