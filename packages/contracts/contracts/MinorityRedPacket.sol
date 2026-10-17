// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

/// @title Minority Red Packet
/// @notice A persistent-room, four-packet commit-reveal minority game.
contract MinorityRedPacket {
    uint8 public constant PACKET_COUNT = 4;
    uint8 public constant MIN_PLAYERS = 4;
    uint8 public constant MAX_PLAYERS = 8;
    uint8 public constant NO_WINNER = type(uint8).max;
    uint96 public constant MIN_STAKE = 1 ether;
    uint96 public constant MAX_STAKE = 10 ether;

    bytes32 public constant COMMIT_TYPEHASH = keccak256(
        "MinorityRedPacketCommit(uint256 chainId,address verifyingContract,uint256 gameId,uint64 roundNumber,address player,uint8 packetId,bytes32 salt)"
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

    struct Room {
        uint64 currentRound;
        bool exists;
        uint256 outstandingPrize;
    }

    struct Game {
        uint64 roundNumber;
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
    }

    struct PlayerAction {
        uint96 stakeAmount;
        bytes32 commitment;
        uint8 signalPacket;
        uint8 revealedPacket;
        bool joined;
        bool hasSignaled;
        bool revealed;
        uint256 payout;
    }

    error GameNotFound();
    error RoundNotFound();
    error InvalidDuration();
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
    error TransferFailed();
    error ReentrantCall();

    event GameCreated(uint256 indexed gameId, uint64 startBlock);
    event RoundOpened(uint256 indexed gameId, uint64 indexed roundNumber, uint64 startBlock);
    event PlayerJoined(
        uint256 indexed gameId,
        uint64 indexed roundNumber,
        address indexed player,
        uint8 registrationIndex,
        uint96 stakeAmount
    );
    event SignalUpdated(uint256 indexed gameId, uint64 indexed roundNumber, address indexed player, uint8 packetId);
    event ChoiceCommitted(uint256 indexed gameId, uint64 indexed roundNumber, address indexed player, bytes32 commitment);
    event ChoiceRevealed(uint256 indexed gameId, uint64 indexed roundNumber, address indexed player, uint8 packetId);
    event GameSettled(
        uint256 indexed gameId,
        uint64 indexed roundNumber,
        uint8[PACKET_COUNT] counts,
        uint8 winnerPacket,
        uint8 winnerCount,
        uint256 pot,
        uint256 winningStake,
        uint256 losingPot,
        uint256 remainder
    );
    event GameCancelled(uint256 indexed gameId, uint64 indexed roundNumber);
    event PrizeClaimed(uint256 indexed gameId, address indexed player, address indexed recipient, uint256 amount);

    uint64 public immutable signalDuration;
    uint64 public immutable commitDuration;
    uint64 public immutable revealDuration;

    uint256 public nextGameId = 1;

    mapping(uint256 gameId => Room room) private _rooms;
    mapping(uint256 gameId => mapping(uint64 roundNumber => Game game)) private _games;
    mapping(uint256 gameId => mapping(uint64 roundNumber => address[] players)) private _players;
    mapping(uint256 gameId => mapping(uint64 roundNumber => mapping(address player => PlayerAction action))) private _actions;
    mapping(uint256 gameId => mapping(uint64 roundNumber => uint8[PACKET_COUNT] counts)) private _revealedCounts;
    mapping(uint256 gameId => mapping(address player => uint256 amount)) private _claimable;

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

    /// @dev The legacy name is retained because gameId is the public room number.
    function createGame(uint64 lobbyBlocks) external returns (uint256 gameId) {
        if (lobbyBlocks == 0) revert InvalidDuration();

        gameId = nextGameId++;
        Room storage room = _rooms[gameId];
        room.exists = true;
        room.currentRound = 1;
        Game storage game = _openRound(gameId, 1, lobbyBlocks);

        emit GameCreated(gameId, game.startBlock);
    }

    function openNextRound(uint256 gameId, uint64 lobbyBlocks) external returns (uint64 roundNumber) {
        if (lobbyBlocks == 0) revert InvalidDuration();
        Room storage room = _getRoom(gameId);
        Game storage current = _games[gameId][room.currentRound];
        if (!current.settled && !current.cancelled) revert InvalidPhase();

        roundNumber = room.currentRound + 1;
        room.currentRound = roundNumber;
        _openRound(gameId, roundNumber, lobbyBlocks);
    }

    function joinGame(uint256 gameId) external payable {
        (uint64 roundNumber, Game storage game) = _getCurrentGame(gameId);
        if (phase(gameId) != Phase.Lobby || block.number >= game.startBlock) revert InvalidPhase();
        if (msg.value < MIN_STAKE || msg.value > MAX_STAKE || msg.value % 1 ether != 0) {
            revert IncorrectFunding();
        }

        PlayerAction storage action = _actions[gameId][roundNumber][msg.sender];
        if (action.joined) revert DuplicatePlayer();
        if (game.playerCount >= MAX_PLAYERS) revert PlayerLimitReached();

        action.joined = true;
        action.stakeAmount = uint96(msg.value);
        _players[gameId][roundNumber].push(msg.sender);
        uint8 registrationIndex = game.playerCount;
        game.playerCount = registrationIndex + 1;
        game.pot += msg.value;

        if (game.playerCount == MAX_PLAYERS) {
            _schedule(game, block.number + 1);
        }

        emit PlayerJoined(gameId, roundNumber, msg.sender, registrationIndex, uint96(msg.value));
    }

    function expireGame(uint256 gameId) external {
        (uint64 roundNumber, Game storage game) = _getCurrentGame(gameId);
        if (
            game.cancelled ||
            game.settled ||
            game.playerCount >= MIN_PLAYERS ||
            block.number < game.startBlock
        ) {
            revert InvalidPhase();
        }
        _cancel(gameId, roundNumber, game);
    }

    function signalChoice(uint256 gameId, uint8 packetId) external {
        if (phase(gameId) != Phase.Signal) revert InvalidPhase();
        _requirePacket(packetId);
        uint64 roundNumber = _rooms[gameId].currentRound;

        PlayerAction storage action = _actions[gameId][roundNumber][msg.sender];
        if (!action.joined) revert NotPlayer();
        action.signalPacket = packetId;
        action.hasSignaled = true;

        emit SignalUpdated(gameId, roundNumber, msg.sender, packetId);
    }

    function commitChoice(uint256 gameId, bytes32 commitment) external {
        if (phase(gameId) != Phase.Commit) revert InvalidPhase();
        if (commitment == bytes32(0)) revert InvalidCommitment();
        uint64 roundNumber = _rooms[gameId].currentRound;

        PlayerAction storage action = _actions[gameId][roundNumber][msg.sender];
        if (!action.joined) revert NotPlayer();
        if (!action.hasSignaled) revert MissingSignal();
        if (action.commitment != bytes32(0)) revert AlreadyCommitted();

        action.commitment = commitment;
        emit ChoiceCommitted(gameId, roundNumber, msg.sender, commitment);
    }

    function revealChoice(uint256 gameId, uint8 packetId, bytes32 salt) external {
        if (phase(gameId) != Phase.Reveal) revert InvalidPhase();
        _requirePacket(packetId);
        uint64 roundNumber = _rooms[gameId].currentRound;

        PlayerAction storage action = _actions[gameId][roundNumber][msg.sender];
        if (!action.joined) revert NotPlayer();
        if (action.commitment == bytes32(0)) revert InvalidCommitment();
        if (action.revealed) revert AlreadyRevealed();
        if (action.commitment != makeCommitment(gameId, msg.sender, packetId, salt)) {
            revert CommitmentMismatch();
        }

        action.revealed = true;
        action.revealedPacket = packetId;
        ++_revealedCounts[gameId][roundNumber][packetId];

        emit ChoiceRevealed(gameId, roundNumber, msg.sender, packetId);
    }

    function settle(uint256 gameId) external {
        if (phase(gameId) != Phase.AwaitingSettlement) revert InvalidPhase();
        (uint64 roundNumber, Game storage game) = _getCurrentGame(gameId);
        uint8[PACKET_COUNT] memory counts = _revealedCounts[gameId][roundNumber];

        uint8 nonEmptyPackets;
        for (uint8 packetId = 0; packetId < PACKET_COUNT; ++packetId) {
            if (counts[packetId] > 0) ++nonEmptyPackets;
        }

        if (nonEmptyPackets <= 1) {
            _assignRefunds(gameId, roundNumber);
        } else {
            uint8 winnerPacket;
            uint8 winnerCount = type(uint8).max;
            for (uint8 packetId = 0; packetId < PACKET_COUNT; ++packetId) {
                uint8 count = counts[packetId];
                if (count > 0 && count <= winnerCount) {
                    winnerPacket = packetId;
                    winnerCount = count;
                }
            }

            game.winnerPacket = winnerPacket;
            game.winnerCount = winnerCount;
            address[] storage players = _players[gameId][roundNumber];
            for (uint256 i = 0; i < players.length; ++i) {
                PlayerAction storage action = _actions[gameId][roundNumber][players[i]];
                if (action.revealed && action.revealedPacket == winnerPacket) {
                    game.winningStake += action.stakeAmount;
                }
            }
            game.losingPot = game.pot - game.winningStake;

            uint256 distributed;
            for (uint256 i = 0; i < players.length; ++i) {
                PlayerAction storage action = _actions[gameId][roundNumber][players[i]];
                if (action.revealed && action.revealedPacket == winnerPacket) {
                    uint256 bonus = (game.losingPot * action.stakeAmount) / game.winningStake;
                    action.payout = uint256(action.stakeAmount) + bonus;
                    distributed += action.payout;
                }
            }

            game.remainder = game.pot - distributed;
            uint256 remainderAssigned;
            for (uint256 i = 0; i < players.length && remainderAssigned < game.remainder; ++i) {
                PlayerAction storage action = _actions[gameId][roundNumber][players[i]];
                if (action.revealed && action.revealedPacket == winnerPacket) {
                    ++action.payout;
                    ++remainderAssigned;
                }
            }
        }

        game.settled = true;
        _creditPayouts(gameId, roundNumber, game.pot);

        emit GameSettled(
            gameId,
            roundNumber,
            counts,
            game.winnerPacket,
            game.winnerCount,
            game.pot,
            game.winningStake,
            game.losingPot,
            game.remainder
        );
    }

    /// @notice Claims all settled, unclaimed round payouts for the caller in this room.
    function claim(uint256 gameId, address payable recipient) external nonReentrant {
        Room storage room = _getRoom(gameId);
        if (recipient == address(0)) revert InvalidPlayer();

        uint256 amount = _claimable[gameId][msg.sender];
        if (amount == 0) revert NoPrize();
        _claimable[gameId][msg.sender] = 0;
        room.outstandingPrize -= amount;

        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit PrizeClaimed(gameId, msg.sender, recipient, amount);
    }

    function phase(uint256 gameId) public view returns (Phase) {
        Room storage room = _getRoom(gameId);
        return _phase(_games[gameId][room.currentRound]);
    }

    function makeCommitment(
        uint256 gameId,
        address player,
        uint8 packetId,
        bytes32 salt
    ) public view returns (bytes32) {
        Room storage room = _getRoom(gameId);
        return keccak256(
            abi.encode(
                COMMIT_TYPEHASH,
                block.chainid,
                address(this),
                gameId,
                room.currentRound,
                player,
                packetId,
                salt
            )
        );
    }

    function getCurrentRound(uint256 gameId) external view returns (uint64) {
        return _getRoom(gameId).currentRound;
    }

    function getRoom(uint256 gameId) external view returns (Room memory) {
        return _getRoom(gameId);
    }

    function claimable(uint256 gameId, address player) external view returns (uint256) {
        _getRoom(gameId);
        return _claimable[gameId][player];
    }

    function getGame(uint256 gameId) external view returns (Game memory) {
        (, Game storage game) = _getCurrentGame(gameId);
        return game;
    }

    function getPlayers(uint256 gameId) external view returns (address[] memory) {
        Room storage room = _getRoom(gameId);
        return _players[gameId][room.currentRound];
    }

    function getPlayerAction(uint256 gameId, address player) external view returns (PlayerAction memory) {
        Room storage room = _getRoom(gameId);
        return _actions[gameId][room.currentRound][player];
    }

    function getRevealedCounts(uint256 gameId) external view returns (uint8[PACKET_COUNT] memory) {
        Room storage room = _getRoom(gameId);
        return _revealedCounts[gameId][room.currentRound];
    }

    function getRound(uint256 gameId, uint64 roundNumber) external view returns (Game memory) {
        return _getRound(gameId, roundNumber);
    }

    function getRoundPlayers(uint256 gameId, uint64 roundNumber) external view returns (address[] memory) {
        _getRound(gameId, roundNumber);
        return _players[gameId][roundNumber];
    }

    function getRoundPlayerAction(uint256 gameId, uint64 roundNumber, address player) external view returns (PlayerAction memory) {
        _getRound(gameId, roundNumber);
        return _actions[gameId][roundNumber][player];
    }

    function getRoundRevealedCounts(uint256 gameId, uint64 roundNumber) external view returns (uint8[PACKET_COUNT] memory) {
        _getRound(gameId, roundNumber);
        return _revealedCounts[gameId][roundNumber];
    }

    function _cancel(uint256 gameId, uint64 roundNumber, Game storage game) private {
        game.cancelled = true;
        _assignRefunds(gameId, roundNumber);
        _creditPayouts(gameId, roundNumber, game.pot);
        emit GameCancelled(gameId, roundNumber);
    }

    function _assignRefunds(uint256 gameId, uint64 roundNumber) private {
        address[] storage players = _players[gameId][roundNumber];
        for (uint256 i = 0; i < players.length; ++i) {
            PlayerAction storage action = _actions[gameId][roundNumber][players[i]];
            action.payout = action.stakeAmount;
        }
    }

    function _creditPayouts(uint256 gameId, uint64 roundNumber, uint256 total) private {
        Room storage room = _rooms[gameId];
        address[] storage players = _players[gameId][roundNumber];
        for (uint256 i = 0; i < players.length; ++i) {
            PlayerAction storage action = _actions[gameId][roundNumber][players[i]];
            if (action.payout > 0) {
                _claimable[gameId][players[i]] += action.payout;
            }
        }
        room.outstandingPrize += total;
    }

    function _openRound(uint256 gameId, uint64 roundNumber, uint64 lobbyBlocks) private returns (Game storage game) {
        game = _games[gameId][roundNumber];
        game.exists = true;
        game.roundNumber = roundNumber;
        game.winnerPacket = NO_WINNER;
        _schedule(game, block.number + lobbyBlocks);
        emit RoundOpened(gameId, roundNumber, game.startBlock);
    }

    function _getRoom(uint256 gameId) private view returns (Room storage room) {
        room = _rooms[gameId];
        if (!room.exists) revert GameNotFound();
    }

    function _getCurrentGame(uint256 gameId) private view returns (uint64 roundNumber, Game storage game) {
        Room storage room = _getRoom(gameId);
        roundNumber = room.currentRound;
        game = _games[gameId][roundNumber];
    }

    function _getRound(uint256 gameId, uint64 roundNumber) private view returns (Game storage game) {
        _getRoom(gameId);
        game = _games[gameId][roundNumber];
        if (!game.exists) revert RoundNotFound();
    }

    function _phase(Game storage game) private view returns (Phase) {
        if (game.cancelled) return Phase.Cancelled;
        if (game.settled) return Phase.Settled;
        if (block.number < game.startBlock || game.playerCount < MIN_PLAYERS) return Phase.Lobby;
        if (block.number < game.signalEndBlock) return Phase.Signal;
        if (block.number < game.commitEndBlock) return Phase.Commit;
        if (block.number < game.revealEndBlock) return Phase.Reveal;
        return Phase.AwaitingSettlement;
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
