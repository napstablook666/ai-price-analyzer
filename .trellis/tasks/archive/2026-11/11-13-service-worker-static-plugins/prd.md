# 修复 Service Worker 动态 import 不兼容

## Goal

移除 MV3 Service Worker 模块图中的动态 import，保留站点按需注册和多选添加

## Requirements

- 删除 Service Worker 静态依赖图中的全部动态 `import()`；站点适配器改用静态 ES module 映射。
- 保留运行时按需注册：空工作区启动时 `PROVIDER_REGISTRY` 为空，只在恢复已保存站点或显式添加时注册适配器。
- 保留 `loadSitePlugin()` 等现有异步调用接口、`ADD_SITE_PLUGINS` 批量消息、重复添加幂等和删除后重新注册行为。
- 明确文档中的限制：静态模块会随 Service Worker 启动解析，按需的是注册与启用，不是网络加载或代码拆分。

## Acceptance Criteria

- [x] `extension/src` 不再出现动态 `import()`，并有测试防止 Service Worker 目录回退到该模式。
- [x] 空启动不注册站点；选择插件后才注册对应适配器，删除后可从静态模块映射重新注册。
- [x] 多选一键添加、刷新预检和全部既有测试通过。
- [x] `node --check`、239 条以上扩展测试和 `git diff --check` 通过，规范与验收记录不再宣称 Service Worker 支持动态加载。

## Notes
## Implementation Choice

采用静态模块映射，而非 offscreen document。后者可执行动态 import，但会把采集与消息生命周期拆到第二个运行时，修复成本和回归面更大。当前 22 个适配器体积小，静态解析换取 MV3 兼容性；运行时注册表仍按需激活。
