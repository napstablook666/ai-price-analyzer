# 适配 all-in-one.icu 站点

## Goal

为 AI 比价扩展添加 `https://all-in-one.icu/#/tenant/models` 租户模型站点，使用户可以复用当前 Chrome 登录态采集模型价格并参与比价。

## Background and confirmed facts

- 站点模型页需要登录，不能把用户账号、密码或访问令牌写入扩展代码、任务文档或日志。
- 页面通过 `GET /api/tenant/models` 获取模型目录，当前页面使用 `tenant_access_token` 作为 Bearer 令牌，并返回 HTTP 200、`code: 0` 的 JSON 响应。
- 响应模型位于 `data.list`，包含 `model_id`、`billing_mode`、`input_price`、`output_price`、缓存价格和 `pricing_tiers` 等字段。当前已验证 `token` 与 `tiered` 两种计费模式。
- 现有扩展的登录站点使用 page-mode/page bridge 复用站点标签页登录态，站点模型列表在收集边界统一按 `CREDITS` 参与比较；未核验充值比例按既有 1:1 规则比较。
- 现有站点适配需要同时完成 provider registry、响应格式/normalizer、station preset 注册和回归测试，否则不能出现在可选站点列表或不能通过刷新链路。

## Requirements

1. **可选站点**
   - 注册 all-in-one.icu 站点预设，入口为 `https://all-in-one.icu/#/tenant/models`。
   - 对已有站点列表执行幂等补齐，不改变空列表的既有默认行为。

2. **登录态采集**
   - 使用 page mode，通过当前 Chrome 配置文件的 all-in-one.icu 页面登录态请求 `/api/tenant/models`。
   - 只从页面 `localStorage.tenant_access_token` 读取令牌并在页面请求中发送 `Authorization: Bearer <token>`；扩展不得发送用户提交的账号密码或站点配置中的静态 token。
   - 缺少令牌或接口返回未授权时，沿用现有页面会话失败提示，不回退匿名请求。

3. **价格解析**
   - 新增明确的 all-in-one 响应格式识别/解析，支持 `{ code: 0, data: { list: [...] } }` 及安全的等价列表包装，不把普通模型 JSON 误判为该站点。
   - 支持 `billing_mode: "token"` 的模型级价格，按项目统一的每百万 token 单位输出。
   - 支持 `billing_mode: "tiered"` 的 `pricing_tiers`，保留每个区间的 `min_tokens`、`max_tokens` 和独立输入/输出价格，不把分层价格压成一个错误的单价。
   - 对缓存读、缓存写等已存在的价格字段按项目字段契约映射；缺失或非法价格走现有 partial/invalid diagnostics，不生成 0 价格。
   - 对 `per_request`、`per_second`、`special` 等本次不纳入 MVP 的模式，使用现有 unsupported/incomplete 诊断，不伪造 token 价格。
   - 采集结果使用 `CREDITS` 模型列表单位，未核验充值折算继续使用现有 1:1 比较规则。

4. **兼容性**
   - 不改变其他站点的 provider 匹配、请求认证、价格单位或 parser 行为。
   - 复用现有 model-plaza/parser、pageAuth、station preset 和 collection 流程；不新增依赖。

## Out of scope

- 不实现 all-in-one.icu 登录页、账号密码自动登录、账号密码存储或令牌持久化。
- 不实现 all-in-one.icu 的 API 代理、模型调用或余额/充值接口。
- 不在本次 MVP 中支持 `per_request`、`per_second`、`special` 等非 token/tiered 计费模式。
- 不根据页面展示的美元标签推断充值汇率，不改变全局币种或比较算法。

## Acceptance Criteria

- [ ] all-in-one.icu 作为可选站点被幂等注册，已有站点列表补齐成功且空列表行为不变。
- [ ] page-mode 请求准确使用 `GET /api/tenant/models`、页面登录态和 `tenant_access_token` Bearer 认证；扩展请求不携带用户账号密码或静态 token，缺少登录态时明确失败。
- [ ] `token` fixture 能生成正确的每百万 token 输入、输出和缓存价格，并保留模型名/展示名。
- [ ] `tiered` fixture 能保留多个价格区间及区间边界，价格只转换一次，不产生重复或错误合并的报价。
- [ ] 非法价格、缺失价格和未支持 billing mode 进入既有诊断路径，不生成虚假可比价格。
- [ ] 收集快照中的模型价格为 `CREDITS`，未核验充值比例仍按既有 1:1 规则可参与比较。
- [ ] 现有扩展核心测试及新增 all-in-one 回归测试通过，且原有站点测试不回归。

## Constraints and deferred risks

- 站点 API 是登录态接口，测试必须使用脱敏 fixture，不能把真实 token 写入仓库。
- API 未来可能增加计费模式或改变列表包装；解析器应保留 partial diagnostics，后续可单独扩展，不在本次扩大 MVP。
