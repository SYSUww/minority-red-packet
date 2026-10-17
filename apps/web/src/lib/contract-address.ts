import { getAddress, isAddress, type Address } from "viem";

export function resolveContractAddress(
  deploymentAddress?: string | null,
  inviteAddress?: string | null,
): Address | null {
  const fixed = deploymentAddress?.trim();
  if (fixed) return isAddress(fixed) ? getAddress(fixed) : null;

  const candidate = inviteAddress?.trim();
  return candidate && isAddress(candidate) ? getAddress(candidate) : null;
}
