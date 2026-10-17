import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("MinorityRedPacketModule", (m) => {
  const signalBlocks = m.getParameter("signalBlocks", 60n);
  const commitBlocks = m.getParameter("commitBlocks", 60n);
  const revealBlocks = m.getParameter("revealBlocks", 60n);
  const claimBlocks = m.getParameter("claimBlocks", 1_200n);

  const minorityRedPacket = m.contract("MinorityRedPacket", [
    signalBlocks,
    commitBlocks,
    revealBlocks,
    claimBlocks,
  ]);

  return { minorityRedPacket };
});
