# AI Price Analyzer v0.16.0

本版新增 91Token 价格采集与模型价目快照，调整用量同步默认周期，补充多站充值实付证据，并将普通采集改为只使用随插件发布的静态充值数据。

## 新功能

- **新增 91Token 插件。** 采集文本与图片模型报价，保留计费条件并提供价目 fixture 和 golden 快照。
- **补充充值实付证据。** 新增猫老 API 与 fuck-everyone 的渠道/金额证据，成本按可核验的收银台金额折算。
- **常用供应商操作更安全。** 保存选择后提供明确反馈，清除前增加确认。
- **README 增加 LINUX DO 社区徽章。** 中英文 README 均可直接跳转社区。

## 修复与调整

- **用量同步默认采用最近 30 天。** 移除 7 天选项，避免不同统计窗口导致月成本口径不一致。
- **普通采集不再请求充值状态接口。** 扩展使用插件内发布的静态充值证据；旧设置中的 `rechargeAuto` 会归一为关闭。充值探测脚本现在要求显式声明开发者模式和目标范围。
- **刷新时保留充值证据与条件。** 更新充值记录不会覆盖已有订单证据，模型计费条件继续参与规范化与报价展示。

## 开发与校验

- `recharge:probe` 默认拒绝执行，须使用 `--developer` 并指定 `--id`、`--host` 或显式全量扫描参数。
- 发布前执行 `npm run verify`、`npm run verify:clean` 和 `npm run docs:build`。

## 附件

- `ai-relay-price-extension-v0.16.0.zip`：可直接加载的扩展目录包。
- `ai-price-analyzer-v0.16.0-source.zip`：含插件源码的完整源码包。
- `SHA256SUMS.txt`：两个 ZIP 包的 SHA256 校验值。
- `update.json`：带签名的自动更新清单。
- `update.ps1`：Windows 外部更新脚本。
