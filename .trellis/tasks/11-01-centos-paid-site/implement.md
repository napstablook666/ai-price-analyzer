# ai.centos.hk 适配执行计划

## Ordered checklist

1. 在 `extension/src/core/provider-registry.js` 增加 Centos endpoint 常量、付费站 preset 和 provider 注册，复用 `tokenflux` response format，固定 direct/GET/omit credentials。
2. 在 `extension/src/core/station-presets.js` 增加并导出 `addCentosStationPreset`，确认 registry 自动回填，不改空列表行为。
3. 在 `extension/test/core.test.js` 增加最小脱敏 Centos fixture，验证 provider、请求契约、归一化字段、special billing、unsupported diagnostics、CREDITS 和 preset idempotence。
4. 如果测试证明真实响应存在 TokenFlux parser 未覆盖的差异，只修改 `extension/src/core/normalizers.js` 的共享兼容逻辑，并为该差异补明确测试；否则不改 parser。
5. 在 `.trellis/spec/frontend/pricing-data-contract.md` 增加 Centos 合同与 good/base/bad cases，保持付费站充值折算未核验规则。
6. 运行单元测试和静态检查，修复本任务引入的问题，不重写无关已有改动。
7. 进行 diff/review，确认没有凭据泄漏、没有扩大 auto parser、没有修改空列表默认行为。

## Validation commands

- `npm test --prefix extension`
- `npm run lint --prefix extension`（如果 `extension/package.json` 提供该脚本）
- `npm run typecheck --prefix extension`（如果 `extension/package.json` 提供该脚本）
- `git diff --check`
- `git diff -- extension/src/core/provider-registry.js extension/src/core/station-presets.js extension/src/core/normalizers.js extension/test/core.test.js .trellis/spec/frontend/pricing-data-contract.md`

## Risky files and rollback points

- 高风险：`extension/src/core/provider-registry.js`。provider 匹配、endpoint 和 request policy 错误会影响采集；先用测试锁定 hostname/path 和无凭据请求。
- 中风险：`extension/src/core/normalizers.js`。只有 fixture 失败时才改共享 parser，修改后必须跑 TokenFlux 既有测试。
- 中风险：`extension/test/core.test.js`。fixture 必须只保留结构和价格字段，不写入真实 token、Cookie 或账户信息。
- 低风险：`extension/src/core/station-presets.js` 与 pricing spec。只增加注册和文档，不改变现有 station list 默认。
- 回滚点：若共享 parser 需要的兼容改动扩大了其他站点行为，撤销 parser 改动，改为 Centos 专用最小 strategy；若 endpoint 或站点公开性改变，移除 provider/preset/测试/spec 的 Centos 部分。

## Pre-start review gates

- [x] 用户目标、范围、验收标准已明确。
- [x] 公开 endpoint 和响应结构已通过页面证据确认。
- [x] 没有阻塞性产品决策。
- [x] `prd.md`、`design.md`、`implement.md` 已完成。
- [x] 用户明确批准本次最终规划摘要后，才能执行 `task.py start`。
