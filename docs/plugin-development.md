# 插件开发与维护规范

本项目的每个中转站适配都是一个独立插件。插件是唯一需要按站点维护的东西，比价核心、规范模型表、UI 都不该因为加站点而改动。

## 目录分工

```
plugins/<id>/                  ← 唯一手写源，加站点只改这里
  manifest.json                站点元数据（出现在首页站点列表里）
  plugin.js                    站点适配实现，export const sitePlugin
  models.json                  站内模型写法 → 规范模型 id 的别名表
  icon.svg | icon.png          站点图标，首页站点列和筛选列表都用它
src/site-plugins/
  providers/<id>.js            ← 生成物，勿手改
  catalog.js                   ← 生成物，勿手改
src/shared/plugin-order.js  ← 生成物，勿手改
src/shared/site-logos.js    ← 生成物，勿手改
icons/sites/<id>.<ext>      ← 生成物，勿手改
```

站点图标放在插件目录里，文件名固定为 `icon.svg` 或 `icon.png`（≤ 64px，≤ 24KB），构建时复制到 `icons/sites/` 并生成 id → 路径映射。图标缺失时界面退回首字母色块，`npm test` 会报缺图标。抓一次站点图标：

```bash
npm run plugins:icons                       # 抓全部插件
npm run plugins:icons -- --only=sevenai     # 只抓一个
npm run plugins:icons -- --dry              # 只看选中了哪个图标，不落盘
```

生成物是签进仓库的，所以加载扩展不需要先跑构建；但改完 `plugins/` 必须重新生成，否则运行的是旧代码。`npm test` 里有一条 `插件产物与 plugins/ 源保持同步`，漏跑会直接报红。

