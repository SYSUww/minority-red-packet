# 少数派红包

面向黑客松、年会、展会与线下活动的实时多人博弈：玩家进入每轮后同时确认公开站队与 1～10 MON 投入，再秘密选择红包。最终人数最少的非空红包获胜；人数并列时按金、紫、蓝、绿的固定优先级决胜，赢家按各自投入权重分配败者资金。

这不是“随机抽奖”。胜负来自对现场群体的判断，资金与结果由 Monad 上的 Commit–Reveal 合约托管和结算。

## 当前可用内容

- `/`：产品入口与玩法说明；
- `/host`：兼容旧路径的链上房间大厅，可部署协议、创建房间或按房间号查看状态；
- `/test`：完全离线的本地多人排练台，可用 4—8 名虚拟玩家逐阶段或一键测试整局；
- `/play/demo`：不发交易的移动端体验；提交公开站队前隐藏人数，提交后显示公开分布，秘密揭晓后显示真实分组与逐轮反水人数；
- `/play/:gameId`：真实玩家端；`gameId` 是持续有效的房间号，玩家逐轮完成连接钱包、支付押金、Signal、Commit、Reveal 与 Claim；
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

1. 任意账户连接 MetaMask，页面会校验并切换到 Monad Testnet；
2. 首次环境点击“部署协议合约”，后续所有房间复用这一个合约；
3. 点击“创建新房间”，只支付 Gas；成功后页面会取得自增房间号并更新二维码；
4. 创建者如果也想参赛，可以在二维码下点击“支付押金加入本房间”；创建者与其他玩家规则完全相同；
5. 玩家输入房间号或扫码进入，在同一屏预选公开阵营与 1～10 MON 投入；金额先入金，公开阶段再确认站队上链；
6. 满 8 人会提前开始，否则报名截止后 4 人以上自动进入公开站队；后续阶段按区块自动流转；
7. 人数不足时任何账户都能开放退款，揭晓结束后任何账户都能执行确定性的结算；
8. 回合结束后任何账户都能在原房间号开启下一轮；玩家重新选择 1～10 MON 投入，上一轮结果和待领取金额不会被清空。

所有交易都由 MetaMask 签名，项目不会读取或保存私钥。浏览器部署结果会存入当前浏览器的 localStorage，也可粘贴既有协议地址并进行字节码校验。生产环境必须配置一个固定的 `NEXT_PUBLIC_CONTRACT_ADDRESS`，这样玩家只输入房间号即可加入，不需要再提供合约地址。

## 玩家回合历史与决策接口

每轮结算后，测试模式与链上模式都会把每名玩家的公开站队、揭晓后的秘密选择、实际投入、轮次、守约/反水、少数派结果、胜负与可领取金额写入 `apps/web/data/player-history.json`。记录不保存 Salt、commitment 或钱包签名。

- `GET /api/history`：读取记录；支持 `playerId`、`roomId`、`source=mock|onchain` 与 `limit` 查询参数。
- `POST /api/history`：批量写入同一轮的 1–8 名玩家记录，供受信任的结算流程使用。
- `GET /api/agent`：Agent 协议发现，返回链、阶段、动作、状态接口与 Adapter 约定。
- `GET /api/agent/state?roomId={房间号}&playerId={钱包地址}`：读取经过隐私过滤的实时链上状态。秘密选择只会在 Reveal 后出现，commitment 与 Salt 永远不会返回。
- `POST /api/agent/turn`：读取实时状态与历史，为当前阶段生成模型上下文；配置 Adapter 后会把该上下文发给大模型，校验其动作并返回外部钱包执行计划。
- `GET/POST /api/decision`：保留的历史决策上下文接口；新 Agent 应优先使用 `/api/agent/*`。

Agent 的模型与钱包职责分离：模型只能从当前 `legalActions` 中选择动作；外部 Agent Runtime 使用自己的钱包签名交易。服务端不接收私钥，Commit 的随机 Salt 与最终红包编号保存在 Agent 本地执行器，只有 commitment 上链。阶段调用顺序如下：

