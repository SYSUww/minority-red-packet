import { describe, expect, it } from "vitest";
import { resolveContractAddress } from "./contract-address";

const DEPLOYMENT = "0x1111111111111111111111111111111111111111";
const INVITE = "0x2222222222222222222222222222222222222222";

describe("resolveContractAddress", () => {
  it("does not let an invite override the fixed deployment", () => {
    expect(resolveContractAddress(DEPLOYMENT, INVITE)?.toLowerCase()).toBe(DEPLOYMENT);
  });

  it("accepts an invite address only when no deployment is configured", () => {
    expect(resolveContractAddress("", INVITE)?.toLowerCase()).toBe(INVITE);
  });

  it("fails closed when the configured deployment is invalid", () => {
    expect(resolveContractAddress("not-an-address", INVITE)).toBeNull();
  });
});
