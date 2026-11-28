# 站点体检 🩺

插件数量上来以后，「哪一家悄悄变了」比「哪一家挂了」更难发现。挂掉的站采集会报错，改版的站会静默返回一堆对不上的价格，而这类错误没人会主动上报。

站点体检只做一件事：**每隔一段时间跑一遍全部直连站点，把结果和上一次的指纹对比，只输出变化的部分**。

```bash
cd extension
npm run health:check                      # 全量跑一遍，结果写到 out/health/status.md
npm run health:check -- --only sevenai    # 只跑指定站点，排查时用
npm run health:check -- --update-baseline # 人工确认变化无误后，把当前结果写成新基线
```

跑完打开 `out/health/status.md`，按「该发版」和「该打补丁」两组看就行。

## 和 `audit:stations` 的区别

| | `npm run audit:stations` | `npm run health:check` |
| --- | --- | --- |
| 回答的问题 | 这一跑能不能采集、覆盖多少模型 | 和上次比，哪几家变了、变在哪 |
| 基准 | 无（每次都从零看） | `scripts/health/baseline.json` |
| 产物 | 覆盖率和失败原因 | 分类表 + 持续期数 + 证据 |

体检复用审计的采集链路（`scripts/direct-audit.mjs` 的 `auditDirectSites`），不重新实现一套请求逻辑。所以体检能拿到的数据，就是扩展自己采集时能拿到的数据。

## 八个分类

分类名对齐 [keiyoushi](https://github.com/keiyoushi/extensions-source) 的 issue 标签口径，方便对照着看。

| 分类 | 触发条件 | 修法 |
| --- | --- | --- |
| `ok` | 与基线一致 | — |
| `price-drift` | 倍率基准、币种变了，或单模型涨跌 ≥3 倍，或中位价偏移 >20% | 补丁 |
| `catalog-shrunk` | 有价格的模型数跌破基线 70% | 补丁 |
| `structure-changed` | 解析失败，或计费模式集合变了 | 发版 |
| `domain-moved` | 端点域名换了，或域名解析不到 | 发版 |
| `http-error` | 5xx、网络层失败 | 发版 |
| `timeout` | 超时、连接中断 | 观察 |
| `auth-wall` | 401/403，需要登录或换 key | 不是坏 |

判定顺序是固定的：先排除「根本没拿到数据」，再比结构，最后才谈价格。一个站同时命中多条时，只报最靠前的那条，避免一次改版把十几个信号混成一条看不懂的报告。

## 持续期数与退役

每次跑完会推进或重置一个计数器，状态存在 `out/health/state.json`：

```
green ──1期非ok──> yellow ──2期──> red ──3期──> obsolete
  ^                                            │
  └──────────────── 下次 ok ───────────────────┘
```

- `auth-wall` **冻结**计数器：认证墙既不是坏，也不是恢复，不该推动退役。等 key 那边有了结论再重算。
- `obsolete` 的站仍在报告里，但会提醒去 `plugins/<id>/manifest.json` 打退役标记。
- 站活过来会直接回到 `green`，历史不清零，方便回看它反复坏了几次。

## 基线怎么维护

`scripts/health/baseline.json` 跟着代码走，不是每次跑都自动更新。这是故意的：自动更新等于每次把「新现状」当成「应该的样子」，站点改版一周后基线就跟着漂了，报告永远不会有异常。

流程是这样：

1. 体检报告说某站 `price-drift` / `catalog-shrunk` / `structure-changed`
2. 人工确认这次变化是站点真实改的，不是我们这边解析错了
3. 改代码（补丁或发版）
4. 跑 `npm run health:check -- --update-baseline`，基线吸收新指纹
5. 提交 `scripts/health/baseline.json`

新加站点第一次跑会被标成「首次登记」，等同于 ok，跑一次 `--update-baseline` 就入库。

`--update-baseline` 只吸收真正拿到数据的站（`OK` / `WARN`）。阻断和失败的站保留旧指纹，否则一次网络抖动就会把「坏」写进基线，之后永远判 ok。

## 接线到 CI

退出码：

| 码 | 含义 |
| --- | --- |
| 0 | 没有新增待处理 |
| 1 | 本次有站新进入 `red` / `obsolete` |
| 2 | 一个站都没跑到（通常是网络或 `--only` 写错） |

`--json <path>` 会额外落一份机器可读报告，字段是 `generatedAt` / `audit` / `counts` / `items`。定时任务里就靠这个判断要不要提 issue。

`out/health/` 下的运行状态不进版本库，`scripts/health/baseline.json` 要进。

## 四份文件

| 文件 | 内容 | 是否入库 |
| --- | --- | --- |
| `scripts/health/baseline.json` | 上次确认的指纹（域名、模型数、计费模式、币种、倍率基准） | 是 |
| `out/health/last-run.json` | 上次的抽样价格，用来算单模型涨跌和中位偏移 | 否 |
| `out/health/state.json` | 每站的持续期数与当前分类 | 否 |
| `out/health/status.md` | 给人看的报告 | 否 |
