// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

/// @title Minority Red Packet
/// @notice A four-packet, commit-reveal minority game with per-game native MON escrow.
contract MinorityRedPacket {
    uint8 public constant PACKET_COUNT = 4;
    uint8 public constant MIN_PLAYERS = 4;
    uint8 public constant MAX_PLAYERS = 8;
    uint8 public constant NO_WINNER = type(uint8).max;

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
        address host;
        uint64 joinEndBlock;
        uint64 startBlock;
        uint64 signalEndBlock;
        uint64 commitEndBlock;
        uint64 revealEndBlock;
        uint64 claimEndBlock;
        uint8 playerCount;
        uint8 winnerPacket;
        uint8 winnerCount;
        bool started;
        bool settled;
        bool cancelled;
        uint96[PACKET_COUNT] packetAmounts;
        uint256 deposit;
        uint256 share;
        uint256 hostRefund;
        uint256 outstandingPrize;
    }

    struct PlayerAction {
        bytes32 commitment;
        uint8 signalPacket;
        uint8 revealedPacket;
        bool joined;
        bool hasSignaled;
        bool revealed;
        bool claimed;
    }

    error GameNotFound();
    error InvalidDuration();
    error InvalidPacketAmounts();
    error IncorrectFunding();
    error NotHost();
    error InvalidPhase();
    error InvalidPacket();
    error InvalidPlayer();
    error DuplicatePlayer();
    error PlayerLimitReached();
    error TooFewPlayers();
    error NotPlayer();
    error MissingSignal();
    error InvalidCommitment();
    error AlreadyCommitted();
    error AlreadyRevealed();
    error CommitmentMismatch();
    error NoPrize();
    error AlreadyClaimed();
    error ClaimExpired();
    error ClaimNotExpired();
    error NothingToWithdraw();
    error TransferFailed();
    error ReentrantCall();

    event GameCreated(
        uint256 indexed gameId,
        address indexed host,
        uint96[PACKET_COUNT] packetAmounts,
        uint256 deposit,
        uint64 joinEndBlock
    );
    event PlayersRegistered(uint256 indexed gameId, address[] players);
    event GameStarted(
        uint256 indexed gameId,
        uint64 startBlock,
        uint64 signalEndBlock,
        uint64 commitEndBlock,
        uint64 revealEndBlock
    );
    event SignalUpdated(uint256 indexed gameId, address indexed player, uint8 packetId);
    event ChoiceCommitted(uint256 indexed gameId, address indexed player, bytes32 commitment);
    event ChoiceRevealed(uint256 indexed gameId, address indexed player, uint8 packetId);
    event GameSettled(
        uint256 indexed gameId,
        uint8[PACKET_COUNT] counts,
        uint8 winnerPacket,
        uint8 winnerCount,
        uint256 share,
        uint256 hostRefund,
        uint64 claimEndBlock
    );
    event GameCancelled(uint256 indexed gameId);
    event PrizeClaimed(uint256 indexed gameId, address indexed player, address indexed recipient, uint256 amount);
    event HostRefundWithdrawn(uint256 indexed gameId, address indexed recipient, uint256 amount);
    event ExpiredPrizeSwept(uint256 indexed gameId, address indexed recipient, uint256 amount);

    uint64 public immutable signalDuration;
    uint64 public immutable commitDuration;
    uint64 public immutable revealDuration;
    uint64 public immutable claimDuration;

    uint256 public nextGameId = 1;

    mapping(uint256 gameId => Game game) private _games;
    mapping(uint256 gameId => address[] players) private _players;
    mapping(uint256 gameId => mapping(address player => PlayerAction action)) private _actions;

    uint256 private _lock = 1;

    modifier nonReentrant() {
        if (_lock != 1) revert ReentrantCall();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(uint64 signalBlocks, uint64 commitBlocks, uint64 revealBlocks, uint64 claimBlocks) {
        if (signalBlocks == 0 || commitBlocks == 0 || revealBlocks == 0 || claimBlocks == 0) {
            revert InvalidDuration();
        }
        signalDuration = signalBlocks;
        commitDuration = commitBlocks;
        revealDuration = revealBlocks;
        claimDuration = claimBlocks;
    }

    function createGame(
        uint96[PACKET_COUNT] calldata packetAmounts,
        uint64 lobbyBlocks
    ) external payable returns (uint256 gameId) {
        if (lobbyBlocks == 0 || block.number + lobbyBlocks > type(uint64).max) revert InvalidDuration();

        uint256 total;
        for (uint8 i = 0; i < PACKET_COUNT; ++i) {
            // The smallest packet must still pay at least one wei to every possible winner.
            if (packetAmounts[i] < MAX_PLAYERS || (i > 0 && packetAmounts[i] <= packetAmounts[i - 1])) {
                revert InvalidPacketAmounts();
            }
            total += packetAmounts[i];
        }
        if (msg.value != total) revert IncorrectFunding();

        gameId = nextGameId++;
        Game storage game = _games[gameId];
        game.host = msg.sender;
        game.joinEndBlock = uint64(block.number + lobbyBlocks);
        game.winnerPacket = NO_WINNER;
        game.packetAmounts = packetAmounts;
        game.deposit = msg.value;

        emit GameCreated(gameId, msg.sender, packetAmounts, msg.value, game.joinEndBlock);
    }

    function registerPlayers(uint256 gameId, address[] calldata players) external {
        Game storage game = _getGame(gameId);
        if (msg.sender != game.host) revert NotHost();
        if (phase(gameId) != Phase.Lobby || block.number >= game.joinEndBlock) revert InvalidPhase();
        if (players.length == 0 || game.playerCount + players.length > MAX_PLAYERS) revert PlayerLimitReached();

        for (uint256 i = 0; i < players.length; ++i) {
            address player = players[i];
            if (player == address(0)) revert InvalidPlayer();
            if (_actions[gameId][player].joined) revert DuplicatePlayer();

            _actions[gameId][player].joined = true;
            _players[gameId].push(player);
        }
        game.playerCount += uint8(players.length);

        emit PlayersRegistered(gameId, players);
    }

    function startGame(uint256 gameId) external {
        Game storage game = _getGame(gameId);
        if (msg.sender != game.host) revert NotHost();
        if (phase(gameId) != Phase.Lobby || block.number >= game.joinEndBlock) revert InvalidPhase();
        if (game.playerCount < MIN_PLAYERS) revert TooFewPlayers();

        uint256 revealEnd = block.number + signalDuration + commitDuration + revealDuration;
        if (revealEnd > type(uint64).max) revert InvalidDuration();

        game.started = true;
        game.startBlock = uint64(block.number);
        game.signalEndBlock = uint64(block.number + signalDuration);
        game.commitEndBlock = uint64(block.number + signalDuration + commitDuration);
        game.revealEndBlock = uint64(revealEnd);

        emit GameStarted(
            gameId,
            game.startBlock,
            game.signalEndBlock,
            game.commitEndBlock,
            game.revealEndBlock
        );
    }

    function cancelGame(uint256 gameId) external {
        Game storage game = _getGame(gameId);
        if (msg.sender != game.host) revert NotHost();
        if (phase(gameId) != Phase.Lobby) revert InvalidPhase();
        _cancel(gameId, game);
    }

    function expireGame(uint256 gameId) external {
        Game storage game = _getGame(gameId);
        if (game.started || game.cancelled || game.settled || block.number < game.joinEndBlock) {
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

        action.revealedPacket = packetId;
        action.revealed = true;
        emit ChoiceRevealed(gameId, msg.sender, packetId);
    }

    function settle(uint256 gameId) external {
        Game storage game = _getGame(gameId);
        if (phase(gameId) != Phase.AwaitingSettlement) revert InvalidPhase();

        uint8[PACKET_COUNT] memory counts;
        address[] storage players = _players[gameId];
        for (uint256 i = 0; i < players.length; ++i) {
            PlayerAction storage action = _actions[gameId][players[i]];
            if (action.revealed) ++counts[action.revealedPacket];
        }

        uint8 nonEmpty;
        for (uint8 i = 0; i < PACKET_COUNT; ++i) {
            if (counts[i] > 0) ++nonEmpty;
        }

        game.settled = true;
        if (nonEmpty <= 1) {
            game.hostRefund = game.deposit;
        } else {
            uint8 winner = NO_WINNER;
            uint8 minimum = type(uint8).max;
            for (uint8 i = 0; i < PACKET_COUNT; ++i) {
                uint8 count = counts[i];
                if (count == 0) continue;
                if (count < minimum || (count == minimum && game.packetAmounts[i] > game.packetAmounts[winner])) {
                    winner = i;
                    minimum = count;
                }
            }

            uint256 share = uint256(game.packetAmounts[winner]) / minimum;
            uint256 allocatedPrize = share * minimum;
            game.winnerPacket = winner;
            game.winnerCount = minimum;
            game.share = share;
            game.outstandingPrize = allocatedPrize;
            game.hostRefund = game.deposit - allocatedPrize;
            game.claimEndBlock = _claimEndBlock();
        }

        emit GameSettled(
            gameId,
            counts,
            game.winnerPacket,
            game.winnerCount,
            game.share,
            game.hostRefund,
            game.claimEndBlock
        );
    }

    function claim(uint256 gameId, address payable recipient) external nonReentrant {
        Game storage game = _getGame(gameId);
        if (!game.settled || game.winnerPacket == NO_WINNER) revert NoPrize();
        if (recipient == address(0)) revert InvalidPlayer();
        if (block.number >= game.claimEndBlock) revert ClaimExpired();

        PlayerAction storage action = _actions[gameId][msg.sender];
        if (!action.revealed || action.revealedPacket != game.winnerPacket) revert NoPrize();
        if (action.claimed) revert AlreadyClaimed();

        action.claimed = true;
        game.outstandingPrize -= game.share;
        _send(recipient, game.share);

        emit PrizeClaimed(gameId, msg.sender, recipient, game.share);
    }

    function withdrawHostRefund(uint256 gameId, address payable recipient) external nonReentrant {
        Game storage game = _getGame(gameId);
        if (msg.sender != game.host) revert NotHost();
        if ((!game.settled && !game.cancelled) || recipient == address(0)) revert InvalidPhase();

        uint256 amount = game.hostRefund;
        if (amount == 0) revert NothingToWithdraw();
        game.hostRefund = 0;
        _send(recipient, amount);

        emit HostRefundWithdrawn(gameId, recipient, amount);
    }

    function sweepExpiredPrize(uint256 gameId, address payable recipient) external nonReentrant {
        Game storage game = _getGame(gameId);
        if (msg.sender != game.host) revert NotHost();
        if (!game.settled || game.winnerPacket == NO_WINNER || recipient == address(0)) revert NoPrize();
        if (block.number < game.claimEndBlock) revert ClaimNotExpired();

        uint256 amount = game.outstandingPrize;
        if (amount == 0) revert NothingToWithdraw();
        game.outstandingPrize = 0;
        _send(recipient, amount);

        emit ExpiredPrizeSwept(gameId, recipient, amount);
    }

    function phase(uint256 gameId) public view returns (Phase) {
        Game storage game = _getGame(gameId);
        if (game.cancelled) return Phase.Cancelled;
        if (game.settled) return Phase.Settled;
        if (!game.started) {
            return Phase.Lobby;
        }
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
        return keccak256(abi.encode(COMMIT_TYPEHASH, block.chainid, address(this), gameId, player, packetId, salt));
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

    function getRevealedCounts(uint256 gameId) external view returns (uint8[PACKET_COUNT] memory counts) {
        _getGame(gameId);
        address[] storage players = _players[gameId];
        for (uint256 i = 0; i < players.length; ++i) {
            PlayerAction storage action = _actions[gameId][players[i]];
            if (action.revealed) ++counts[action.revealedPacket];
        }
    }

    function _cancel(uint256 gameId, Game storage game) private {
        game.cancelled = true;
        game.hostRefund = game.deposit;
        emit GameCancelled(gameId);
    }

    function _claimEndBlock() private view returns (uint64) {
        uint256 endBlock = block.number + claimDuration;
        if (endBlock > type(uint64).max) revert InvalidDuration();
        return uint64(endBlock);
    }

    function _getGame(uint256 gameId) private view returns (Game storage game) {
        game = _games[gameId];
        if (game.host == address(0)) revert GameNotFound();
    }

    function _requirePacket(uint8 packetId) private pure {
        if (packetId >= PACKET_COUNT) revert InvalidPacket();
    }

    function _send(address payable recipient, uint256 amount) private {
        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
    }
}
