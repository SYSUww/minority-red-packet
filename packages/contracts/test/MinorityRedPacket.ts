import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import {
  encodeAbiParameters,
  keccak256,
  parseEther,
  parseAbiParameters,
  toHex,
  type Address,
} from "viem";

const GAME_ID = 1n;
const STAKE = parseEther("1");
const SIGNAL_BLOCKS = 12n;
const COMMIT_BLOCKS = 12n;
const REVEAL_BLOCKS = 12n;

describe("MinorityRedPacket", async function () {
  const { viem } = await network.getOrCreate();
  const publicClient = await viem.getPublicClient();
  const testClient = await viem.getTestClient();

  async function deploy() {
    const wallets = await viem.getWalletClients();
    const contract = await viem.deployContract("MinorityRedPacket", [
      SIGNAL_BLOCKS,
      COMMIT_BLOCKS,
      REVEAL_BLOCKS,
    ]);
    return { contract, wallets };
  }

  async function contractFor(
    address: Address,
    wallet: Awaited<ReturnType<typeof viem.getWalletClients>>[number],
  ) {
    return viem.getContractAt("MinorityRedPacket", address, {
      client: { wallet },
    });
  }

  async function mineTo(target: bigint) {
    const current = await publicClient.getBlockNumber();
    if (current < target) {
      await testClient.mine({ blocks: Number(target - current) });
    }
  }

  async function createStartedGame(playerCount: number, stakes = Array<bigint>(playerCount).fill(STAKE)) {
    const { contract, wallets } = await deploy();
    const players = wallets.slice(1, playerCount + 1);

    await contract.write.createGame([100n]);
    const playerContracts = await Promise.all(
      players.map((wallet) => contractFor(contract.address, wallet)),
    );
    for (let i = 0; i < playerContracts.length; i++) {
      await playerContracts[i].write.joinGame([GAME_ID], { value: stakes[i] });
    }
    const game = await contract.read.getGame([GAME_ID]);
    await mineTo(game.startBlock);

    return { contract, wallets, players, playerContracts };
  }

  async function playThroughReveal(
    contract: any,
    players: Awaited<ReturnType<typeof viem.getWalletClients>>,
    playerContracts: any[],
    choices: readonly number[],
    revealCount = choices.length,
    signals: readonly number[] = choices,
  ) {
    const salts = choices.map((_, index) => toHex(index + 1, { size: 32 }));

    for (let i = 0; i < players.length; i++) {
      await playerContracts[i].write.signalChoice([GAME_ID, signals[i]]);
    }

    let game = await contract.read.getGame([GAME_ID]);
    await mineTo(game.signalEndBlock);

    for (let i = 0; i < players.length; i++) {
      const commitment = await contract.read.makeCommitment([
        GAME_ID,
        players[i].account.address,
        choices[i],
        salts[i],
      ]);
      await playerContracts[i].write.commitChoice([GAME_ID, commitment]);
    }

    game = await contract.read.getGame([GAME_ID]);
    await mineTo(game.commitEndBlock);

    for (let i = 0; i < revealCount; i++) {
      await playerContracts[i].write.revealChoice([GAME_ID, choices[i], salts[i]]);
    }

    game = await contract.read.getGame([GAME_ID]);
    await mineTo(game.revealEndBlock);
    return salts;
  }

  it("creates a hostless room and automatically starts when its eight seats are filled", async function () {
    const { contract, wallets } = await deploy();

    await contract.write.createGame([100n]);
    assert.equal(await publicClient.getBalance({ address: contract.address }), 0n);
    const scheduledStart = (await contract.read.getGame([GAME_ID])).startBlock;

    const players = await Promise.all(
      wallets.slice(1, 10).map((wallet) => contractFor(contract.address, wallet)),
    );

    await assert.rejects(players[0].write.joinGame([GAME_ID], { value: STAKE - 1n }));
    await assert.rejects(players[0].write.joinGame([GAME_ID], { value: STAKE + 1n }));

    for (let i = 0; i < 8; i++) {
      await players[i].write.joinGame([GAME_ID], { value: STAKE });
    }

    await assert.rejects(players[0].write.joinGame([GAME_ID], { value: STAKE }));
    await assert.rejects(players[8].write.joinGame([GAME_ID], { value: STAKE }));

    const game = await contract.read.getGame([GAME_ID]);
    assert.equal(game.playerCount, 8);
    assert.equal(game.pot, 8n * STAKE);
    assert.deepEqual(
      (await contract.read.getPlayers([GAME_ID])).map((address) => address.toLowerCase()),
      wallets.slice(1, 9).map((wallet) => wallet.account.address),
    );

    assert.equal(game.exists, true);
    assert.equal(game.startBlock, game.joinEndBlock);
    assert.ok(game.startBlock < scheduledStart);
    await mineTo(game.startBlock);
    assert.equal(await contract.read.phase([GAME_ID]), 1);
  });

  it("lets the room creator join later under the same rules as every player", async function () {
    const { contract, wallets } = await deploy();

    await contract.write.createGame([100n]);
    await contract.write.joinGame([GAME_ID], { value: STAKE });

    const game = await contract.read.getGame([GAME_ID]);
    const creator = await contract.read.getPlayerAction([
      GAME_ID,
      wallets[0].account.address,
    ]);
    assert.equal(creator.joined, true);
    assert.equal(creator.stakeAmount, STAKE);
    assert.equal(game.playerCount, 1);
    assert.equal(game.pot, STAKE);
  });

  it("distributes the whole pot and gives remainder wei to winners in registration order", async function () {
    const { contract, wallets, players, playerContracts } = await createStartedGame(8);
    // Seven reveals produce [4, 3, 0, 0]; the final player's unrevealed stake stays in the pot.
    const choices = [0, 0, 0, 0, 1, 1, 1, 3] as const;
    await playThroughReveal(contract, players, playerContracts, choices, 7);

    const outsider = await contractFor(contract.address, wallets[10]);
    await outsider.write.settle([GAME_ID]);

    const game = await contract.read.getGame([GAME_ID]);
    assert.equal(game.winnerPacket, 1);
    assert.equal(game.winnerCount, 3);
    assert.equal(game.pot, 8n * STAKE);
    assert.equal(game.winningStake, 3n * STAKE);
    assert.equal(game.losingPot, 5n * STAKE);
    assert.equal(game.remainder, 2n);
    assert.equal((await contract.read.getRoom([GAME_ID])).outstandingPrize, 8n * STAKE);
    assert.deepEqual(await contract.read.getRevealedCounts([GAME_ID]), [4, 3, 0, 0]);

    const payouts = await Promise.all(
      players.map(async (player) =>
        (await contract.read.getPlayerAction([GAME_ID, player.account.address])).payout,
      ),
    );
    const basePayout = STAKE + (5n * STAKE) / 3n;
    assert.deepEqual(payouts, [0n, 0n, 0n, 0n, basePayout + 1n, basePayout + 1n, basePayout, 0n]);

    const unrevealed = await contract.read.getPlayerAction([
      GAME_ID,
      players[7].account.address,
    ]);
    assert.equal(unrevealed.signalPacket, 3);
    assert.equal(unrevealed.revealed, false);

    await assert.rejects(playerContracts[0].write.claim([GAME_ID, players[0].account.address]));
    for (const winnerIndex of [4, 5, 6]) {
      await playerContracts[winnerIndex].write.claim([
        GAME_ID,
        players[winnerIndex].account.address,
      ]);
    }
    await assert.rejects(
      playerContracts[4].write.claim([GAME_ID, players[4].account.address]),
    );
    assert.equal(await publicClient.getBalance({ address: contract.address }), 0n);
  });

  it("uses player count for the minority and stake weight for winner payouts", async function () {
    const stakes = [1n, 2n, 3n, 4n, 2n, 6n].map((amount) => amount * STAKE);
    const { contract, players, playerContracts } = await createStartedGame(6, stakes);
    await playThroughReveal(contract, players, playerContracts, [0, 0, 0, 0, 1, 1]);
    await contract.write.settle([GAME_ID]);

    const game = await contract.read.getGame([GAME_ID]);
    assert.equal(game.winnerPacket, 1);
    assert.equal(game.winnerCount, 2);
    assert.equal(game.winningStake, 8n * STAKE);
    assert.equal(game.losingPot, 10n * STAKE);
    assert.equal(game.remainder, 0n);

    const payouts = await Promise.all(
      players.map(async (player) =>
        (await contract.read.getPlayerAction([GAME_ID, player.account.address])).payout,
      ),
    );
    assert.deepEqual(payouts, [0n, 0n, 0n, 0n, 45n * STAKE / 10n, 135n * STAKE / 10n]);
    assert.equal(payouts.reduce((total, payout) => total + payout, 0n), 18n * STAKE);
  });

  it("breaks equal minority counts in favor of the higher packet id", async function () {
    const { contract, players, playerContracts } = await createStartedGame(4);
    await playThroughReveal(contract, players, playerContracts, [0, 0, 1, 2]);
    await contract.write.settle([GAME_ID]);

    const game = await contract.read.getGame([GAME_ID]);
    assert.deepEqual(await contract.read.getRevealedCounts([GAME_ID]), [2, 1, 1, 0]);
    assert.equal(game.winnerPacket, 2);
    assert.equal(game.winnerCount, 1);
    assert.equal(
      (await contract.read.getPlayerAction([GAME_ID, players[3].account.address])).payout,
      4n * STAKE,
    );
  });

  it("refunds every stake when exactly one packet is non-empty and preserves signal/reveal", async function () {
    const { contract, players, playerContracts } = await createStartedGame(4);
    await playThroughReveal(
      contract,
      players,
      playerContracts,
      [1, 1, 1, 1],
      4,
      [0, 0, 2, 3],
    );
    await contract.write.settle([GAME_ID]);

    const game = await contract.read.getGame([GAME_ID]);
    assert.equal(game.winnerPacket, 255);
    assert.equal(game.winnerCount, 0);
    assert.equal((await contract.read.getRoom([GAME_ID])).outstandingPrize, 4n * STAKE);

    const action = await contract.read.getPlayerAction([
      GAME_ID,
      players[0].account.address,
    ]);
    assert.equal(action.signalPacket, 0);
    assert.equal(action.revealedPacket, 1);
    assert.equal(action.payout, STAKE);

    await testClient.mine({ blocks: 10_000 });
    for (let i = 0; i < players.length; i++) {
      await playerContracts[i].write.claim([GAME_ID, players[i].account.address]);
    }
    assert.equal(await publicClient.getBalance({ address: contract.address }), 0n);
  });

  it("refunds every stake when nobody reveals", async function () {
    const { contract, players, playerContracts } = await createStartedGame(4);
    await playThroughReveal(contract, players, playerContracts, [0, 1, 2, 3], 0);
    await contract.write.settle([GAME_ID]);

    assert.deepEqual(await contract.read.getRevealedCounts([GAME_ID]), [0, 0, 0, 0]);
    for (const player of players) {
      assert.equal(
        (await contract.read.getPlayerAction([GAME_ID, player.account.address])).payout,
        STAKE,
      );
    }
  });

  it("lets anyone close an underfilled room after the deadline and refunds every stake", async function () {
    const expired = await deploy();
    await expired.contract.write.createGame([3n]);
    const joinedPlayer = await contractFor(expired.contract.address, expired.wallets[1]);
    await joinedPlayer.write.joinGame([GAME_ID], { value: STAKE });
    const expiredGame = await expired.contract.read.getGame([GAME_ID]);
    await mineTo(expiredGame.joinEndBlock);
    const anyAccount = await contractFor(expired.contract.address, expired.wallets[9]);
    await anyAccount.write.expireGame([GAME_ID]);
    assert.equal(await expired.contract.read.phase([GAME_ID]), 6);
    await joinedPlayer.write.claim([GAME_ID, expired.wallets[1].account.address]);
    assert.equal(await publicClient.getBalance({ address: expired.contract.address }), 0n);
  });

  it("keeps commitments domain-separated by chain, contract, room, round, and player", async function () {
    const { contract, wallets } = await deploy();
    await contract.write.createGame([100n]);
    await contract.write.createGame([100n]);
    const salt = toHex(123456, { size: 32 });
    const typehash = await contract.read.COMMIT_TYPEHASH();
    const chainId = await publicClient.getChainId();
    const player = wallets[1].account.address;

    const expected = keccak256(
      encodeAbiParameters(
        parseAbiParameters(
          "bytes32 typehash, uint256 chainId, address verifyingContract, uint256 gameId, uint64 roundNumber, address player, uint8 packetId, bytes32 salt",
        ),
        [typehash, BigInt(chainId), contract.address, GAME_ID, 1n, player, 2, salt],
      ),
    );

    assert.equal(
      await contract.read.makeCommitment([GAME_ID, player, 2, salt]),
      expected,
    );
    assert.notEqual(
      await contract.read.makeCommitment([GAME_ID, wallets[2].account.address, 2, salt]),
      expected,
    );
    assert.notEqual(
      await contract.read.makeCommitment([GAME_ID + 1n, player, 2, salt]),
      expected,
    );
  });

  it("keeps an underfilled room refundable and enforces half-open action phases", async function () {
    const underfilled = await deploy();
    await underfilled.contract.write.createGame([100n]);
    for (let i = 1; i <= 3; i++) {
      const player = await contractFor(underfilled.contract.address, underfilled.wallets[i]);
      await player.write.joinGame([GAME_ID], { value: STAKE });
    }
    const underfilledGame = await underfilled.contract.read.getGame([GAME_ID]);
    await mineTo(underfilledGame.startBlock);
    assert.equal(await underfilled.contract.read.phase([GAME_ID]), 0);
    await underfilled.contract.write.expireGame([GAME_ID]);
    assert.equal(await underfilled.contract.read.phase([GAME_ID]), 6);

    const { contract, players, playerContracts } = await createStartedGame(4);
    const salt = toHex(77, { size: 32 });
    await playerContracts[0].write.signalChoice([GAME_ID, 1]);

    let game = await contract.read.getGame([GAME_ID]);
    await mineTo(game.signalEndBlock);
    assert.equal(await contract.read.phase([GAME_ID]), 2);
    await assert.rejects(playerContracts[0].write.signalChoice([GAME_ID, 1]));

    const commitment = await contract.read.makeCommitment([
      GAME_ID,
      players[0].account.address,
      1,
      salt,
    ]);
    await playerContracts[0].write.commitChoice([GAME_ID, commitment]);

    game = await contract.read.getGame([GAME_ID]);
    await mineTo(game.commitEndBlock);
    assert.equal(await contract.read.phase([GAME_ID]), 3);
    await assert.rejects(playerContracts[0].write.commitChoice([GAME_ID, commitment]));
    await assert.rejects(
      playerContracts[0].write.revealChoice([GAME_ID, 1, toHex(78, { size: 32 })]),
    );
    await playerContracts[0].write.revealChoice([GAME_ID, 1, salt]);

    game = await contract.read.getGame([GAME_ID]);
    await mineTo(game.revealEndBlock);
    assert.equal(await contract.read.phase([GAME_ID]), 4);
    await assert.rejects(playerContracts[0].write.revealChoice([GAME_ID, 1, salt]));
  });

  it("keeps one room alive across rounds while preserving prior payouts and history", async function () {
    const { contract, players, playerContracts } = await createStartedGame(4);
    await playThroughReveal(contract, players, playerContracts, [0, 0, 1, 2]);
    await contract.write.settle([GAME_ID]);

    const firstRoundWinner = await contract.read.getPlayerAction([
      GAME_ID,
      players[3].account.address,
    ]);
    assert.equal(firstRoundWinner.payout, 4n * STAKE);
    assert.equal(await contract.read.getCurrentRound([GAME_ID]), 1n);

    await contract.write.openNextRound([GAME_ID, 100n]);

    assert.equal(await contract.read.getCurrentRound([GAME_ID]), 2n);
    assert.equal(await contract.read.phase([GAME_ID]), 0);
    assert.deepEqual(await contract.read.getPlayers([GAME_ID]), []);
    assert.equal((await contract.read.getRound([GAME_ID, 1n])).settled, true);
    assert.equal((await contract.read.getRoundPlayers([GAME_ID, 1n])).length, 4);
    assert.equal(
      (await contract.read.getRoundPlayerAction([GAME_ID, 1n, players[3].account.address])).payout,
      4n * STAKE,
    );

    await playerContracts[3].write.claim([GAME_ID, players[3].account.address]);
    assert.equal(await contract.read.claimable([GAME_ID, players[3].account.address]), 0n);
    assert.equal((await contract.read.getRoom([GAME_ID])).outstandingPrize, 0n);

    await playerContracts[3].write.joinGame([GAME_ID], { value: 2n * STAKE });
    const secondRoundAction = await contract.read.getPlayerAction([
      GAME_ID,
      players[3].account.address,
    ]);
    assert.equal(secondRoundAction.joined, true);
    assert.equal(secondRoundAction.stakeAmount, 2n * STAKE);
    assert.equal(secondRoundAction.payout, 0n);
  });
});