`plugins/` 是 [独立插件仓库](https://github.com/napstablook666/ai-price-analyzer-plugins) 在扩展仓库旁边的并排签出目录，扩展仓库不跟踪它；构建器默认读上一级的 `../plugins`，插件仓签出到别处时用 `PLUGIN_DIR` 指过去（`PLUGIN_DIR=/path/to/plugins node scripts/plugin-build.mjs --check`）。
Windows PowerShell 里设环境变量：

```powershell
$env:PLUGIN_DIR = 'C:\path\to\plugins'
node scripts/plugin-build.mjs --check
```

## 命令

```bash
node scripts/plugin-build.mjs            # 生成 providers/*.js、catalog.js、plugin-order.js
node scripts/plugin-build.mjs --check     # 只校验有没有漂移，CI/提交前用
node scripts/model-lookup.mjs glm-5.3     # 查规范模型 id（写 models.json 时用）
node canonical/build.mjs --offline        # 重算规范模型表（一般不用动）
npm test                  # 全部测试
```

## manifest.json

```json
{
  "id": "sevenai",
  "name": "SevenAI",
  "host": "sevenai.moe",
  "mode": "direct",
  "order": 1,
  "paths": ["/model-plaza"],
  "description": "公开模型广场，直连采集"
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 必须等于目录名，只能用 `a-z0-9-` |
| `name` | 是 | 首页显示的名字 |
| `host` | 是 | 主域名，决定站点地址匹配 |
| `mode` | 是 | `direct`（直连公开接口）或 `page`（用浏览器登录态抓页面） |
| `order` | 是 | 首页排序，新增插件排到现有最大值之后 |
| `hosts` | 否 | 一个插件覆盖多个域名时写全量列表 |
| `paths` | 否 | 允许的路径，用来和同域的其他插件区分 |
| `category` | 否 | `paid`（默认）/ `public`（公益） |
| `addable` | 否 | `false` 表示不显示「添加」，只能按具体地址添加 |
| `kind` | 否 | `price`（默认，目前只有这一种取值） |
| `description` | 否 | 首页的一行说明 |

同域放两个插件时，两边都必须写 `paths`，否则构建直接报错。

## plugin.js

只导出一个对象，其他一切由构建器补：

```js
import { requestPolicy, CENTOS_PRICING_ENDPOINT } from "@app/core/provider-registry.js";

export const sitePlugin = {
  id: "centos",
  host: "ai.centos.hk",
  matches: ({ hostname, path }) => hostname === "ai.centos.hk" && path === "/pricing",
  prepare: (stationInput, { url }) => ({ ...stationInput, baseUrl: url.origin, /* … */ }),
  mode: "direct",
  responseFormat: "tokenflux",
  authType: "none",
  rationale: "公开定价 API 直连采集",
  preset: { id: "centos", name: "ai.centos.hk", /* … */ },
  request: requestPolicy(() => CENTOS_PRICING_ENDPOINT, { credentials: "omit" })
};
```

契约要点：

- `id` 必须和目录名、manifest 的 `id` 一致；`matches` 必须是函数，否则注册时报错。
- `matches(context, station)` 拿到 `{ url, hostname, path, hashPath }`，返回布尔。
- `prepare(stationInput, context)` 在添加站点时改写站点记录（baseUrl、adapter、auth），可以省略。
- `responseFormat` 必须是 `src/core/response-formats.js` 里 `RESPONSE_FORMAT_DEFINITIONS` 的键，写错的值会被打回 `auto`。站点只是字段名不同就写 `"price-map"` 加 `adapter.priceMap`，不要为一家站点加枚举值。
- `request` 决定采集请求怎么发：`requestPolicy(urlOrFn, { credentials })`。`page` 模式通常用 `localStoragePageAuth` / `cookiePageAuth`；登录态只在 HttpOnly cookie 里的站点用 `cookieRefreshAuth({ cookieName, refreshPath, accessTokenPath, expiresAtPath })`，由 service worker 借 DNR 换出 access token。
- `decodeResponse(payload)` 是同步纯函数：采集器读取主响应并把 `request.aux` 挂到 `payload.__aux` 后、价格校验与归一前调用。可解析 HTML 内嵌 JSON，也可合并多份报价；无钩子时保持原响应。失败向上报错，不回退旧目录，不执行站点脚本。示例见 SpiderAI（HTML）与 Leaflow（目录 + 计费 API）。
- Leaflow 的目录、充值和计费边界见 [Leaflow 插件取证](./leaflow-research.md)。
- OpenRouter 的目录口径、长度档形状和充值费率见 [OpenRouter 插件取证](./openrouter-research.md)。
- `preset` 是插件自带的默认站点模板，首页「添加」用的就是它。
- `modelAliases` 不要手写，构建器会从 `models.json` 注入。

硬约束：

- 只能 `import … from "@app/core/…"` 或 `"@app/shared/…"`，构建时改写成扩展内的相对路径。写 `../../` 会被测试拦下。
- 禁止动态 `import()`，MV3 的 service worker 只认静态导入。
- 插件代码跑在 service worker 里，没有 DOM；要读页面数据就走 `mode: "page"` 的采集请求，不要在插件里操作 DOM。

## models.json

站内写法和规范模型对不上时，插件自己声明别名：

```json
{
  "aliases": {
    "claude-4.5-sonnet": "claude-sonnet-4-5",
    "限时-gpt-5.5": "gpt-5-5"
  }
}
```

匹配优先级（`src/core/matching.js`）：
1. 人工确认的覆盖（`modelMatchOverrides`）
2. 插件别名（本文件）
3. 已接受的 AI 匹配缓存（`llmMatchCache`；独立于人工覆盖）
4. 规范模型层：`claude-4.6-sonnet`、`anthropic/claude-sonnet-4.6:batch`、`Anthropic: Claude Sonnet 4.6` 自动归到一起
5. 精确 / 后缀 / 忽略版本 / 模糊等内置规则

绝大多数拼写差（大小写、`_`/`.`/空格、`provider/` 前缀、`:free` `:thinking` 后缀、`-[日期]` 尾巴）系统已经能自己收敛，不用写别名。写之前先查：

```bash
node scripts/model-lookup.mjs claude sonnet
```

查到就填规范 id；查不到说明它确实是个新模型，别名表也解决不了，先确认规范表是否需要重算。

## 登录态与续期

需登录的站点分两类，续期手段完全不同：

- **`mode: "page"`**：采集必须借浏览器的登录态开标签页。续期靠页面自己（站点前端跑它的 refresh），扩展只在凭据仓记状态。
- **`mode: "direct"` + `pageAuth`**：接口用 token，凭据从页面读一次进仓，之后 service worker 无头续期，不用再开标签页。

插件在 `requestPolicy` 里声明怎么续期，二选一：

```js
// 老写法：站点有换 token 的接口。service worker 借 DNR 改写 Origin 与 Cookie，
// 换出 access token 并落仓，全程不开页面。
request: requestPolicy(ENDPOINT, {
  cookieAuth: cookieRefreshAuth({
    cookieName: "new_api_has_session",
    refreshPath: "/api/user/auth/refresh",
    accessTokenPath: "data.access_token",
    expiresAtPath: "data.access_expires_at"
  })
})

// 新写法：显式声明 renewal，kind 取下面四种之一。
request: requestPolicy(ENDPOINT, {
  renewal: sessionProbeAuth({
    probePath: "/api/user/self",
    probeHeaders: { "New-Api-User": "{{identity}}" }
  })
})
```

`request.cookieAuth` 存在时按 `kind: "cookie"` 处理，`request.renewal` 优先。两样都没有就不排无头任务。映射在 `src/core/renewal.js` 的 `renewalFromProvider`，service worker 和测试用的是同一个函数。

四种 `kind`：

| kind | 干什么 | 谁能用 |
| --- | --- | --- |
| `cookie` | 拿 cookie 换 access token，带 `expiresAt` 落仓 | 站点有换 token 接口，且该接口认 cookie（New-API 系常见） |
| `refresh-token` | 用仓里的 refresh 令牌换新 access token | 站点有标准 OAuth 式 refresh，且页面能读到 refresh 令牌 |
| `session-probe` | 往一个要登录的地址探一次，200 算活着，401/403 算失效。**只判存亡，不换 token** | 换 token 接口不存在，但有一个稳定要登录的地址 |
| `manual-token` | 不动网络，用户在面板粘一个长效令牌，粘过就当不过期（`expiresAt: null`） | 前面三条都走不通 |

**kind 判定顺序**，从上往下试，第一个成立的就是它：

1. 站点有换 token 的接口，且这个接口只认 cookie → `cookie`（`cookieRefreshAuth`）。
2. 接口认 refresh 令牌，页面里能读到 refresh 令牌 → `refresh-token`。
3. 有稳定的要登录地址，但换不出 token → `session-probe`。
4. 连探活都判不了（例如探活地址本身也被风控，或者站点要求人机验证）→ `manual-token`。

**OAuth 站（GitHub / LinuxDO 之类第三方授权登录）怎么选**：登录方式不影响扩展侧做法，只看登录之后留下什么。留 session cookie 且站有换 token 接口就是 `cookie`；只剩一个长效令牌就是 `manual-token`。不要按「用户是用密码还是 OAuth 登的」区分。

`session-probe` 的两个坑：

- `probeHeaders` 里的 `{{identity}}` / `{{token}}` 由凭据仓替换。New-API 系站点不带 `New-Api-User` 头一律 401，拼不出这个头就会把「已登录」误报成 `needsLogin`。
- 探活不是续期。`kind` 是 `session-probe` 的站，会话到期后只能靠用户在面板点「打开登录页」重登一次，扩展替它续不了。

**现状**（`node scripts/list-auth-stations.mjs` 打印，2026-11 那次）：

| 站点 | mode | pageAuth | renewal kind |
| --- | --- | --- | --- |
| `clawcn` | `direct` | 否 | `cookie` |
| `sccx` | `direct` | 否 | `cookie` |
| `killai` | `page` | 否 | `cookie` |
| `dstopology` | `direct` | 是 | `session-probe` |
| `yuki` | `direct` | 是 | `session-probe` |
| `cun` | `page` | 是 | `session-probe` |
| `stellaisle-carpool` | `page` | 是 | `session-probe` |
| `fastaitoken` | `page` | 是 | `manual-token` |
| `aiapi` / `all-in-one` / `hepingan` / `initapi` / `jiji` / `kelaode` / `leaflow` | `page` | 是 | 无声明 |

「无声明」的 7 个只能靠页面自己续，凭据仓里状态停在 `unknown`；用户发现采不到时在面板点「打开登录页」重登一次。给它们补声明是后续的事。

`session-probe` 的站会话到期后也要重登一次——探活只判存亡，换不出新凭据。真正登一次就长期不动的只有 `cookie` 与 `manual-token`。
新站点不确定该用哪条时，先按 1 → 4 试一遍，把结论写进插件注释，并标「待实测」，等真机跑过再改成实测结论。

## 新增一个站点

1. `mkdir plugins/<id>`，写 `manifest.json`、`plugin.js`、`models.json`（可以是 `{"aliases":{}}`）。
2. `node scripts/plugin-build.mjs`。
3. `npm test`，确认 `site-plugins.test.js` 与 `plugin-build.test.js` 都过。
4. 手动验收：加载扩展 → 首页能看到插件 → 添加站点 → 采集一次 → 比价表里模型能对上。
5. 采集不到时先看请求：`page` 模式要先在浏览器里打开该站登录，`direct` 模式要确认接口不需要 token 或 cookie。

6. 站点要登录的话，按 [登录态与续期](#登录态与续期) 的 1 → 4 顺序给它选一个 `renewal`，写进 `requestPolicy`。选 `manual-token` 或干脆不声明的，用户每次会话过期都得手动重登一次，别默认走这条。

## 常见坑

- 改了 `plugins/` 忘了 `plugin-build`：扩展跑的是 `providers/` 里的旧代码，行为看起来"没生效"。
- 在 `plugin.js` 里写 `../../`：构建后路径错位，测试直接失败。
- 给能自动归一的名字硬加别名：多一层维护成本，还可能挡住后续规范表更新。
- 一个插件塞多个域名但不写 `hosts`：站点地址匹配会落到别的插件上。
- `preset.id` 和插件 `id` 不一致：添加站点后保存的 `pluginId` 指不到插件。
- 需登录的站不写 `renewal`：能用，但用户每次会话过期都会掉一次登录，面板只能显示 `unknown`。加站时先按 1 → 4 试一遍。
- 把站点专属的解析逻辑写进 `src/page-bridge.js` 或别的共享文件：下一个站形状不同就得改 `extension/`，插件就不再是唯一手写源。站点专属逻辑该留在 `plugins/<id>/plugin.js` 里。