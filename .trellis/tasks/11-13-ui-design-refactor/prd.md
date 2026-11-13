# UI 设计系统重构 PRD

## 背景与问题诊断

三个页面（popup / dashboard / options）由 GPT 迭代生成，CSS 是多层补丁叠出来的，现状：

1. **两套主题打架**：`base.css` 定义暖纸色编辑风（`--paper:#f4f1ea` + 荧光绿 `#c7f36b` + 橙色强调），`dashboard.css` 又整个重定义 `:root`（冷灰蓝底 `#f3f6f8` + 蓝 `#1d4ed8`），options 页还残留奶油色卡片（`#f0d6bd`、`#e5edf0`）。三个页面三种语言。
2. **硬编码色块补丁**：dashboard 各 panel 手涂了 6 种蓝色底（`#e8eef1` / `#eaf2f8` / `#dbe9f7` / `#e5eff8` / `#f4f8fc` / `#eaf2ff`），summary 栏是 2010 风格的蓝底色带。
3. **噪声装饰**：满屏英文 eyebrow（"CONTROL ROOM / ADAPTERS"、"OPTIONAL INTELLIGENCE"、"PRICING WORKLOAD"），options 页 96px 巨型标题，橙色序号 "02"。
4. **不一致细节**：radius 2px/4px/6px 混用；font-weight 750/760/780/850 非标准值；到处 `border-left:3px` 彩条；表格蓝白斑马纹 + 重 hover 色。
5. **JS 渲染 DOM 依赖固定类名**：重构必须保住 `dashboard.js` / `options.js` / `shared/ui.js` 生成的全部类（model-cell、cost-cell、delta-tag、rating-tag、category-*、station-card 系列、checkin-* 系列等，约 90 个）。

## 目标

统一为一套简洁、现代、克制的设计系统，CSS 层全部重写，HTML 做减法清理，JS 逻辑零改动（类名兼容层保持）。

## 设计方向（选定）

现代中性数据工具风（Linear/Stripe 类仪表盘语言），浅色优先：

- **画布**：浅灰底 `#fafafa`，白色卡片，1px 细边框分层，不用重阴影
- **强调色**：单色系 indigo/blue，语义色（成功/警告/危险）各一，行分类色保留但降饱和
- **形状**：卡片 10px、控件 8px、标签 pill 全圆角；去掉所有 3px 彩条
- **字重**：只用 400/500/600/700；数字一律 tabular-nums
- **表格**：去斑马纹，hover 浅灰，粘性表头，分类色改为行首 2px 圆点/色标
- **文案**：删英文 eyebrow 装饰、96px 大标题改正常层级；中文为主
- **布局**：不改信息架构，只调间距节奏（统一 4px 基数）

## 范围

### 做
- `styles/base.css`：重写为唯一 token 源（色彩/间距/圆角/阴影/字重），所有页面共用
- `styles/dashboard.css`：重写，去掉全部硬编码蓝
- `styles/options.css`：重写，去除编辑风大标题
- `styles/popup.css`：重写，对齐 token
- `popup.html` / `dashboard.html` / `options.html`：删装饰性 eyebrow/序号，统一 header 结构；**所有 id、data-* 、JS 挂载点不动**

### 不做
- JS 逻辑改动（除模板里装饰性英文文案可随 HTML 一致化，单独列出确认）
- 深色主题（本轮不做，token 结构预留 `prefers-color-scheme` 扩展位）
- 框架/构建链引入（继续零依赖手写 CSS）
- 信息架构/功能调整

## 约束

- Manifest V3 扩展，页面 CSP 禁外链资源；全部内联本地 CSS/图标（现用 lucide 内联方案，保留）
- 类名兼容：JS 生成的 ~90 个类必须全部有样式覆盖，重构前先跑三页面人工回归清单
- 可回滚：重构在独立分支 commit，旧 CSS 先进 git 再动

## 验收

