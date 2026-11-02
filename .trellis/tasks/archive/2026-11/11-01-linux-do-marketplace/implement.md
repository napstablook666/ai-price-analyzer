# Linux.do Marketplace 实施计划

## 实施顺序

1. **补齐 provider/request 契约**
   - 更新 `extension/src/core/provider-registry.js` 的 Linux.do preset、page mode、GraphQL POST policy、`axonhub_access_token` pageAuth 和安全 GET preflight。
   - 更新 `extension/src/core/request-strategy.js` / `extension/src/service-worker.js`，让 page-mode POST 请求带 JSON body，并让 `REFRESH_PREFLIGHT` 使用 provider 的 GET probe。
   - 保留 preset 幂等、空列表回填和既有 station credential 行为。

2. **实现 Linux.do GraphQL collector**
   - 新增 `extension/src/core/linux-do-marketplace.js`，集中保存只读 GraphQL query、请求体构造、脱敏错误、固定并发 worker 和目录/详情合并。
   - 在 `extension/src/core/collectors.js` 对 `linux-do-marketplace` 分派专用 collector，成功结果交给现有 snapshot builder；页面 session failure 仍走现有站点错误路径。
   - 明确不使用 captured response，不执行匿名 fallback，不把 token 写入日志或 snapshot。

3. **实现显式 normalizer**
   - 在 `extension/src/core/normalizers.js` 增加 Linux.do strategy，注册 `linux-do-marketplace` response format。
   - 展开多个渠道为独立报价，验证 `usagePerUnit` 与 `multiplier`，映射 token/cache 字段，记录 partial diagnostics，禁止伪造零价。
   - 保持 `CREDITS`、`rechargeRateVerified: false` 和现有 1:1 公益比较语义。

4. **补充测试 fixture 与单元测试**
   - 在 `extension/test/core.test.js` 或现有测试分层中增加脱敏目录/详情 fixture。
   - 覆盖 provider preset、请求 method/body/headers/pageAuth、preflight GET、explicit format、正常多渠道、倍率、缓存、未知 item、非法值、禁用渠道、部分/全部失败、401/403 和 token 不泄露。
   - 覆盖 public/paid 模式行隔离、空站点列表与注册幂等回归。

5. **更新契约文档**
   - 将 `.trellis/spec/frontend/pricing-data-contract.md` 的 Linux.do 占位规则替换为 page-session GraphQL 正式契约，记录 preflight POST/GET 分离、normalizer 字段映射和安全边界。
   - 若调试发现可复用的通用请求策略规则，再单独补充到对应 spec，不扩大本任务范围。

## 验证命令

- `npm test`
- `node --test test/core.test.js`
- `node --test test/refresh-preflight.test.js`
- `node --check extension/src/core/linux-do-marketplace.js`
- `node --check extension/src/core/provider-registry.js`
- `node --check extension/src/core/collectors.js`
- `node --check extension/src/core/normalizers.js`
- `git diff --check`
- `python ./.trellis/scripts/task.py status`

## 风险文件与回滚点

- `extension/src/core/provider-registry.js`：影响 provider 匹配、站点预置和所有请求策略。先写 provider 单测，再接 collector。
- `extension/src/core/request-strategy.js`、`extension/src/service-worker.js`：影响 page bridge、刷新预检和 POST body。任何预检回归都应先恢复到占位 provider，再继续拆分。
- `extension/src/core/collectors.js`：影响所有站点 snapshot 错误语义。Linux.do 专用分派必须早于通用 endpoint loop，且不改变普通站点。
- `extension/src/core/normalizers.js`、`response-formats.js`：影响显式格式注册和 normalization version。只有改变旧 snapshot 解释时才提升 `NORMALIZATION_VERSION`。
- `extension/test/core.test.js`：测试需使用脱敏 token，禁止将浏览器 token、完整页面 JSON 或真实用户资料写入 fixture。

## 开始实现前检查

- [ ] `prd.md` 已完成收敛，无 blocking open question。
- [ ] `design.md` 与本计划对 provider、collector、normalizer、preflight 的边界一致。
- [ ] `implement.jsonl` 和 `check.jsonl` 已包含真实 spec/research 条目。
- [ ] 用户已明确批准最新规划摘要；未获得批准前不运行 `task.py start`，不修改产品代码。
