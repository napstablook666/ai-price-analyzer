# AI Price Analyzer v0.8.0

这版加了「拼车」这一层：同一个站点，模型价是公开的，但真正卖给你的是某个卖家开的座位，价格按座位价折算。顺手把充值方案、时段条件、刷新选站这三处一直含糊的地方补齐了。

## 主要变化

- **飓星API 拼车插件（`stellaisle-carpool`）。** `token.stellaisle.com/carpool-market` 要登录态才能看座位清单，界面是 SPA，所以走 `mode: "page"`：在你自己登录过的页面上下文里取 `localStorage.uid` 当 `New-Api-User` 头，带 cookie 请求 `/api/carpool-market`，再把座位折扣乘到同站公开的 `/api/pricing` 模型价上。四个车、八个模型，一次采出 64 行。
- **辅助报文（`aux`）。** 采集器现在支持一个主接口 + 若干辅助接口：拼车市场的座位清单和模型单价分别在两个接口里，辅助接口拿不到只丢掉那部分，不会让整站采集失败。
- **同域名多插件。** 一个域名下可以挂两个插件（模型广场和拼车市场就是这样），路径精确匹配优先，站点记住自己的 `pluginId`，插件之间不再互相改写对方的预设。
- **分时段条件不再丢。** `tiered_expr` 里的 `weekday()` / `hour()` 条件以前静默忽略，现在作为 `billing_conditions` 挂在行上，界面能看到「这条价只在某个时段成立」。
- **充值方案（`rechargePlans`）。** 除了一次性充值档位，还能记订阅制方案和手动档：maolaoapi 的 98/188/358 元周付（120/240/480 额度、按周刷新不累计）、飓星API 单笔 500 美元以上 8.8 折（要找管理员，不能自助）。自助能买的才进月成本估算。
- **刷新选站支持 Shift 连选。** 「刷新指定站点」的勾选框改成自己接管点击：点一行、Shift 点第二行就连选这一段；「全选」按当前搜索结果算，不是永远选全部站点。
- **充值档位提示挪到站点格。** 月成本下面的「充 X 档 Y 折」是站点规则不是这一行的价格，挪到中转站名称下方，一行只看一个数。

## 校验

- `npm test`：413 项全过，含拼车折算、辅助报文、同域双插件、时段条件、充值方案的新用例。
- `npm run plugins:check`：26 个插件产物与源同步。
- `npm run version:check`：`package.json`、`manifest.json` 均为 `0.8.0`。
- `node --check`：`src/service-worker.js`、`src/dashboard.js`、`src/options.js`、`src/content-bridge.js`、`src/page-bridge.js` 通过。
- 真实扩展实测：装插件 → 采飓星API 拼车 → 64 行入表，四个车名与档位价逐条核对过。

## 隐私检查

仓库里没有 cookie、token、uid、账号名，扫描凭据与私钥标记无命中。拼车插件只在运行时从**你自己浏览器**的 `localStorage` 读 uid 当请求头，不落盘、不上传；采集结果只存在本机 IndexedDB。座位卖家名来自站点公开页面，属于公开数据。

## Assets

- `ai-relay-price-extension-v0.8.0.zip` — 可直接加载的扩展目录包。
- `ai-price-analyzer-v0.8.0-source.zip` — 含 `plugins/` 源的完整源码包。
- `SHA256SUMS.txt` — 上面两个包的校验值。

## 升级说明

`stellaisle-carpool` 用到新的响应格式（`stellaisle-carpool`）和辅助报文机制，旧版扩展认不出来，插件标了 `needsCode`：装之前先把扩展升到 0.8.0。

拼车的座位折扣 = 座位价 ÷ 期间额度，站点额度按 1 元 = 1 美元计。座位价含卖家折扣，押金不计入单价。渠道倍率是否会在座位额度上再乘一层还没实测过，真扣费对不上就改插件里的折算。

价格由站点决定，采集规则会随站点改版失效，扩展侧算出的月成本与价差都是估算，以站点后台实际扣费为准。详见[免责声明](https://napstablook666.github.io/ai-price-analyzer/disclaimer)。
