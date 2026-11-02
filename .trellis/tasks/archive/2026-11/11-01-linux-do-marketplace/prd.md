# 适配 Linux.do Marketplace 公益站

## Goal

将 `https://hub.linux.do/marketplace` 接入现有公益站模式，让用户可以在扩展的「公益站」视图中按模型查看 Linux.do Marketplace 的渠道价格，并与同站其他模型价格进行比较。

## User value

用户不需要手动打开 Marketplace 逐个查看渠道价格，可以在现有价格比较界面中按模型快速查看 Linux.do 的积分/额度价格。Linux.do 作为公益站单独展示，不与付费中转站混合比较；站点积分默认按 1:1 作为展示基准，不宣称人民币成本。

## Background and confirmed facts

- 目标站点是 `https://hub.linux.do/marketplace`，属于公益站，必须归入 `category: "public"`。
- Linux.do Marketplace 的真实接口是 `POST https://hub.linux.do/admin/graphql`，不是页面 URL，也不是现有通用 `/api/pricing` 接口。
- 匿名直接请求该 GraphQL 接口返回 HTTP 401：`{"error":{"type":"Unauthorized","message":"API key is required"}}`。
- 页面前端使用 `Authorization: Bearer <token>` 请求 GraphQL，令牌存放在页面 `localStorage["axonhub_access_token"]`，当前页面没有可用的登录 Cookie。
- 已验证的只读查询边界是 `marketplaceModels` 模型目录和 `marketplaceModel(modelID, window)` 单模型详情。单模型响应在 `providers[].channel.channelModelPrices[].price.items[]` 提供价格项目，项目值为 `pricing.usagePerUnit`，渠道倍率为 `item.multiplier`。
- 价格项目至少包含 `prompt_tokens`、`completion_tokens`、`prompt_cached_tokens`；未知项目只保留诊断或忽略，不影响已知有效项目。
- 当前扩展已有 page-mode、页面 `localStorage` 认证、页面请求桥接、登录预检和公益站筛选能力。Linux.do 应复用这些能力，不把令牌写入站点配置或扩展直接请求头。
- 当前 Linux.do 预置是“匿名接口未确认”占位适配，`extension/src/core/collectors.js` 会显式拒绝采集；本任务替换为页面会话 GraphQL 采集。

## Requirements

### R1. 站点注册与分类

- 保持一个独立预置，名称为 `Linux.do Marketplace`，地址为 `https://hub.linux.do/marketplace`，分类为 `public`。
- 预置注册幂等，不能破坏已有用户站点列表或空列表行为。
- 价格单位统一为 `CREDITS`，积分/额度按 `1:1` 作为展示基准，并保留“仅为积分/额度展示基准，不代表人民币成本”的说明。

### R2. 页面登录态采集

- 采集必须使用当前 Chrome 配置文件中已打开或可打开的 `hub.linux.do` 页面会话；用户需先在该配置文件登录 Linux.do。
- 页面桥接层从 `localStorage["axonhub_access_token"]` 读取令牌，并只在页面世界生成 `Authorization: Bearer <token>`。
- 令牌不得写入站点配置、扩展存储、service worker 普通请求头、日志、snapshot `rawMeta` 或测试 fixture；测试只能使用脱敏占位 token 或检查 header 形状。
- 未登录、令牌缺失、GraphQL 返回 401/403 时，生成明确的页面会话失效提示，并保持付费模式及其他公益站可用。
- 刷新前使用现有页面登录预检。预检只发送安全 GET 会话探测，不执行价格查询、不写快照、不刷新 token。

### R3. Marketplace 数据采集

- 新增显式响应格式 `linux-do-marketplace`，禁止让通用自动识别猜测 GraphQL 响应。
- GraphQL 采集采用一个模型目录查询加受控并发的单模型详情查询。默认并发上限为 `4`，不做无限制并发；目录为空、GraphQL `errors`、详情全部失败或没有有效价格时返回站点级错误。
- 只保留可用于价格比较的启用/公开渠道和含有效价格项目的模型。至少保留模型 ID、展示名、渠道 ID、名称、类型、状态、可见性、输入/输出/缓存价格和渠道倍率。
- `prompt_tokens` 映射输入价，`completion_tokens` 映射输出价，`prompt_cached_tokens` 映射缓存读取价；`prompt_write_cached_tokens` 可映射缓存写入价，其他未知项目不影响已知价格。
- 每个价格使用 `pricing.usagePerUnit * item.multiplier`，倍率只应用一次。缺失、空值、非有限数和负数按现有价格校验处理，禁止转成 `0` 或 `1`。
- 采集失败、GraphQL 错误、无有效价格、登录失效或部分模型全部失败时，生成站点级错误或部分诊断，不生成空的成功报价。有效模型的部分失败可保留，同时记录失败数量和模型 ID，不让单个模型阻断全部有效结果。
- 只发送读取 Marketplace 所需的 GraphQL 查询，不实现创建密钥、添加渠道、举报、钱包或其他写操作。

