# AI Price Analyzer v0.27.1

## 新功能

- **登录站续期收进 Service Worker。** 续期状态持久化到扩展存储，按过期时间错峰唤醒并做失败退避，避免每轮采集为每个登录站额外打开预检标签页。
- **五个登录站补上续期声明。** CUN.AI、FrostFox、Yuki、飓星 API 使用登录态探活，FastAIToken 支持面板粘贴长效令牌；新增假站 fixture 覆盖插件协议的续期路径。
- **`parseBillingTiers` 搬到 Rust/Wasm。** 保留原有 JavaScript 接口，432 条录制用例与边界、随机差分用例全部匹配，MV3 入口使用同步初始化。

## 修复

- **修正计费表达式边界。** 对齐 JavaScript 的负零归一、前导小数点规则、单数 `token` 条件、括号后空白和 `Infinity` 区间排序。
- **修复 Rust 产物新旧判断。** `rust:wire` 改用源码、Cargo 配置和构建配置的归一化内容指纹，不再因字节一致的重建或 Windows 换行差异永久误报产物过期。
- **补上 Rust 质量闸门。** `verify` 现在会执行所有 Rust crate 的 `fmt` 与 `clippy`，并检查 wasm 构建指纹和接线探针。
- **修复干净签出验收遗漏。** `verify:clean` 统一执行完整 `npm run verify`，不再手写一组可能漏项的子检查。

## 兼容性

- 无新增扩展权限，无 schema 变更，老设置直接可用。
- 登录续期能力按站点声明启用；没有可安全续期端点的站点仍可使用手动令牌或登录态采集。
- 扩展与插件仓库标签使用同一个版本号 `v0.27.1`。

## 附件

- `ai-relay-price-extension-v0.27.1.zip`：可直接加载的扩展目录包。
- `ai-price-analyzer-v0.27.1-source.zip`：扩展与插件两仓的源码快照。
- `SHA256SUMS.txt`、`update.json`、`update.ps1`：校验与签名更新清单。
