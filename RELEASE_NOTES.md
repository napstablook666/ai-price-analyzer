# AI Price Analyzer v0.7.0

这版补两条采集线，顺手把「官方价」这个词改成了「基准价」——基准价本来就是从 OpenRouter 拿的公开价，叫官方容易让人以为是厂家直营。

## 主要变化

- **RelayRouter 站点。** `www.relayrouter.app` 的 `/api/pricing` 匿名可读，319 个模型 × 94 个分组一次拉完。缓存写拆成 `cache_creation_5m_ratio` 和 `cache_creation_1h_ratio` 两档，长上下文走 `step_ratios` 展开成档位行，110 个按次计价的模型记美元单次价。充值 1 元 = 1 美元额度，14 档面值折扣从 9.9 折到 0.925 折已进档位表。
- **飓星API（token.stellaisle.com）站点。** 同样是公开定价接口直连，90 个模型 × 17 个渠道分组，缓存写与长上下文档位按站点字段映射。
- **价格地图支持档位回落。** 有的站点把档位系数写在档位对象里、把模型倍率留在外层记录，以前的表达式只能读档位自身字段。现在档位表达式逐级往父级找，读到为止，这两家站点的档位价才能算准。
- **术语改基准价。** 面板表头、费用项、匹配统计、提示文案统一成「基准价」「基准匹配」；文档里的「官方参考价」页改名「基准参考价」，写明数据来自 OpenRouter 的公开模型价。
- **供应商筛选默认全选。** 兜底不再写死四个供应商，新增供应商自动带上；改过的勾选记进 `localStorage`，刷新和切模式后沿用，勾满等于清掉记忆。
- **中转站名可点开站点。** 表内站名变成外链，直接打开站点首页；要按站点筛选走左侧「全部中转站」。

## 校验

- `npm test`：408 项全过，含 RelayRouter 缓存写双档、档位回落、按次计价的四条新用例。
- `npm run plugins:check`：25 个插件产物与源同步。
- `npm run version:check`：`package.json`、`manifest.json` 均为 `0.7.0`。
- `node --check`：`src/service-worker.js`、`src/dashboard.js`、`src/options.js`、`src/content-bridge.js`、`src/page-bridge.js` 通过。

## 隐私检查

公开源码已按常见凭据与私钥标记扫过。新站点的采集全部只读公开接口，不带 cookie、不带账号信息，fixture 里只留字段结构。不要把账号、cookie、私有响应或带账号信息的 URL 写进源码、fixture、issue 和 release 附件。

## Assets

- `ai-relay-price-extension-v0.7.0.zip` — 可直接加载的扩展目录包。
- `ai-price-analyzer-v0.7.0-source.zip` — 含 `plugins/` 源的完整源码包。
- `SHA256SUMS.txt` — 上面两个包的校验值。

## 升级说明

RelayRouter 和飓星API 两个插件用到新的价格地图字段（`cacheWrite1h`、档位回落），旧版扩展认不出来，所以插件标了 `needsCode`：装之前先把扩展升到 0.7.0。已有的插件产物随扩展一起更新，不用单独重装。

RelayRouter 的充值比例是从站点配置（`price = 1`、`minimum topup = 1`）和后台文案推出来的，没有实付验证；买过一次发现对不上，改插件里的 `rechargeRmb` 就行。

价格由站点决定，采集规则会随站点改版失效，扩展侧算出的月成本与价差都是估算，以站点后台实际扣费为准。详见[免责声明](https://napstablook666.github.io/ai-price-analyzer/disclaimer)。
