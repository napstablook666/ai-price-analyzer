# 适配 ai.centos.hk 付费站点

## Goal

为价格分析工具添加 `https://ai.centos.hk/pricing` 付费中转站适配，让用户可以在站点列表中选择该站点并采集其公开模型价格进行比价。

## Confirmed facts

- 站点页面 `https://ai.centos.hk/pricing` 可公开访问，当前页面标题为“君の星辰”，无需登录即可看到模型价格。
- 页面实际请求 `GET /api/pricing`，响应 HTTP 200，未观察到需要扩展凭据或授权头的要求。
- 已观察到响应是 New-API 风格的成功信封，顶层包含 `success: true`、`data`、`group_ratio`、`usable_group`、`supported_endpoint` 等字段。
- 当前 `data` 为 80 条模型行；行字段与现有 `TokenFluxPricingStrategy` 兼容，包括 `model_name`、`model_ratio`、`model_price`、`completion_ratio`、`cache_ratio`、`create_cache_ratio`、`quota_type`、`enable_groups`、`supported_endpoint_types`，并存在 `billing_mode: "tiered_expr"` / `billing_expr` 这类暂不展开的计费模型。
- `group_ratio` 是按分组提供的倍率，已观察到 `默认分组: 1`、`ClaudeAWS企业分组: 4.5` 等值；价格页展示的是人民币价格。
- 仓库已有 `TokenFluxPricingStrategy`，能处理该响应族的 token、按请求、图片价格，跳过 `tiered_expr` 并产生部分结果诊断；该策略通过显式 `responseFormat: "tokenflux"` 触发。
- 仓库的站点注册约定要求同时更新 provider registry、station preset、response format（若需要）和回归测试；可选择站点还必须通过持久站点注册迁移回填，且空站点列表不能被改成非空。
- 普通站点模型列表统一使用业务单位 `CREDITS`。付费站的充值折算目前没有从页面证据得到可靠确认，因此应保持 `rechargeRateVerified: false`，沿用现有未核验充值比价行为。

## Requirements

1. 注册 `ai.centos.hk` 的专用 provider，匹配 `/pricing`，将站点规范化为公开直连模式。
2. 使用 `GET /api/pricing`，发送 `credentials: "omit"`，不转发用户配置的 bearer/API key，也不依赖页面登录态。
3. 复用现有兼容的 TokenFlux/New-API 价格解析能力，避免为相同响应合同复制一套 parser。若兼容性验证发现 Centos 字段存在语义差异，只增加最小必要的专用适配，不扩大自动识别范围。
4. 将归一化结果标记为 `CREDITS`；保留未核验充值折算状态，不把页面人民币展示直接当作已核验充值汇率。
5. 添加一个可选的付费站预置，名称明确为 `ai.centos.hk`，并纳入现有注册站点回填流程；同一 host 重复回填必须幂等，已有 id 冲突时沿用现有唯一 ID 规则，空列表行为保持不变。
6. 添加回归测试，覆盖 provider 匹配与规范化、精确 endpoint、GET/omit credentials/无授权头、响应格式选择、token 与特殊计费行解析、分组倍率只应用一次、未核验充值状态、预置幂等回填。
7. 更新相关 pricing data contract/spec，记录 Centos 的公开接口、解析边界、计费诊断和验证规则。

## Acceptance Criteria

- [x] 已保存或新建站点 `https://ai.centos.hk/pricing` 时，适配器识别为 direct、GET、`/api/pricing`，响应格式选择正确，认证类型为 none。
- [x] 收集请求的最终 URL 为 `https://ai.centos.hk/api/pricing`，请求使用 `credentials: "omit"`，没有 `Authorization` 或用户站点 token 头。
- [x] 使用已验证的 Centos 响应 fixture 可生成可比较的 `CREDITS` 价格行；分组倍率只应用一次，token 输入/输出/缓存字段保留正确关系。
- [x] 按请求或图片模型能沿用现有特殊计费字段；`tiered_expr` 等不支持的计费表达式不会被伪造为普通 token 价格，并产生现有 partial/incomplete 诊断。
- [x] 站点预置会加入已有非空站点列表，重复执行不重复加入；ID 冲突生成唯一 ID；对空列表仍不注入站点。
- [x] 付费站保留 `rechargeRateVerified: false`，不会因页面显示人民币而自动声称充值折算已核验。
- [x] 相关单元测试、项目现有测试和 lint/type 检查通过。

## Out of scope

- 不实现 ai.centos.hk 登录、充值、余额读取或账户管理。
- 不发送扩展设置中的站点 token，不绕过站点鉴权，也不采集非公开或登录后专属分组。
- 不展开 `billing_expr` / `tiered_expr` 动态计费表达式；沿用现有 partial diagnostics。
- 不修改全局 generic auto parser，使任意 New-API 响应都自动被识别为 Centos。
- 不把人民币页面展示、分组倍率或模型单价推断为已核验充值汇率。

## Blocking open questions

无。技术未知项已通过公开页面和现有代码检查；若 fixture 回归暴露字段语义差异，在实现阶段按最小兼容修正处理。
