# AI Price Analyzer v0.11.1

这版没加新站点，八条提交全在修采集链路：多标签页、裸域 301、插件没加载、页面桥重复注入这几个老坑一次性收口，另外把 DOM 契约做成了页面启动就报。

## 主要变化

- **同站多开标签页时不再直接放弃采集。** 以前开着两个以上目标站页面、路径又都不在采集页上时，查找标签页返回空，采集层只能报「请先在当前 Chrome 配置文件登录目标站点」。现在支持临时开页的站点会新开一个干净的采集页，用隔离的 cookie 分区跑；返回结果带上 `ambiguous` / `absent` 原因，兜底文案据此区分「标签页太多分不清」和「确实没开过页面」。
- **刷新预检不再把「插件没加载」当成「无需登录」。** service worker 睡醒时插件注册表是空的，预检拿不到 provider，站点被判成免登录放过，等真刷新才因为缺登录态失败，用户看到的是一句没头没尾的报错。现在预检前先同步工作区插件、按站点加载插件；拿不到 provider 但站点记着 `pluginId` 时照样预检，不跳过。预检失败的原因也带进面板，能看出是页面没加载、超时还是缺 token。
- **裸域 301 到 www 的站点恢复正常。** `jiji.cc` 把裸域跳到 `www.jiji.cc`，插件里写的是裸域地址，页面桥的同源检查直接拒掉，报「页面请求必须同源」；就算放过去，跨域重定向也会剥掉 `Authorization`，接口照样是未登录。现在 www 与非 www 算同一站点，请求落回页面当前的 origin 再发，浏览器里开着的 www 页面能直接复用，不用每次开新标签页。
- **`jiji` 登录一次就不用再管。** `auth_token` 24 小时过期，补上和 hepingan 同款的 `/api/v1/auth/refresh` 续期，过期时用 `refresh_token` 自动换新的。
- **`stellaisle-carpool` 复用主站页面。** 原来只认 `/carpool-market` 这个路径，浏览器里明明开着 `token.stellaisle.com` 却找不到可用标签页，直接报「请先登录」。补上同域复用与缺页面时临时开页两条兜底。
- **页面启动就报缺失 DOM 节点。** 以前 `ids:check` 只做静态扫描，节点真的没了还得等人点到那个按钮才炸。现在 `ids:check --write` 生成 `src/dom-contract.js`，把每页被字面量引用过的 id 列成清单；`dashboard.js` / `options.js` 一开头断言契约，缺几个一次列全再停，同时在页面上挂红色横幅，不用开 DevTools 才知道少了什么。`$()` 换成 `makeQuery()`：清单内的纯 `#id` 取不到立即抛，清单外仍返回 `null`，可选性得写成显式决定。
- **页面桥每次注入都自带 teardown。** 拆不掉的旧桥交给页面重建，不再靠「上次注入的那个应该还能用」。

## 校验

- `npm run verify:clean`：干净签出 `af23aea` 上全套通过，拒绝脏工作树跑验收。
- `npm test`：474 项全过。
- `npm run plugins:check`：28 个插件产物与源同步。
- `npm run version:check`：`package.json`、`manifest.json` 均为 `0.11.1`。
- `node --check`：`src/service-worker.js`、`src/dashboard.js`、`src/options.js`、`src/content-bridge.js`、`src/page-bridge.js` 通过。
- CI 补上 `ids:check` 与 `version:check`。这两条以前只写在 `npm run verify` 里，从来没在流水线上跑过。

## 隐私检查

仓库里没有 cookie、token、账号名。多标签页改动只在站点域内开临时采集页，不跨站；临时页用完即关，采集结果仍只存本机 IndexedDB。`jiji` 的 `refresh_token` 续期读完写完都留在扩展存储里，不进日志、不进错误信息。

## Assets

- `ai-relay-price-extension-v0.11.1.zip` — 可直接加载的扩展目录包。
- `ai-price-analyzer-v0.11.1-source.zip` — 含 `plugins/` 源的完整源码包。
- `SHA256SUMS.txt` — 上面两个包的校验值。

## 升级说明

直接覆盖装即可，没有设置项变更，不需要重新登录。

同站多开标签时，支持临时开页的站点会新开一个采集页，用完自动关；如果你的浏览器设置了「阻止第三方 cookie」，临时页仍然在同一站点域内，不受影响。

`ids:check` 现在会在页面启动时检查 DOM 契约。如果你手工改过 `dashboard.html` / `options.html` 的 id，页面顶部会出现红色横幅并列出缺失清单，跑一次 `npm run ids:build` 即可同步清单。

价格由站点决定，采集规则会随站点改版失效，扩展侧算出的月成本与价差都是估算，以站点后台实际扣费为准。详见[免责声明](https://napstablook666.github.io/ai-price-analyzer/disclaimer)。