```text
GET state → POST turn → 模型决策 → Agent 钱包执行 → 等待阶段变化 → 重复
```

配置一个兼容该协议的 LLM Adapter：

```bash
AGENT_ADAPTER_URL=https://your-agent-adapter.example/turn
AGENT_ADAPTER_TOKEN=optional-bearer-token
AGENT_ADAPTER_TIMEOUT_MS=12000
AGENT_RPC_TIMEOUT_MS=8000
AGENT_API_TOKEN=production-agent-api-token
```

生产环境建议设置 `AGENT_API_TOKEN`，调用 `/api/agent/turn` 时通过 `Authorization: Bearer ...` 传入，避免公开接口被滥用并产生模型费用。`AGENT_ADAPTER_TOKEN` 则仅用于本服务访问 Adapter，两者不要复用。

游戏会向 Adapter 发送：

```json
{
  "event": "minority-red-packet.turn",
  "context": {
    "instruction": "阶段规则与安全约束",
    "observation": { "phase": "signal", "legalActions": ["signal", "wait"] },
    "historySummary": {},
    "history": [],
    "responseSchema": {}
  }
}
```

Adapter 返回直接决策对象或包在 `decision` 字段中的对象：

```json
{
  "decision": {
    "action": "signal",
    "packetId": 2,
    "confidence": 0.74,
    "rationale": "当前公开人数较少，保留后续反水空间"
  }
}
```

各阶段动作：`lobby → join`、`signal → signal`、`commit → commit`、`reveal → reveal`、`awaiting-settlement → settle`、`settled/cancelled → claim | open_next_round`。所有阶段都允许 `wait`。Join 还需要 `stakeUnits: 1..10`，Commit 只让模型给出 `packetId`，具体 Salt 和 commitment 由 Agent Runtime 本地生成。

最小调用示例：

```bash
curl 'http://localhost:3000/api/agent/state?roomId=1&playerId=0x你的Agent钱包地址'

curl -X POST 'http://localhost:3000/api/agent/turn' \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer production-agent-api-token' \
  -d '{"roomId":"1","playerId":"0x你的Agent钱包地址"}'
```

本地可以通过 `PLAYER_HISTORY_PATH` 改写 JSON 文件位置。该文件方案适合当前单机测试；部署到无持久磁盘或多实例环境时，应把相同接口背后的存储替换为数据库或对象存储。

### 本地多人测试

打开 `/test` 可以在单个浏览器里模拟 4—8 名玩家，不连接钱包、不使用测试币，也不调用合约。测试台支持修改玩家昵称、逐阶段调整公开站队和秘密选择、统一揭晓结算，以及“一键跑完整局”。顶部现场大屏会依次展示每个红包的公开人数、秘密锁定后的守约/反水总数，以及少数派和整轮资金池的分配；结算后可保留同一批玩家进入下一轮，并在大屏保存轮次历史。默认场景包含一名秘密反水玩家，便于检查少数派、平票优先级和奖金分配展示。

将部署地址写入 `apps/web/.env.local`：

```bash
NEXT_PUBLIC_GAME_MODE=chain
NEXT_PUBLIC_APP_URL=https://你的可访问域名.example
NEXT_PUBLIC_CONTRACT_ADDRESS=0x...
```

房间创建成功后，大厅会显示房间号、可直接扫码的加入二维码，以及“复制邀请”和系统分享按钮。二维码使用 `NEXT_PUBLIC_APP_URL` 生成；如果保持为 `localhost`，只有创建房间的电脑能访问，现场手机无法打开。局域网演示可以填电脑的局域网地址，例如 `http://192.168.1.10:3000`。

当前真实玩家页采用 MetaMask 开发模式，并已打通 Join / Signal / Commit / Reveal / Claim。无钱包、无 Gas 弹窗的正式方案预留为 Privy Embedded Wallet + ERC-4337 Kernel + Pimlico Paymaster；接入前需要准备对应服务凭据。赞助策略必须限制目标合约、函数 selector、单账户/单局额度，不要把无限制 Paymaster 暴露给客户端。

