# 执行计划：公益站适配与付费/公益切换

## 实施顺序

### 1. 先确认外部契约

- [x] 从 Linux.do Marketplace 当前页面的真实公开网络请求确认 endpoint、请求方法、是否匿名、响应 envelope、模型价格单位和缓存/分组字段。
- [x] 将确认结果写入 `design.md`；若只能登录读取，记录为明确延期或 page-session 方案，不猜测接口。
- [x] 固定 WindHub fixture，覆盖成功响应、分组倍率、缓存倍率和无效价格。

### 2. 站点适配与预置

- [x] 在 `extension/src/core/station-presets.js` 增加两个幂等公益预置，默认 `category: "public"`、启用、1:1 比例和明确价格单位。
- [x] 在 `extension/src/core/provider-registry.js` 增加 host/provider/公开 GET 策略，统一使用 `credentials: "omit"`，不传 Authorization。
- [x] 在 `extension/src/core/normalizers.js` 为 WindHub 及已确认的 Linux.do 响应添加显式 strategy 和格式分发，验证倍率只应用一次、缓存字段保留、无效价格不变成 0。
- [x] 如现有 schema 或 preset migration 需要补充，保持 `extension/src/shared/schema.js` 的 `category: "public"` 语义和用户已有配置/快照不变。

### 3. 公益比较边界

- [x] 在 `extension/src/dashboard.js` 找到比较行、摘要、facet、排序和空态的共同派生入口，增加 `paid/public` 模式过滤，不在各个渲染分支重复筛选。
- [x] 公益模式只保留 public 行和站点内模型列表；隐藏官方价、官方差异、月成本、推荐评分相关展示，显示站点积分/额度和默认 1:1 说明。
- [x] 保留付费模式原有逻辑和默认行为；刷新/重新打开时恢复持久化的模式状态，并重建所有派生筛选。

### 4. Dashboard 控件与样式

- [x] 在 `extension/dashboard.html` 添加语义化二态 segmented control，文案为「付费中转站」「公益站」，同时提供当前模式说明和公益计价提示容器。
- [x] 在 `extension/src/dashboard.js` 绑定键盘可操作的按钮状态、持久化、刷新和过滤更新；确保空态、结果数、站点筛选标签和表头同步。
- [x] 在 `extension/styles/dashboard.css` 复用现有 token 和面板风格，保证窄屏无横向滚动、可见 focus、对比度和 `prefers-reduced-motion`。

### 5. 测试与回归

- [x] 更新 `extension/test/core.test.js`：预置幂等、provider endpoint、`credentials: "omit"`、WindHub/Linux.do normalizer、倍率/缓存/无效数据和 public 分类。
- [x] 增加 dashboard 模式切换测试：默认 paid、切换后仅 public、刷新/重载恢复、公益表头/空态/站点过滤和付费逻辑不变。
- [x] 运行现有测试、针对性测试、语法/静态检查和必要的浏览器手测。
- [x] 运行 `trellis-check` 质量检查；修复发现的问题后再做一次全量验证。

## 验证命令

```bash
cd extension
npm test
npm run lint --if-present
npm run typecheck --if-present
```

若项目没有对应 npm script，使用仓库现有测试命令，并记录实际执行结果。浏览器验收至少覆盖：首次默认 paid、切换 public、站点筛选、刷新后状态、窄屏和键盘焦点。

## 风险文件与回滚点

- 高风险：`extension/src/core/normalizers.js`、`extension/src/core/provider-registry.js`、`extension/src/dashboard.js`。每个阶段保持独立可回滚，先用 fixture 测试再接 UI。
- 中风险：`extension/src/core/station-presets.js`、`extension/src/shared/schema.js`。必须验证幂等预置和旧配置迁移。
- UI 风险：`extension/dashboard.html`、`extension/styles/dashboard.css`。只增加局部控件和条件渲染，不重做现有布局。
- 若 Linux.do endpoint 在实现前仍无法确认，回滚 Linux.do provider/preset/normalizer 代码，不留下猜测接口；WindHub 与 paid/public 切换仍可独立验收。

## 开始前复核

- [x] `prd.md`、`design.md`、本清单已通过最终规划审阅。
- [x] `implement.jsonl` 和 `check.jsonl` 已加入真实 spec/research context。
- [x] 用户在最新规划摘要后明确批准实现。
- [x] 运行 `python ./.trellis/scripts/task.py validate public-site-toggle` 通过后，才执行 `task.py start`。
