# Linux.do Marketplace 技术设计

## 1. 边界与总体方案

Linux.do 继续作为一个 `category: "public"` 站点预置，但从当前“匿名接口未确认”占位实现改为 page-mode 页面会话采集。扩展 service worker 不直接请求 `https://hub.linux.do/admin/graphql`，也不保存 Linux.do token；它只通过现有 page bridge 向 `hub.linux.do` 页面发起同源请求，由 `page-bridge.js` 从 `localStorage["axonhub_access_token"]` 注入 Bearer header。

实现拆成三层：

1. Provider/request 层描述站点、GraphQL endpoint、页面认证和安全 GET 预检。
2. Linux.do collector 层执行一次模型目录查询，再以固定并发执行单模型详情查询，合并响应并产出站点快照。
3. Normalizer 层只负责把合并后的 Linux.do GraphQL 价格结构展开为现有模型报价行；公益 dashboard 继续使用既有 mode projection。

不新增页面，不改付费/公益切换交互，不把 GraphQL 结构交给通用自动识别。

## 2. Provider 与页面请求契约

### 2.1 站点预置

`extension/src/core/provider-registry.js` 保留 `linux-do-marketplace` preset：

- `baseUrl: "https://hub.linux.do/marketplace"`
- `category: "public"`
- `mode: "page"`
- `priceCurrency: "CREDITS"`
- `rechargeRateVerified: false`
- `adapter.endpoint: "/admin/graphql"`
- `adapter.method: "POST"`
- `adapter.responseFormat: "linux-do-marketplace"`

`extension/src/core/station-presets.js` 继续使用现有幂等注册与空列表回填逻辑。

### 2.2 GraphQL 请求

Provider request policy 固定：

- endpoint 为同源 `/admin/graphql`
- method 为 `POST`
- `credentials: "same-origin"`
- `Accept` 和 `Content-Type: application/json`
- `pageHeaders` 只允许 `Content-Type`
- `pageAuth` 为 `source: "localStorage"`、`storageKey: "axonhub_access_token"`、`header: "Authorization"`、`scheme: "Bearer"`
- session failure statuses 为 `[401, 403]`
- 缺 token 使用明确中文提示
- `skipCapture: true`，禁止使用旧页面捕获数据代替当前 token 请求

请求体只包含 `query`、`variables`、`operationName`。目录操作名为 `MarketplaceModels`，详情操作名为 `MarketplaceModel`。详情变量包含 `modelID` 和 `window: "LAST_7D"`，但只读取展示模型、渠道和价格字段，不把健康度作为价格数据。

### 2.3 安全 GET 预检

现有 `preflightPageStation()` 当前按站点 adapter method 生成 GET 探测。为支持 GraphQL POST，扩展 request policy 增加专用 `preflight` 描述：

- endpoint：`/admin/system/price-version`
- method：`GET`
- body：无
- 与 GraphQL 请求使用同一个 `pageAuth`
- 不执行 GraphQL 查询，不写 snapshot，不刷新 token

预检优先使用 `request.preflight`，普通站点继续沿用现有 adapter GET 逻辑。这样 Linux.do 的刷新前检查不会把 GET 发到 GraphQL endpoint。

## 3. Collector 数据流

### 3.1 目录查询

`extension/src/core/linux-do-marketplace.js` 提供固定 GraphQL 文档和请求构造器。目录查询调用 `marketplaceModels`，只请求：

- `modelID`
- `displayModel.modelID`
- `displayModel.name`
- `displayModel.developer`
- `displayModel.group`
- `displayModel.type`
- `displayModel.visibility`

目录响应含 GraphQL `errors`、缺少数组或没有可用 model ID 时，直接返回站点级错误，不执行详情请求。目录顺序去重，使用固定并发执行详情请求，不做无限制并发。

### 3.2 详情查询与并发

对每个目录模型执行 `marketplaceModel(modelID: $modelID)`，使用固定并发上限 4。详情查询按已验证的前端字段请求：

- 模型展示字段
- `providers[].channel.id/name/type/status/visibility`
- `providers[].channel.enabled`
- `providers[].channel.public`
- `channelModelPrices[].modelID`
- `price.items[].itemCode/multiplier/pricing.usagePerUnit`

`enabled` 与 `public` 是本任务核对过的真实详情字段，作为最小启用/公开过滤契约，不再依赖未验证的其他字段。每个详情请求独立捕获 GraphQL errors、HTTP 401/403 和结构异常；不重试登录失败，不做无限重试；失败模型只记录模型 ID 与脱敏摘要，成功详情继续参与合并。

全部详情失败或所有成功详情都没有有效价格时生成站点级 error snapshot；部分成功时保留有效行，并在 normalized 结果中记录 `failedModels`、`failedModelCount` 和 `incomplete: true`。

### 3.3 合并的内部输入

collector 将目录和详情合并成显式格式输入，形状固定为：

