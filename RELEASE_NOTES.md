# AI Price Analyzer v0.12.0

这版改的是「加一个站要写多少代码」。原来每个新站点都要写一个几百行的解析类，
哪怕它和其他站返回的是同一种数据结构；现在站点差异写成一份声明，新站接进来不动源码。

## 主要变化

- **同形状的站点改成声明式映射。** 采集层多了一种 `price-map` 格式：站点在插件的 `adapter.priceMap` 里声明「数据在哪个路径、模型名取哪个字段、分档规则长什么样」，解析由通用引擎按声明求值。`tokenflux` / `newcodex` / `allrouter` / `stellaisle` / `stellaisle-carpool` / `cheaprouter` / `true-sota` / `sidrune` / `relayrouter` 九个站共用一份引擎，彼此的差异只有 `source` 一个字段。
- **接入星芽API（xingya.site）。** 匿名直连 `/api/pricing`，83 个模型、13 个分组倍率，`billing_expr` 的系数直接是美元/百万 token，`quota_type=1` 的按次计费单独成行。充值是 1 元 = 100 芽点 = 1 美元额度，无阶梯赠送。
- **AllRouter 改采 `/api/pricing`。** 分组名和倍率用站点自己公开的那份，不再从模型列表反推。
- **NewCodex / AllRouter / RelayRouter 去掉壳类。** 这三个类此前各自只有一个 getter 和一句格式字符串比较，业务逻辑全在基类里，现在由声明替代，类不存在了。

## 修复

- **新增 `test/golden/` 快照，兜住映射改动的牵连。** 以前改一个 base，哪些站会跟着变、变成什么样，只能靠人推。现在 5 份报文 fixture 各走一遍映射，结果逐行比对，漂移直接打印增删行。覆盖 99 行报价。
- **`station-audit` 没传插件声明。** `scripts/station-audit.mjs` 体检时只传 `responseFormat`，走的是格式推断链而不是插件里真实的 `priceMap`，对声明化站点等于在瞎猜。修完 `npm run audit:stations`：28 个站 27 正常、1 个 `WARN`（`relayrouter` 缺价 2 条，已知）、0 失败。
- **`base.css` 里 `[hidden]` 和 `.sr-only` 各定义了两遍**，删掉后一份，保留的仍在原位，渲染结果不变。

## 界面

- 控件间距从混用的 3px / 5px 统一到 4px / 6px 一套刻度：分段控件、标签、筛选项、「常用」浮层一致了。
- 图标按钮的 hover 不再一律变红，只有标记了 `danger-icon` 的才变红；移动端的主题切换按钮补到 44px 触控尺寸。

## 破坏性变更

没有。老设置里写的 `responseFormat: "tokenflux"` / `"newcodex"` / `"allrouter"` 等格式名继续能解析，走的是格式定义里带的兜底声明。

## 校验

- `npm run verify:clean`：干净签出 `1fd3d73` 上全套通过。
- `npm test`：491 项全过（新增 `test/price-map-golden.test.js` 6 项）。
- `npm run audit:stations`：27 OK / 1 WARN / 0 FAIL。
- `npm run plugins:build`：29 个插件产物与源同步。
- 声明差异度：8 个站相对 `tokenflux` 的差异键都只有 `source` 一个。测试里有上限保护，超过 4 个键会失败并提示「该写 strategy 而不是塞声明」。

## 隐私检查

仓库里没有 cookie、token、账号名。星芽API 走匿名接口，不需要登录态。

## Assets

- `ai-relay-price-extension-v0.12.0.zip` — 可直接加载的扩展目录包。
- `ai-price-analyzer-v0.12.0-source.zip` — 含 `plugins/` 源的完整源码包。
- `SHA256SUMS.txt` — 上面两个包的校验值。

## 升级说明

装 `0.9.0` 及以上的版本可以直接用自更新升上来。`0.8.x` 及更早的还得手动装一次，自更新协议是 v0.9.0 才有的。

设置项没有变化，站点配置不用重建。

价格由站点决定，采集规则会随站点改版失效，扩展侧算出的月成本与价差都是估算，以站点后台实际扣费为准。详见[免责声明](https://napstablook666.github.io/ai-price-analyzer/disclaimer)。
