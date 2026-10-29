# 适配 KillAI 模型广场计费模式

## Goal

修复 KillAI 模型广场中 `billing_mode: "per_request"` 被报告为未解析的问题，使请求计费模型进入现有比价流程并保持正确的组倍率。

## Confirmed Facts

- 用户提供的页面为 `https://api.killai.cc/model-plaza?embedded=1`，当前结果为“部分成功”，显示 28 个模型，并报告“部分计费模式未解析：per_request”。
- KillAI 已注册为 `killai-model-plaza`，使用已登录页面读取 `/api/v1/model-plaza?timezone=Asia%2FShanghai`；请求策略和认证链路已有测试覆盖。
- `extension/src/core/normalizers.js` 的共享 `ModelPlazaStrategy` 已支持 `per_request_price` / `request_price`，并通过 profile 的 `nonTokenBilling` 决定输出 `request_price`。
- 当前 KillAI profile 只声明 `nonTokenBilling: Object.freeze({ image: "image" })`，因此 `per_request` 落入既有 `unsupportedBillingModes` 诊断路径。
- KillAI profile 已将非 token 计费的倍率回调设置为组倍率；现有 token 和 image fixture、页面采集测试均通过该 profile。
- 未携带页面会话直接访问目标 API 返回 `{"code":401,"message":"Authentication required"}`。本任务沿用现有页面认证方式，不改为匿名请求。

## Requirements

- R1：为 KillAI profile 增加 `per_request: "request"` 映射，复用共享解析器输出请求计费行。
- R2：请求价格使用现有 `per_request_price` / `request_price` 字段，并只应用一次 KillAI 组倍率；保留现有 token、image 和页面认证行为。
- R3：增加回归覆盖，验证 KillAI 请求计费模型能生成 `request_price`，正确应用组倍率，且不再产生 `unsupportedBillingModes: ["per_request"]` 或不必要的 incomplete 结果。
- R4：更新前端价格数据契约，记录 KillAI 请求计费模式的解析边界和验证规则。
- R5：运行扩展现有测试套件，确认其他模型广场和供应商行为不变。

## Acceptance Criteria

- [x] 使用 KillAI fixture 解析带 `billing_mode: "per_request"` 和 `per_request_price` 的模型时，输出一条 `request_price`，数值等于原始请求价乘以组 `rate_multiplier`，token/image 字段保持空值。
- [x] 所有模型均可解析的 KillAI fixture 不包含 `unsupportedBillingModes`，且 `incomplete` 不为 `true`；原有 token interval 和 image 断言继续通过。
- [x] KillAI 页面采集仍使用既有页面模式、`GET /api/v1/model-plaza?timezone=Asia%2FShanghai`、页面会话认证和 `killai-model-plaza` response format。
- [x] `npm --prefix extension test` 通过。
- [x] `.trellis/spec/frontend/pricing-data-contract.md` 明确记录请求计费字段、组倍率和页面认证约束。

## Out of Scope

- 修改 KillAI API endpoint、登录刷新、页面 bridge 或凭据读取。
- 修改共享 `ModelPlazaStrategy` 的计费算法、币种和充值倍率验证规则。
- 新增 `per_second`、按图片以外的其他非 token 计费模式，或调整其他供应商 profile。
- 修改模型广场页面本身的文案、模型数量或账户权限。
- 在没有页面会话的情况下绕过 `401 Authentication required`。

## Risks and Deferred Validation

- 已使用 ego-browser v2.1.0 在已登录页面复核 DOM，确认 `gpt-image-2.5` 标记为“按次计费”且显示 `$0.003287676 / 次`。直接 `page.fetch()` 绕过现有认证桥接时返回 `401`；扩展仍沿用现有页面会话采集，自动化回归使用固定响应 fixture。
- 如果真实请求价模型还携带独立倍率字段，当前 KillAI 数据契约暂不推断该字段；本次只沿用已确认的组 `rate_multiplier`。

## Open Questions

- 无阻塞规划问题。

## Artifact Status

- 轻量任务，PRD-only 规划足够；不创建 `design.md` / `implement.md`。
- 实现、回归测试和质量检查已完成，进入归档阶段。