```js
{
  data: {
    marketplaceModels: [...],
    marketplaceDetails: [...]
  },
  sourceFormat: "linux-do-marketplace"
}
```

详情只保留 model ID、展示模型元数据、渠道最小状态字段和 `channelModelPrices`。不保存 token、用户资料、预算、健康历史、完整 raw GraphQL payload 或治理字段到 `rawMeta`。

## 4. Normalizer 契约

在 `extension/src/core/normalizers.js` 增加显式 `LinuxDoMarketplaceStrategy`，并在 `extension/src/core/response-formats.js` 注册 `linux-do-marketplace`，让 `normalizePricingPayload(payload, "linux-do-marketplace", options)` 只能走该策略。

每个 `providers[]` 展开其 `channel`：

1. `enabled === false` 或 `public === false` 的渠道直接过滤。`status` 或 `visibility` 明确为 private、hidden、deleted、disabled、inactive、archived 的渠道也直接过滤。
2. 其他渠道只在有有效价格时产出报价行。缺少足够的启用/公开状态时，为保留的有效价格记录 `unknownChannelStates`，不得静默宣称其公开；已验证的 `status: active`、`visibility: public` 或布尔状态字段可作为对应维度的明确证据。
3. 遍历 `channel.channelModelPrices[]`，匹配详情模型 ID。
4. 遍历 `price.items[]`，读取 `itemCode`、`multiplier` 和 `pricing.usagePerUnit`。
5. 对每个已知 item 先验证两个数都为有限非负数，再计算 `usagePerUnit * multiplier`。倍率只在此处应用一次。
6. 字段映射如下：
   - `prompt_tokens` → `input_price`
   - `completion_tokens` → `output_price`
   - `prompt_cached_tokens` → `cache_read_price`
   - `prompt_write_cached_tokens` → `cache_write_price`
7. 未知 itemCode 加入 `unsupportedPriceItems` 诊断或忽略，不影响同渠道其他有效字段。
8. 没有任何有效价格字段的渠道不产出报价行，加入 `unpricedChannels` 诊断。

报价行使用：

- `model_name` 为稳定的 Marketplace model ID
- `model_display_name` 优先使用目录展示名
- `proxy_group_name` 为渠道名称，必要时附渠道 ID 以避免同名覆盖
- `enable_groups` 包含渠道名称
- `price_currency: "CREDITS"`
- `evidence: "exact"`
- 保留最小 `channel_id`、`channel_type`、`channel_status`、`channel_visibility`、`channel_enabled` 和 `channel_public` 元数据

GraphQL envelope 的 `errors`、非法价格、无价格模型、过滤渠道、未知渠道状态和部分详情失败都进入现有 partial diagnostics 机制。若没有任何可用报价，strategy 返回 `error`，由 collector 生成 `status: "error"`，不能让空数组变成成功空目录。

## 5. 与现有 dashboard 的兼容

collector 交给现有 `buildSnapshot()`，snapshot 的 normalized rows 仍走 `CREDITS` 和未核验充值率的 1:1 fallback。既有 public mode 在派生 rows、站点 facet、summary、空态和错误时继续以 mode-filtered 数据为源，因此 Linux.do 不会进入付费模式，也不会参与官方价、月成本或推荐差异。

不改变 WindHub、SevenAI、Centos 或其他 provider 的请求和 normalizer 分支。普通 station 的 default request、预置空列表行为、页面 bridge token 规则保持兼容。

## 6. 错误和回滚

- 页面找不到或 token 缺失：沿用 page bridge 明确 missing-message，snapshot 记录站点级页面会话错误。
- GraphQL HTTP 401/403：使用 `sessionFailureMessage`，不尝试匿名 fetch。
- GraphQL `errors` 或 malformed data：站点级 error / partial diagnostics。
- 单模型失败：保留其他模型并记录失败集合；全部失败：站点级 error。
- 非法或负价格：跳过对应 item/channel，若无剩余有效价格则 error。
- 明确禁用/私有状态：过滤渠道；缺少启用/公开状态但保留有效价格：记录 `unknownChannelStates`，不把该诊断静默丢弃。
- 需要回滚时，删除 Linux.do 的 provider/collector/normalizer 分支并恢复现有显式占位错误；其他站点和 public mode 不依赖这些新分支。

## 7. 测试边界

使用脱敏 GraphQL fixture 验证：目录解析、详情查询包含 `enabled`/`public`、多个渠道、输入/输出/缓存字段、倍率只应用一次、非法值、未知 item、`enabled: false`、`public: false`、旧状态字段过滤、缺字段 `unknownChannelStates` 诊断、部分失败、全部失败、401/403、缺 token、预检 GET、请求不泄露 token、explicit response format、幂等 preset 和 public/paid 行隔离。fixture 不得出现真实 token、完整用户资料或无关 GraphQL 写操作字段。