## 核心规则

合约固定四个红包、每个回合 4–8 人。房间创建者没有特殊权限；房间号长期存在，并按顺序承载不限数量的独立回合。每轮阶段由预设区块自动流转，高频阶段每位玩家只写自己的状态槽，Reveal 结束后由任意账户调用一次 `settle()`，遍历至多 8 人统一统计；结算或取消后，任何账户都能调用 `openNextRound()` 开启下一轮。

Commitment 包含完整域隔离：

```text
keccak256(abi.encode(
  COMMIT_TYPEHASH,
  chainId,
  verifyingContract,
  gameId,
  roundNumber,
  player,
  packetId,
  salt
))
```

结算时：

1. 未 Reveal 的玩家弃权，不进入人数统计；
2. 空红包不参与比较；
3. 只有一个非空红包时无人获胜，每位玩家取回自己的押金；
4. 两个及以上非空红包中，人数最少者获胜；
5. 人数并列时，红包编号更高者胜出，即金 > 紫 > 蓝 > 绿；
6. 赢家先取回自己的投入，再按投入占全部赢家投入的比例分配败者资金；无法整除的最小单位按入场顺序分给前几位赢家；
7. 未揭晓玩家的押金仍在奖池中，但本人不能获胜；取消或没有形成少数派时，每位玩家取回自己的押金；
8. 奖金与退款都采用累计式 pull payment；玩家可以一次领取同一房间中多轮尚未领取的金额，单个收款失败不会阻塞全局结算，房间创建者无权提取玩家资金；
9. 每轮玩家、提交、结果和资金池独立存储；开启下一轮不会删除旧回合历史或领取权。

## 工程结构

```text
apps/web/
  src/app/                    Next.js 页面
  src/components/             房间大厅与玩家端
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

实现前阅读了 [jerrymusaga/last-monad](https://github.com/jerrymusaga/last-monad) 的必要源文件，没有 clone 该仓库，也没有复制其整套代码。借鉴的是 `viem/wagmi` 实时链上交互与事件驱动刷新方式；没有沿用它的随机平局、明文选择与页面视觉，因为这些与本项目的 Commit–Reveal 和玩家押金奖池规则不同。

登录、支付和邀请流程还参考了 [Chandukasireddy/Dracarys_Monad](https://github.com/Chandukasireddy/Dracarys_Monad)：采用钱包与应用身份分层、交易前余额/Gas/模拟检查、二维码与系统分享、MetaMask Mobile deep link。没有照搬其仅提交钱包地址的快捷登录，因为缺少签名挑战，不能证明用户控制该地址。详细取舍见 [`docs/reference-dracarys-monad.md`](docs/reference-dracarys-monad.md)。

## 已知风险

- Commit–Reveal 能阻止提交后改选，但不能彻底消除“看过别人 Reveal 后故意不 Reveal”的选择性弃权；当前通过短 Reveal 窗口、客户端自动提示和弃权不阻塞来降低影响。完全解决需要阈值加密等更复杂机制。
- 目前真实多人链路需要 MetaMask。要做到手机号/社交账号登录、内嵌钱包和平台代付 Gas，还需配置 Privy/Pimlico 并做额度与函数白名单控制。
- “只输入房间号”依赖生产环境预先部署并配置唯一协议合约；未配置地址的开发环境仍需通过二维码携带合约地址，或先在房间大厅选择本地保存的合约。
- 多回合房间改变了合约存储布局、ABI 与 commitment 域，旧部署不能原地升级；启用前必须重新部署合约并更新 `NEXT_PUBLIC_CONTRACT_ADDRESS`。
- 当前尚未在公开 Monad Testnet 上完成一整局多钱包端到端验收；测试网验证完成且合约经过审计前，不应承载真实价值。
- Monad 按 `gas_limit` 而非实际 `gas_used` 计费，赞助交易必须设置合理上限并限制 Paymaster policy。
