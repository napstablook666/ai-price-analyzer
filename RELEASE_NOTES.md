# AI Price Analyzer v0.10.0

这版加了一个新站点，顺带把两处一直含糊的地方钉死：充值比例到底「核实过没有」，以及站点落库时的并发覆盖。

## 主要变化

- **NewCodex 插件（`newcodex`）。** `newcodex.cn/api/pricing` 匿名可读，69 个模型、11 个分组倍率，直连采集。充值 1 元 = 1 美元额度，单笔 ¥100/200/500/1000 另赠 10%/20%/40%/50%，四档折进 `rechargeTiers`，卡片上能直接看到按档位算的月成本。19 条别名把 Gemini 的思考档位变体（`-low` / `-medium` / `-high` / `-tiered`）并回基础模型名下，同一条模型横着能比价。
- **新的 `newcodex` 归一格式。** 这个站的倍率基数是 1 = $2/百万 token，不是 New API 惯例的 1 = $1。同一份报文里两套写法能互相校验：`gemini-3.8-flash` 的 `ratio 0.375 / completion_ratio 5 / cache_ratio 0.1`，乘 2 得 0.75 / 3.75 / 0.075，与同站 `gemini-3.8-flash-high` 的表达式 `p*0.75 + c*3.75 + cr*0.075` 逐个吻合。直接用 `tokenflux` 会把所有倍率类模型报低一半。表达式类、按次类、按张类照旧，5 个 `gpt-image-*` 仍是 $0.04/张。
- **站点落库不再整体覆盖。** 页面拿的是打开时的快照，插件安装/卸载、导入设置、另一个标签页都会在它背后改库，用快照整体写回会把别人刚写进去的站点抹掉。改成按 id 合并：新数组只做新增与覆盖，删除走显式名单。后台动过站点后广播 `STATIONS_CHANGED`，页面靠 `origin` 认出自己的回声，不重复重绘；编辑中收到广播先记下，等这一轮落库完再对齐，不在输入框上直接盖。
- **充值「核实过没有」不再默认算核实。** `rechargeRateVerified` 原来默认 true，等于把「没填过」当成「已核实」。改成只有显式 true 才算。站点侧配套：12 个当初实测过比例的插件显式打开 `preserveRechargeRateVerification` 保住原行为，aiapi 的折算没核验过，标成未核验，只保留站点原始报价，不参与人民币成本比价。
- **界面文案中文化。** 顶栏与分区标题里 `MODEL ATLAS` / `COMPARISON TYPE` / `WORKSPACE SETTINGS` 这类英文大写标识换成中文。选中行底色从偏蓝改成中性灰，避免和状态色撞在一起；间距统一到 12px 一档。

## 校验

- `npm test`：465 项全过，含站点落库合并、NewCodex 归一、充值核实语义的新用例。
- `npm run plugins:check`：27 个插件产物与源同步。
- `npm run version:check`：`package.json`、`manifest.json` 均为 `0.10.0`。
- `node --check`：`src/service-worker.js`、`src/dashboard.js`、`src/options.js`、`src/content-bridge.js`、`src/page-bridge.js` 通过。
- NewCodex 用站上真实的 `/api/pricing` 报文（21,178 字节）回放整条采集链路：归一 131 行、11 个分组、零 unresolved，出 105 条报价 / 49 个规范模型；5 个图片模型落在生图榜且单价 $0.04/张；`claude-opus-4-5` 在 ClaudeCode-Max 组出 6.5 / 32.5，`gemini-3.5-flash` 在 Gemini 组出 0.75 / 4.5，与站上表达式逐个核对过。

## 隐私检查

仓库里没有 cookie、token、账号名。NewCodex 只请求公开的 `/api/pricing`，不带凭据（`credentials: "omit"`），采集结果只存在本机 IndexedDB。

## Assets

- `ai-relay-price-extension-v0.10.0.zip` — 可直接加载的扩展目录包。
- `ai-price-analyzer-v0.10.0-source.zip` — 含 `plugins/` 源的完整源码包。
- `SHA256SUMS.txt` — 上面两个包的校验值。

## 升级说明

`newcodex` 用到新的响应格式（`newcodex`），旧版扩展认不出来，插件标了 `needsCode`：装之前先把扩展升到 0.10.0。

装上之后建议点一次 newcodex 的采集对一下数：站上按分组卖，同一个模型在 Kiro 逆向组和 ClaudeCode-Max 组能差三倍多，表里是按分组各出一行，别把便宜那行当成通用价。

价格由站点决定，采集规则会随站点改版失效，扩展侧算出的月成本与价差都是估算，以站点后台实际扣费为准。详见[免责声明](https://napstablook666.github.io/ai-price-analyzer/disclaimer)。
