# AI Price Analyzer v0.27.2

## 维护

- 删除 Rust 迁移后遗留的六个无引用 JavaScript 常量和一个私有辅助函数，涉及充值报价与充值方案两个模块。
- 同步扩展、插件索引与 npm 锁文件的项目版本；依赖版本不变。

## 兼容性

- 六个公开 JavaScript 接口及其 Rust 调用保持不变，不改变充值校验、档位选择与价格计算行为。
- 无新增扩展权限，无数据格式或设置迁移变更。
- 自更新最低兼容版本保持 `0.9.0`，旧版本仍可按现有流程更新。
- 扩展与插件仓库标签使用同一个版本号 `v0.27.2`。

## 附件

- `ai-relay-price-extension-v0.27.2.zip`：可直接加载的扩展目录包。
- `ai-price-analyzer-v0.27.2-source.zip`：扩展与插件两仓的源码快照。
- `SHA256SUMS.txt`、`update.json`、`update.ps1`：校验与签名更新清单。
