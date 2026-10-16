> Historical source: `.codestable/work/2025-10-01-jev-checkin.md`.
> Historical status: the original record below is retained verbatim; its test counts, commits, API observations, and working-tree state describe the date recorded and are not current rules.

# 2025-10-01 · JEV 对话适配收尾与站点每日签到

## 功能一：JEV 对话适配（上一会话延续，本次随提交入库）

- `extension/src/core/jev-tasks.js`：JEV 任务配置解析、复核标签、结构化模型匹配/对比载荷。
- options 页：独立 JEV 服务商档案（独立 baseUrl/model/key），typed JSON 回答校验后才应用。
- 模型匹配建议必须用户确认后才保存；精确价格、站点名/URL、Cookie、站点凭据不进 JEV 载荷。
- `PRIVACY.md` 新增「Chromium extension JEV actions」节。

## 功能二：站点每日签到（首个预设 vyceai.com）

- `extension/src/core/checkin.js`：`CHECKIN_PRESETS` + `matchCheckinPreset` + `performCheckin`（先 `GET /user/daily-reward` 查 `canClaim`，可签才 `POST /user/daily-reward/claim`）；登录态三级兜底：手填 token → 开标签页注入读 `localStorage["vyce_session"]`/cookie `session` → 纯 Cookie 请求。
- `extension/src/core/station-presets.js`：站点预设目录（新增站点只需加一条预设）。
- `extension/src/service-worker.js`：`CHECKIN_STATUS`/`CHECKIN_NOW`/`SAVE_CHECKIN` 消息；4 小时自动签到 alarm（仅对开启"自动签到"的站点执行）；签到记录按**预设 id**（如 `"vyceai"`）存储，与站点 id 解耦——dashboard 面板无需已保存站点即可显示。
- dashboard/popup：签到面板（连续天数/状态/一键签到/自动开关）；popup 在站点页显示"站点签到"按钮；无可签站点时面板显示引导提示。
- 实测（agent-browser 登录态）：GET 返回 `{canClaim, streak, lastClaim, rewardAmount, streakBonusPercent, totalClaimed}`，已签状态返回 `canClaim:false`；真实调用验证通过。

## 教训（本会话多次因锚点/参数写错触发 undo）

- replace/replace_within 的锚点必须先 read 目标文件逐行核对内容，绝不凭记忆猜（本次误把 package.json 行写进测试文件、跨段误删 checkinAll 后已恢复）。
- `replacement_lines` 参数内容必须写对目标文本（一次把 `if (!station) {` 写进了 updateCheckinRecord 行）。
- 同文件批量编辑：逐条单行操作更安全；跨段 remove_from/remove_to 前先确认两个锚点只夹住目标行。

## 验证与收尾

- `cd extension && npm test`：66/66 全绿（含 `test/checkin.test.js` 6 例）。
- `.gitignore` 补 `*.har`，删除根目录 `login-trace.har`（HAR 含登录密码，绝不入库）——上次会话计划的收尾本次实际完成。
- 合并提交 `57cfccf feat: add JEV chat adaptation and station daily check-in`（32 文件 +2862/-348）：两个功能域交叉严重（service-worker/dashboard/popup 同时含两者代码），按文件拆分会产生不可编译的中间提交，故合并为一次提交并在信息中分节说明。
- README.md/README.zh-CN.md 扩展段落补充签到功能描述；PRIVACY.md 补「station check-in」隐私节。
