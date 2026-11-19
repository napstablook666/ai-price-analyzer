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
3. 规范模型层：`claude-4.6-sonnet`、`anthropic/claude-sonnet-4.6:batch`、`Anthropic: Claude Sonnet 4.6` 自动归到一起
4. 精确 / 后缀 / 忽略版本 / 模糊等内置规则

绝大多数拼写差（大小写、`_`/`.`/空格、`provider/` 前缀、`:free` `:thinking` 后缀、`-[日期]` 尾巴）系统已经能自己收敛，不用写别名。写之前先查：

```bash
node scripts/model-lookup.mjs claude sonnet
```

查到就填规范 id；查不到说明它确实是个新模型，别名表也解决不了，先确认规范表是否需要重算。

## 新增一个站点

1. `mkdir plugins/<id>`，写 `manifest.json`、`plugin.js`、`models.json`（可以是 `{"aliases":{}}`）。
2. `node scripts/plugin-build.mjs`。
3. `npm test`，确认 `site-plugins.test.js` 与 `plugin-build.test.js` 都过。
4. 手动验收：加载扩展 → 首页能看到插件 → 添加站点 → 采集一次 → 比价表里模型能对上。
5. 采集不到时先看请求：`page` 模式要先在浏览器里打开该站登录，`direct` 模式要确认接口不需要 token 或 cookie。

## 常见坑

- 改了 `plugins/` 忘了 `plugin-build`：扩展跑的是 `providers/` 里的旧代码，行为看起来"没生效"。
- 在 `plugin.js` 里写 `../../`：构建后路径错位，测试直接失败。
- 给能自动归一的名字硬加别名：多一层维护成本，还可能挡住后续规范表更新。
- 一个插件塞多个域名但不写 `hosts`：站点地址匹配会落到别的插件上。
- `preset.id` 和插件 `id` 不一致：添加站点后保存的 `pluginId` 指不到插件。