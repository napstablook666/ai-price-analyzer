# AI Price Analyzer v0.26.2

## 修复

- **已经加过的 OpenRouter 站点会自己改口径。** 0.26.1 只修了新加的站点：插件声明 `rechargePremium: 1.05`、元价交给实时汇率乘，但老站点配置里还留着上次算出来的 `rechargeRate: 7.665`，插件声明碰不到它，界面上自比照样是 `+14.72%`。现在 `prepareStationInput` 在站点自己没有 `rechargePremium` 时套用插件声明的溢价并清掉那条过时常数，升级刷新即生效，不用删站点重建。手填过溢价的站点一切照旧。

## 计费口径

- **插件声明优先于站点存下的推导值。** `rechargeRate` 是 `rechargeRmb / rechargeCredits` 的推导结果，插件声明了 `rechargePremium` 就说明元价该跟着实时汇率走；把上一次的推导值当用户数据供着，汇率一动就会与基准价脱钩。

## 兼容性

- 无新增扩展权限，无 schema 变更。
- 没有 `rechargePremium` 的站点（全部非美元计价站）走的还是原逻辑。

## 附件

- `ai-relay-price-extension-v0.26.2.zip`：可直接加载的扩展目录包。
- `ai-price-analyzer-v0.26.2-source.zip`：扩展与插件两仓的源码快照。
- `SHA256SUMS.txt`、`update.json`、`update.ps1`：校验与签名更新清单。
