import { describe, expect, it, vi } from "vitest";

import { OnchainGameGateway } from "./onchain-game-gateway";

const CONTRACT = "0x1111111111111111111111111111111111111111" as const;
const PLAYER = "0x2222222222222222222222222222222222222222" as const;
const HASH = `0x${"3".repeat(64)}` as const;

function clients(balance = 100n) {
  const publicClient = {
    getBalance: vi.fn(async () => balance),
    getGasPrice: vi.fn(async () => 2n),
    estimateContractGas: vi.fn(async () => 3n),
    simulateContract: vi.fn(async (request) => ({ request })),
    waitForTransactionReceipt: vi.fn(async () => ({ status: "success", blockNumber: 10n })),
    getBlock: vi.fn(async () => ({ number: 10n })),
  };
  const walletClient = {
    account: { address: PLAYER },
    chain: { id: 10_143 },
    writeContract: vi.fn(async () => HASH),
  };
  return { publicClient, walletClient };
}

describe("OnchainGameGateway payment preflight", () => {
  it("checks balance, estimates gas, simulates, then sends the payable join", async () => {
    const { publicClient, walletClient } = clients();
    const gateway = new OnchainGameGateway(CONTRACT, publicClient as never, walletClient as never);

    await gateway.join(1n, 10n);

    expect(publicClient.estimateContractGas).toHaveBeenCalledOnce();
    expect(publicClient.simulateContract).toHaveBeenCalledOnce();
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "joinGame", value: 10n, gas: 3n }),
    );
  });

  it("does not request a signature when the balance cannot cover stake and gas", async () => {
    const { publicClient, walletClient } = clients(15n);
    const gateway = new OnchainGameGateway(CONTRACT, publicClient as never, walletClient as never);

    await expect(gateway.join(1n, 10n)).rejects.toThrow("MON 余额不足");
    expect(publicClient.simulateContract).not.toHaveBeenCalled();
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });
});
