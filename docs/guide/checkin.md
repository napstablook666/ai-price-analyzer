# 每日签到

签到是扩展里唯一的「写操作」：它替你在站点上领当日额度。默认不签到，只有勾了「自动签到」的站点才会被定时任务碰。

## 哪些站点能签

签到适配来自插件：`plugins/site-checkin/checkin.json`（manifest 里 `kind: "checkin"`）。装了站点签到插件、且站点主机名匹配 `hosts`（或它的子域），这个站点才会出现在面板里。没适配的站点点签到会报「该站点暂无签到适配」。

加新的签到站点 = 在插件仓里加一个 `kind: "checkin"` 的插件，只写 `manifest.json` + `checkin.json`，不用改扩展代码。

## 凭证从哪来

按顺序取：

1. 手工令牌：站点设置里的 `station.checkin.token`，或签到卡片「填令牌」存的 `checkinState[<预设 id>].token`。
2. 已打开的该站标签页里 `localStorage[tokenStorageKey]`，读不到再读 cookie `tokenCookieName`（Vyce 是 `vyce_session` / `session`）。
3. 上一次捕获的登录态快照里的 token。

请求同时带 `Authorization: Bearer <token>` 和 `credentials: "include"`，浏览器当前的会话 cookie 也参与验证。所以只要这个浏览器里登录过站点，就算没手工填令牌也能签。

读页面登录态是在已开标签页里用 `chrome.scripting.executeScript` 注入 `world: "MAIN"`，只取那两个值，不读别的。

## 登录态快照

签到时（以及未登录时点「打开站点登录」、探测确认登录成功之后）扩展会存一份快照到 `checkinState[<预设 id>].session`：

```json
{
  "token": "…",
  "cookies": [{ "name": "session", "value": "…", "domain": "vyceai.com", "path": "/", "secure": true, "httpOnly": true, "sameSite": "lax", "expirationDate": 0 }],
  "origin": "https://vyceai.com",
  "capturedAt": 0
}
```

- cookie 只抓 `tokenCookieName` 指定的名字；规格里没写这个名字时，抓该域下 `__Host-` / `__Secure-` 前缀的 cookie。不抓统计类 cookie。
- 站点回 401/403（或业务码 401/403、文案含「未登录 / 请先登录 / 登录已过期」）时，扩展先用快照里的 cookie 写回浏览器，再重试一次。已经发出过签到请求的不重试，避免重复签到。
- 快照是明文，存在扩展本地存储里，能读到你浏览器 profile 目录的程序都能读到。卡片上的「清除已存登录」会删掉它。

## 未登录时

- 站点回 401/403 时，面板上显示「未登录」，不抛出原始 `HTTP 401`。
- 「打开站点登录」会打开插件的 `loginPath`（没写就是站点根地址），之后每 30 秒探一次状态，最多 12 次（6 分钟）。确认能正常查状态就存快照并刷新面板，不用手动点重试。
- 自动签到遇到未登录只记 `needsLoginAt`、标「未登录」，不刷红、不无限重试。手动签到成功一次后清掉。

## 一次签到发生什么

```
GET  /user/daily-reward          读 canClaim / streak / rewardAmount / …
  ↓ canClaim === true
POST /user/daily-reward/claim    领奖励
  ↓
GET  /user/daily-reward          复核 canClaim === false
```

- 第二步只在前一步 `canClaim === true` 时发生。
- 第三步是复核：领完再看一次，如果站点还把 `canClaim` 报成 `true`，抛「签到请求已返回，但网站状态未确认到账」。这是防「接口回 200 但其实没到账」。
- 站点返回 `已签到` / `already claimed` 一类文案时不算错误，按「今日已签到」记。
- 响应字段映射：`canClaim`、`streak`、`streakBonusPercent`、`rewardAmount`、`totalClaimed`、`lastClaim`。

## 定时怎么跑

- `chrome.alarms` 每 **240 分钟**触发一次，只处理勾了「自动签到」的站点（`autoOnly`）。
- 每条预设有自己的 `cooldownHours`（Vyce 是 24 小时），冷却内的站点会被跳过，不会每 4 小时骚扰站点一次。
- 没有「零点触发」，也没有「补签」：闹钟到点就跑一次，浏览器没开就不跑。

## 面板上有什么

顶栏「每日签到」下拉：

| 元素 | 含义 |
| --- | --- |
| 站点名 | 有签到适配的站点，按插件的 `hosts` 匹配 |
| `host · 连续签到 N 天 · 状态` | 状态取最近一次结果，后面有快照时追加 `· 登录已保存`；未登录显示「未登录」（黄），失败标红，未确认的签过记录显示绿色 |
| 「自动签到」勾选框 | 是否纳入定时任务 |
| 「打开站点登录」 | 只在未登录时出现，顶替「立即签到」，打开登录页并开始探测 |
| 「立即签到」 | 立刻走一次上面的三段流程 |
| 「刷新状态」 | 下拉头部的按钮，只查询，不领取 |
| 「填令牌」/「改令牌」 | 展开输入框，写一个手工 token 兜底；有没有保存过站点都能用，占位文案取插件的 `tokenHint` |
| 「保存令牌」 | 写进 `checkinState[<预设 id>].token` |
| 「清除已存登录」 | 有快照时出现在令牌行里，用来删掉明文快照 |
没有可签到的站点时，下拉里只有一句引导：没装签到插件显示「签到来自插件仓库的『站点签到插件』」和「去插件仓库」按钮；装了插件但没有匹配到已启用的站点，提示先去添加或启用站点。

## 常见状态文案

代码里没有固定的状态枚举，面板显示的是最近一次结果文本。会出现的有：

- `尚未查询` — 还没查过。
- `可签到` — 查了状态，今天还能领。
- `今日已签到` — 站点说今天签过了。
- `未登录` — 需要先在这个浏览器里登录站点。
- `签到成功，奖励 <amount>` — 领取并复核通过。
- 具体错误串 — 网络失败、站点拒绝、状态未确认等，标红。

## 失败了怎么查

按这个顺序看：

1. 站点在插件里有没有签到适配（`kind: "checkin"` 且 `hosts` 匹配）。
2. 这个浏览器登录过站点没有；没登录就点「打开站点登录」，或在「填令牌」里贴一个。
3. 站点接口是否改名：`statusPath` / `claimPath` / 字段名都可能变，改了就报响应无效或查询失败。
4. 是不是站点加了验证码、二次确认。扩展只调接口，不模拟点击，遇到这类校验只能手动签。
5. 快照还在不在效期内。站点服务端会话过期后快照补不回来，必须重新登录一次。

站点签到接口的结构性变化属于适配维护：改 `plugins/site-checkin/checkin.json`，重跑 `npm run plugins:build`，并在 `test/checkin.test.js` 里补一条用例。