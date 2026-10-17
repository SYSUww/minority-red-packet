# 少数派红包

面向黑客松、年会、展会与线下活动的实时多人博弈：玩家先公开站队，再秘密选择红包。最终人数最少的非空红包获胜；人数并列时，金额更大的红包获胜。

这不是“随机抽奖”。胜负来自对现场群体的判断，资金与结果由 Monad 上的 Commit–Reveal 合约托管和结算。

## 当前可用内容

- `/`：产品入口与玩法说明；
- `/host`：主持人大屏，可演示完整阶段，并可通过 MetaMask 真实部署合约、托管 `0.11 MON` 创建游戏；
- `/play/demo`：移动玩家端，可体验公开站队、秘密反水、锁定、举手机和领取结果；
- `apps/web/src/lib/game-engine.ts`：不依赖 UI 的完整本地规则引擎；
- `packages/contracts/contracts/MinorityRedPacket.sol`：真实 MON 托管、Commit–Reveal、少数派结算、领取与退款合约；
- `packages/contracts/test/MinorityRedPacket.ts`：合约行为与 viem/Solidity Commitment 交叉验证。

界面中的“本地演示”会持续明确标注，不会在 RPC 失败时静默伪装成链上局。

## 快速开始

要求 Node.js 22+ 与 pnpm 11+。

```bash
pnpm install
pnpm dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

常用检查：

```bash
pnpm test
pnpm typecheck
pnpm build
```

## Monad Testnet

当前配置遵循仓库内的 Monad 官方文档快照：

- Chain ID：`10143`；
- RPC：`https://testnet-rpc.monad.xyz`；
- WebSocket：`wss://testnet-rpc.monad.xyz`；
- Explorer：`https://testnet.monadvision.com`；
- Solidity：`0.8.31`，EVM target `osaka`。

部署前：

```bash
cp packages/contracts/.env.example packages/contracts/.env
# 填入 PRIVATE_KEY 与验证服务所需配置
pnpm --filter @minority-red-packet/contracts deploy:testnet
```

也可直接在 Chrome 中打开 `/host`，使用 MetaMask 完成无私钥导出的浏览器部署：

1. 连接主持人 MetaMask，页面会校验并切换到 Monad Testnet；
2. 点击“部署游戏合约”，在 MetaMask 内确认部署交易；
3. 点击“支付 0.11 MON 并创建”，成功后页面会从 `GameCreated` 事件取得真实 gameId 并更新二维码。

这两笔交易都由 MetaMask 签名，项目不会读取或保存私钥。浏览器部署结果会存入当前浏览器的 localStorage，也可粘贴既有合约地址并进行字节码校验。

将部署地址写入 `apps/web/.env.local`：

```bash
NEXT_PUBLIC_GAME_MODE=chain
NEXT_PUBLIC_CONTRACT_ADDRESS=0x...
```

玩家无钱包、无 Gas 弹窗的正式方案预留为 Privy Embedded Wallet + ERC-4337 Kernel + Pimlico Paymaster。当前只打通了主持人部署与托管资金入口，玩家 Signal / Commit / Reveal / Claim 尚未接到真实页面。赞助策略必须限制目标合约、函数 selector、单账户/单局额度；不要把一个无限制 Paymaster 暴露给客户端。

## 核心规则

合约固定四个红包、每局 4–8 人。高频阶段每位玩家只写自己的状态槽，Reveal 结束后由一次 `settle()` 遍历至多 8 人统一统计。

Commitment 包含完整域隔离：

```text
keccak256(abi.encode(
  COMMIT_TYPEHASH,
  chainId,
  verifyingContract,
  gameId,
  player,
  packetId,
  salt
))
```

结算时：

1. 未 Reveal 的玩家弃权，不进入人数统计；
2. 空红包不参与比较；
3. 只有一个非空红包时无人获胜，全部资金退主持人；
4. 两个及以上非空红包中，人数最少者获胜；
5. 人数并列时，金额更大的红包获胜；
6. 获胜红包可整除部分由赢家平分，其他红包资金与除法余数退主持人；
7. 奖金与退款都采用 pull payment，单个收款失败不会阻塞全局结算。

## 工程结构

```text
apps/web/
  src/app/                    Next.js 页面
  src/components/             主持人大屏与玩家端
  src/lib/game-engine.ts      本地规则引擎
  src/lib/commit-vault.ts     Salt 本地持久化边界
  src/lib/onchain-game-gateway.ts
                               viem 链上读写与 finalized 等待

packages/contracts/
  contracts/MinorityRedPacket.sol
  test/MinorityRedPacket.ts
  ignition/modules/MinorityRedPacket.ts
```

## 参考与取舍

实现前阅读了 [jerrymusaga/last-monad](https://github.com/jerrymusaga/last-monad) 的必要源文件，没有 clone 该仓库，也没有复制其整套代码。借鉴的是 `viem/wagmi` 实时链上交互与事件驱动刷新方式；没有沿用它的随机平局、明文选择与页面视觉，因为这些与本项目的 Commit–Reveal 和固定金额破平局规则不同。

## 已知风险

- Commit–Reveal 能阻止提交后改选，但不能彻底消除“看过别人 Reveal 后故意不 Reveal”的选择性弃权；当前通过短 Reveal 窗口、客户端自动揭晓和弃权不阻塞来降低影响。完全解决需要玩家押金或阈值加密等更复杂机制。
- 当前 UI 是可交互演示，真实多人局还需要部署合约、配置 Embedded Wallet/Paymaster，并把 UI 的 mock gateway 切换到链上 gateway。
- Monad 按 `gas_limit` 而非实际 `gas_used` 计费，赞助交易必须设置合理上限并限制 Paymaster policy。