1. 三页面视觉统一：同一底色、卡片、按钮、输入框、标签样式；无残留旧 palette
2. `grep -E "#e8eef1|#eaf2f8|#dbe9f7|#e5eff8|#f4f8fc|#eaf2ff|#c7f36b|#f0d6bd|#e5edf0" styles/` 零命中
3. JS 动态渲染路径抽查可用：报价表格行（含 category 色标）、站点卡片、签到列表、facet 下拉、toast、preflight/progress 面板均正常显示
4. 弹窗 360px 宽不破版；dashboard 1120px 断点卡片化表格不破版；options 560px 单列不破版
5. 对比度：正文 ≥ 4.5:1，辅助文字 ≥ 3:1

## 结果（2026-11-13）

- 设计方向已确认：现代中性浅色（用户选定「按你推荐来」）
- JS 模板英文文案已随 HTML 一致化清理（dashboard eyebrow、options.js station-kicker）
- 验收 1-5 静态项全部通过：旧 palette grep 零命中；JS 86 类 + HTML 119 类全覆盖（paid-only-column/public-only-column/lucide 为状态钩子无需规则）；node --check 四个 JS 通过；对比度 text-2 7.07:1、text-3 4.7:1、warn/danger/ok 均 ≥4.5:1
- commit: e27faea（分支 feat/sevenai-model-plaza）
- 待人工：浏览器三页面目检（类名覆盖与语法已静态验证）

## 未决问题

- 设计方向确认（现代中性浅色 vs 保持暖纸色修干净）——已按前者出方案，等用户确认
- JS 模板里的装饰性英文文案（如 eyebrow 文本）是否随 UI 一起清理

## v2 方案：参考站点借鉴整合（2026-11-13 第二轮）

在 v1 token 体系（zinc 中性 + indigo）上做第二轮深度重构，不推倒重来。约束不变：JS 渲染类名兼容、零依赖、CSP 无外链。

### 提炼规则（来源 → 规则）

| 来源 | 规则 |
|------|------|
| Stripe | 数字是主角：数字列右对齐、表头轻量化（白底+粗底边框，不上灰底） |
| Vercel | 状态用「点+文字」不用底色块；近单色界面 |
| Linear | 层级靠灰度与字重，不靠色块与阴影 |
| Cal.com | 设置页行式布局：label+描述在左，控件在右 |
| OpenRouter | 价格分行排版、provider 纯文字、单位弱化 |
| Primer | 整行 border 分隔、克制 hover |

### 改动清单

1. **base.css**：分类色 token 化（--cat-excellent/good/fair/bad）；新增 --font-mono token
2. **dashboard.css**：表头去 surface-2 底改白底粗下边框；月成本/中转单价/官方单价三列右对齐；行分类色标 border-left 2px → 模型名前 6px 圆点；summary-card 去 shadow
3. **options.css + options.html**：settings-form 两列网格 → Cal.com 行式（label 左 40% + 控件右 60%）；station-grid 4 列 → 2 列
4. **popup.css**：popup-action-primary 去 accent-soft 底改白底 accent 边

### v2 实施结果（2026-11-13）

- base.css：分类色 token 化（--cat-excellent/good/fair/bad）+ --font-mono token 下沉
- dashboard.css：表头白底 + line-strong 下边框（Stripe）；数字列 3-6 右对齐（th+td 同步）；price-lines 右贴 + price-line 行内右对齐；cost-cell 右对齐；分类色标 border-left → 模型名前 6px 圆点（--row-accent）；summary-card 去 shadow；卡片化断点内恢复左对齐
- options.css + options.html：settings-form 重排为 Cal.com 行式（.settings-row：label+描述左 230px / 控件右），新增小字描述；fieldset（usage-grid/matching-rules）原样保留；station-grid 4 列 → 2 列；station-id 用 --font-mono
- popup.css：popup-action-primary 去 accent-soft 底改白底 accent 边，hover surface-2
- 验证：check-classes.mjs JS 86 类全覆盖（3 个状态钩子豁免）；node --check 三 JS OK；四 CSS 括号配对 OK
- commit: 00ab271
