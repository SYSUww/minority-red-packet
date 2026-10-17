import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import type { Address } from "viem";

const GAME_ID = 1n;
const STAKE = 11n;
const SIGNAL_BLOCKS = 12n;
const COMMIT_BLOCKS = 12n;
const REVEAL_BLOCKS = 12n;

describe("MinorityRedPacket", async function () {
  const { viem } = await network.getOrCreate();
  const publicClient = await viem.getPublicClient();

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

  it("creates an unfunded game and lets 4-8 players join with the exact stake", async function () {
    const { contract, wallets } = await deploy();

    await contract.write.createGame([STAKE, 100n]);
    assert.equal(await publicClient.getBalance({ address: contract.address }), 0n);

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
    assert.equal(game.stakeAmount, STAKE);
    assert.equal(game.playerCount, 8);
    assert.equal(game.pot, 8n * STAKE);
    assert.deepEqual(
      await contract.read.getPlayers([GAME_ID]),
      wallets.slice(1, 9).map((wallet) => wallet.account.address),
    );

    const outsider = await contractFor(contract.address, wallets[9]);
    await assert.rejects(outsider.write.startGame([GAME_ID]));
    await contract.write.startGame([GAME_ID]);
  });
});
