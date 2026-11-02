# TokenFlux 站点适配执行清单

1. [x] 核对 TokenFlux API 实时响应和项目现有站点、策略、测试结构。
2. [x] 补齐任务 PRD、设计和执行清单。
3. [x] 在 `normalizers.js` 增加 TokenFlux 专用归一化策略，校验响应并映射输入、输出、缓存、图片和按次价格。
4. [x] 在 `response-formats.js` 注册 TokenFlux 策略，并在 `provider-registry.js`、`station-presets.js` 接入站点元数据和请求配置。
5. [x] 在 `core.test.js` 增加 TokenFlux 成功、缓存、异常数据、分组倍率和特殊计费模式测试。
6. [x] 运行语法检查、扩展测试、`git diff --check` 和 Trellis quality check。
7. [x] 复核差异，更新任务日志/规范，并按项目流程提交变更。

## 验证命令

```text
node --check extension/src/core/normalizers.js
node --check extension/src/core/provider-registry.js
node --check extension/src/core/response-formats.js
node --check extension/src/core/station-presets.js
npm --prefix extension test
git diff --check
```

## 回滚点

- 归一化策略、注册项和测试属于独立改动，可整体删除 TokenFlux 新增分支。
- 不改动其他站点字段映射；若 TokenFlux 接口变更，只需调整 TokenFlux 专用策略。
