# 设计：Magpie 风格三页与本地站点插件

## 参考结论

来源：`https://github.com/yetone/magpie`；实图存于 `research/magpie-agents-light.png` 与 `research/magpie-providers-light.png`。

采用顶部品牌 + 中央胶囊导航 + 右侧图标操作、浅灰画布、白色圆角列表容器、紧凑行、状态绿点和克制的阴影。不采用通用后台侧边栏，不引入 Magpie 的品牌或远程资源。

## 页面结构

### Dashboard

- 顶栏：品牌、`价格对比` / `站点插件` 导航、刷新与设置。
- 对比视图：紧凑标题与付费/公益切换、四项摘要、筛选工具条、占据剩余高度的报价表格。
- 表格使用 `min-height: 0` + 内部滚动；分页固定在表格底部。刷新预检/进度出现时占用独立局部区域，不撑高 body。
- 插件视图：标题、搜索、分类筛选、批量选择工具条和插件列表。每行展示名称、host、直连/页面、认证说明和已添加状态；未添加项可勾选。
- `#plugins` 直达插件视图，空 hash 为对比视图；视图切换不重复请求数据。

### Options

- 与 Dashboard 共用全局顶栏。
- 本地标签页：站点配置、模型服务、偏好与数据。
- 每个标签页是独立的 `min-height: 0; overflow: auto` 工作区；dialog 保留原生 `<dialog>` 与焦点恢复。
- 站点配置继续承载已有站点卡片与 Agent 添加，并提供进入插件目录的入口。

### Popup

- 360×600 固定骨架，顶部品牌与状态。
- 数据同步：刷新和进度；当前站点：识别与签到；查看与管理：对比、插件、设置。
- 状态文本有最大高度与内部滚动，不让操作区移出视口。

## 插件架构

```text
service-worker / UI
  -> site-plugins/catalog.js          轻量展示元数据 + 白名单 loader
  -> site-plugins/loader.js           缓存 Promise、注册/同步/按 host 加载
  -> site-plugins/providers/<id>.js   完整 provider 定义与 preset
  -> core/provider-registry.js        共享 helpers + 可变运行时注册表
  -> core/collectors.js               复用公共采集逻辑
```

- `catalog.js` 不静态 import provider 模块，避免打开页面就加载整个注册表。
- provider 模块导出固定形状的 `sitePlugin`；loader 校验 ID 后调用 `registerSiteProvider()`。
- `PROVIDER_REGISTRY` 保持导出绑定以兼容现有调用，但内容仅来自已加载插件；provider 顺序保持原注册表顺序，避免匹配优先级变化。
- `normalizeStation()` 保留可选 `pluginId`。旧数据无该字段时通过统一 `stationContext()` 的 hostname/path 匹配目录。
- `GET_DASHBOARD` 返回轻量 `sitePlugins` 状态和已有 stations；新增 `ADD_SITE_PLUGINS`，参数为 `{ pluginIds: string[] }`。
- 批量添加先用 keyed lock 串行化，加载并验证全部目标模块，再合并现有 stations 后一次 `putStations()`；已存在项返回 `alreadyAdded`，不重复写。
- 删除站点后 loader 从活跃注册表移除不再被任何 station 使用的 provider。已加载 JS 的浏览器模块缓存无需清除。
- `ANALYZE_STATION` / `TEST_STATION` 在已知 host 上按需加载单一插件；未知 host 继续走通用路径。
- 不再调用 `addRegisteredStationPresets()` / `addPublicStationPresets()` 自动补齐所有站点。旧辅助函数保留给兼容测试与内部调用。

## CSS 与可访问性

- `base.css` 统一颜色、字号、顶部导航、按钮、输入、状态、焦点和滚动区域 token。
- 主背景约 `#f5f6f8`，面板 `#ffffff`，主文本 `#18181b`，次文本使用对比度 >=4.5:1 的中性色，边框 `#e4e4e7`。
- 不使用 emoji 或远程站点 logo；插件标识使用本地 SVG 图标或文本 monogram。
- 所有 icon-only button 有 `aria-label`；批量选择使用原生 checkbox，状态不只靠颜色表达。
- `prefers-reduced-motion` 下取消非必要过渡；焦点不被 sticky header/table head 遮挡。
- 360px 下导航折叠为可展开菜单，表格自身可横向滚动，body 不横向溢出。

## 验证

- Node：插件目录完整性、动态加载、空数据不预装、批量添加幂等、旧站点 host 迁移、删除后注销。
- 合同：HTML 中现有 ID 与 JS querySelector 对齐；禁止重复 ID。
- 运行：`npm --prefix extension test`、修改 JS 的 `node --check`、`git diff --check`。
- 浏览器：加载解包扩展，实测 1440×900、1280×720、360px，以及筛选、多选添加、视图切换、dialog 焦点和局部滚动。
