# 每日签到

签到是扩展里唯一的「写操作」：它替你在站点上领当日额度。默认不签到，只有勾了「自动签到」的站点才会被定时任务碰。

## 哪些站点能签

只有内置适配的站点能签，目前是 **Vyce AI（vyceai.com）**。

适配表在 `src/core/checkin.js:5` 的 `CHECKIN_PRESETS` 里，一个站点一条。没有适配的站点点签到会报「该站点暂无签到适配」，面板也不会列出它。

一个站点被认定为可签到，条件是它的主机名等于 preset 的 `matchHosts` 之一，或是其子域。

## 凭证从哪来

按顺序取：

1. 站点配置里的手工 token（`station.checkin.token`）。
2. 已打开的该站标签页里 `localStorage["vyce_session"]`，读不到再读 cookie `session`。

第 2 条意味着：要自动签到，浏览器里得有一个该站的标签页。没有标签页也读不到 token，签到会失败。手工填了 token 就不依赖标签页。

读取方式是在已开标签页里用 `chrome.scripting.executeScript` 注入 `world: "MAIN"`，只取那两个值，不读其他内容。

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

请求同时带 `Authorization: Bearer <token>` 和 `credentials: "include"` 的 Cookie。

## 定时怎么跑

- `chrome.alarms` 每 **240 分钟**触发一次，只处理勾了「自动签到」的站点（`autoOnly`）。
- 每条 preset 有 `cooldownHours`（Vyce 是 24 小时），冷却内的站点会被跳过，不会每 4 小时骚扰站点一次。
- 没有「零点触发」，也没有「补签」：闹钟到点就跑一次，浏览器没开就不跑。

## 面板上有什么

面板右下「每日签到」：

| 元素 | 含义 |
| --- | --- |
| 站点名 | 有签到适配且已启用的站点 |
| `连续签到 N 天 · 状态` | `statusText` 取最近一次结果文本；`lastStatus === "error"` 时显示「查询失败」或具体错误 |
| 「自动签到」勾选框 | 是否纳入定时任务 |
| 「立即签到」 | 立刻走一次上面的三段流程 |
| 「刷新状态」 | 只查询，不领取；会更新面板上的连续天数和文案 |

没有可签到的站点时，面板会显示一句引导，指向添加 vyceai.com 或去站点设置。

## 常见状态文案

代码里没有固定的状态枚举，面板显示的是最近一次结果文本。会出现的有：

- `尚未查询` — 还没查过。
- `可签到` — 查了状态，今天还能领（此时 `claimedToday` 判定为否，显示为 idle 色）。
- `今日已签到` — 站点说今天签过了。
- `签到成功，奖励 <amount>` — 领取并复核通过。
- 具体错误串 — 网络失败、站点拒绝、状态未确认等，标红。

## 失败了怎么查

按这个顺序看：

1. 站点是否在适配表里（不在就没有签到入口）。
2. 有没有手工 token，或者该站标签页是否开着并已登录。
3. 站点接口是否改名：`statusPath` / `claimPath` / 字段名都可能变，改了就报响应无效或查询失败。
4. 是不是站点加了验证码、二次确认。扩展只调接口，不模拟点击，遇到这类校验只能手动签。

站点签到接口的结构性变化属于适配维护，改 `checkin.js` 里的 preset，并补一条 `test/checkin.test.js` 用例。