### R4. 公益模式比较

- Linux.do 数据进入现有公益站管线，单位为 `CREDITS`，充值折算沿用未核验的 1:1 展示逻辑。
- 公益模式按同一模型聚合比较 Linux.do 的不同渠道，渠道作为独立报价来源；不与付费站、官方价格、月成本或推荐差异混合计算。
- 站点筛选、摘要、空态、错误提示和排序从当前比较模式的数据派生；复用现有公益站 UI，不新增独立页面或改动付费/公益切换交互。

### R5. 安全与兼容边界

- 不猜测 Linux.do 的 `/api/pricing`、`/api/models` 等匿名接口，不把页面 URL 当价格接口。
- 不实现 Linux.do 登录流程、账号密码输入、OAuth 或手动 API Key 配置。
- 不采集渠道调用、预算消耗、健康度历史、用户资料或治理公示作为价格数据；仅保留展示渠道价格所需的最小元数据。
- 已有付费/公益站、空站点列表、站点预置迁移、页面预检和现有切换行为必须不回归。

## Acceptance Criteria

- [ ] Linux.do Marketplace 作为公益站独立出现在公益模式，付费模式不显示其报价。
- [ ] 已登录 Linux.do 页面时，扩展通过页面 `localStorage` 会话采集 Marketplace 价格，请求不依赖站点配置 token。
- [ ] 未登录、令牌缺失或 GraphQL 401/403 时，显示明确登录/会话失效错误，不猜测匿名接口、不伪造价格。
- [ ] 真实 GraphQL fixture 能归一化至少一个模型的输入、输出和缓存读取价格，并保留模型与渠道信息。
- [ ] 同一模型的多个 Linux.do 渠道能作为独立报价展示并按价格比较。
- [ ] 积分/额度按 `CREDITS` 和 1:1 展示，不显示未经确认的人民币成本。
- [ ] GraphQL 错误、无价格渠道、非法价格、部分模型失败和空目录均有可测试诊断或站点级错误结果。
- [ ] 目录与详情请求有受控并发；不会为全部模型无限制并发或无限重试。
- [ ] 站点预置幂等；已有站点、空站点列表和现有切换行为不回归。
- [ ] 补充 normalizer、collector、页面认证、预检、站点注册、公益模式和安全边界测试；现有测试全部通过。

## Out of scope

- Linux.do 登录流程、账号密码输入、OAuth、手动 API Key 或令牌持久化。
- 匿名直连接口、绕过站点认证、复制或展示完整浏览器令牌。
- 渠道创建、API 密钥管理、钱包余额、签到、举报和其他写操作。
- 预算、健康度历史、用户资料、治理公示等非价格数据的展示或比较。
- 付费站与公益站整体切换 UI、其他站点适配和独立页面。

## Key decision

接受“必须先在当前 Chrome 配置文件登录 Linux.do，扩展通过页面会话采集”的方案。匿名 GraphQL 已确认 401；页面会话可以复用现有 page-mode、页面认证和登录预检，不需要新增敏感凭据存储或导入导出边界。若改为手动 API Key，需要扩大安全面和设置 UI，超出本次站点适配范围。

## Technical notes

- GraphQL 目录查询使用 `marketplaceModels`；详情查询使用 `marketplaceModel(modelID: $modelID)`，变量带 `window: "LAST_7D"` 仅用于查询契约兼容，不采集健康度。
- 页面请求策略固定为 `POST`、同源 `/admin/graphql`、`credentials: "same-origin"`、`Content-Type: application/json`，`pageAuth` 只允许 `Authorization` 和 `axonhub_access_token`。
- 页面预检使用同源安全 `GET /admin/system/price-version`，沿用现有 `pageAuth`，不执行 GraphQL 价格查询。
- 详情查询结果按 `channel.id` 和 `channelModelPrices` 展开为多条站点模型报价；渠道名字作为 `proxy_group_name`，模型 ID 作为稳定的 `model_name`。

## Open questions

无。
