# 技术设计：公益站适配与付费/公益切换

## 1. 边界与目标

本任务只扩展现有单页扩展的站点预置、公开价格采集、标准化和 dashboard 展示边界。沿用 `category: "public"`，不另建公益站配置模型，不改付费站的官方价格匹配和推荐算法。

需要覆盖两条数据链路：

1. Linux.do Marketplace：`https://hub.linux.do/marketplace` 的公开模型广场。页面是 JavaScript 渲染，已确认存在「模型广场」和「渠道广场」等 tab；具体公开价格数据接口在当前研究中仍未被可靠确认，必须在实现前通过网络资源或代码资产确认，不能猜 endpoint。
2. WindHub：`https://windhub.cc/pricing` 的公开价格接口 `GET https://windhub.cc/api/pricing`，请求不带认证凭证。

## 2. 现有架构复用

- 站点预置沿用 `extension/src/core/station-presets.js`。
- 主机识别、请求策略、`credentials: "omit"` 和 preset 回填沿用 `extension/src/core/provider-registry.js`。
- 采集入口沿用 `extension/src/core/collectors.js`。
- 价格标准化沿用 `extension/src/core/normalizers.js` 的 strategy/`normalizePricingPayload` 分发；每个外部响应格式单独 strategy，避免把 Linux.do 或 WindHub 的字段判断塞进通用自动探测。
- 标准站点模型、公益分类和默认兑换比例沿用 `extension/src/shared/schema.js`。
- dashboard 过滤和比较行沿用 `extension/src/dashboard.js`、`extension/src/dashboard-pricing.js`、`extension/dashboard.html` 和 `extension/styles/dashboard.css`。
- 测试沿用 `extension/test/core.test.js` 及现有 dashboard 测试模式。

## 3. 数据契约

### 3.1 公益站元数据

两个预置均使用：

- `category: "public"`
- 默认 `enabled: true`
- `auth.type: "none"`
- `rechargeRmb: 1`、`rechargeCredits: 1`，仅表示首版的 1:1 展示基准，不代表人民币成本
- `priceCurrency` 使用明确的站点积分/额度单位（若服务端只给出通用 credits，展示时标注「站点积分/额度」）

### 3.2 标准化行

适配器至少输出已有标准结构中的：`model_name`、`model_display_name`、`input_price`、`output_price`、缓存价格字段、`proxy_group_name`、`group_ratio`、`price_currency`、`evidence`。公开站点没有官方基准时不制造 `official` 行，不计算 `diffPercent`、节省百分比或付费推荐分。

WindHub 的 `group_ratio`、模型输入/输出/缓存倍率、分组、可用组、供应商和端点元数据必须保留在标准行或现有诊断/元数据字段中；输入与输出价格的倍率只能应用一次。公开数据缺失或无效时沿用现有部分结果和站点级错误语义，不把空值变成 0。

Linux.do 的响应字段和 endpoint 未确认前不写入假契约。若确认后不是已有通用格式，应新增显式 `linux-do-marketplace` response format 和 strategy。

## 4. 比较与 UI 状态

新增 dashboard 的 `comparisonMode`，值为 `paid` 或 `public`，默认 `paid`，通过现有 settings/storage 机制持久化。所有派生数据在同一入口按模式过滤：行、摘要、站点 facet、模型筛选、排序选项、表头、官方参考价区域和空态都从过滤后的数据计算，不能只隐藏表头。

- `paid`：保持现有官方价、相对官方、月成本和推荐逻辑。
- `public`：只取 `category === "public"`；优先按站点筛选同一公益站内模型；隐藏官方价格、官方匹配、相对官方、月成本和推荐差异；保留输入/输出/缓存价格、站点/分组、价格单位和 `1:1` 提示。
- 两种模式互不污染缓存和已保存快照。刷新失败只产生对应站点的失败状态，付费模式仍可用。

UI 使用原生可访问控件，优先采用两个 `<button>` 的 segmented control，而不是可点击 div。控件需有 `aria-pressed` 或等价 selected 状态、可见 focus、清晰文案和窄屏换行；切换只改变过滤状态，不引入新框架或动画依赖。CSS transition 必须有 `prefers-reduced-motion: reduce` 覆盖。

## 5. Linux.do endpoint 风险处理

由于 Marketplace 是 JavaScript 渲染页面，不能把 HTML 文本抓取当作稳定价格源。实现顺序为：

1. 记录浏览器 Network/资源中真实的公开请求和 response shape。
2. 若接口无需登录，采用直接 GET + `credentials: "omit"`。
3. 若页面只在登录 session 中提供价格，停止把它当匿名预置；要么明确降级为用户手动配置的 page station，要么在 PRD 范围内标记该站点暂不可采集，不能读取扩展凭证或偷偷使用用户会话。
4. 为真实接口建立固定 response format 和 fixture 测试。

## 6. 外部契约核验记录（2026-11-01）

- WindHub `GET https://windhub.cc/api/pricing` 匿名返回 JSON，已确认包含 `success`、`data`、`group_ratio`、`usable_group`、`auto_groups`、`vendors`、`supported_endpoint` 和 `pricing_version`。实现使用显式 `windhub` strategy，倍率只应用一次，保留模型的供应商、端点和分组元数据。
- Linux.do Marketplace 页面由 `/assets/index-DMh416pT.js` 渲染。公开资源中的价格查询使用 `POST /admin/graphql` 的 `ChannelModelPrices` 查询，且公共请求封装会在会话存在时读取 token 并附带 `Authorization: Bearer`；当前没有确认匿名可用的价格入口。因此 Linux.do 仅注册为默认启用的公益预置并明确标记暂不可采集，不猜 endpoint、不读取用户认证。

## 7. 兼容、失败与回滚

- 预置注册必须幂等，已有用户配置、禁用状态、快照和自定义站点不被覆盖。
- 公开请求不得附带 Authorization、cookie 或扩展保存的 token。
- 归一化失败应保留现有诊断，站点级显示错误；不吞掉异常，不把网络超时误报为「没有模型」。
- 若 endpoint 研究无法确认，先只落地模式切换和 WindHub，Linux.do 适配保持独立、可回滚的 provider/preset/normalizer 变更，不用不可靠的通用 fallback。
