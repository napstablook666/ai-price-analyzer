# 规范模型表 🧬

比价表要合并同一模型，就得有一份「基准叫什么」的名单。这份名单就是规范模型表，由 `canonical/build.mjs` 生成。

## 数据来源

| 来源 | 用途 | 接口 |
| --- | --- | --- |
| OpenRouter | 身份入口集合 | `https://openrouter.ai/api/v1/models` |
| models.dev | 补厂商原生写法别名 | `https://models.dev/api.json` |

口径：**入口集合只收 OpenRouter 收录的身份**。models.dev 独有的身份不进表，只以别名并入相邻组。

原始响应缓存在 `canonical/.cache/`，`--offline` 时只读缓存，不发网络请求。

## 归一规则

与 `src/core/canonical.js` 必须保持一致，改一边就要改另一边：

1. 取 id 的最后一段，丢掉 `openrouter` / `fireworks/models` / `@cf/qwen` 这类路径前缀。
2. 去掉装饰后缀：`:free`、`:thinking`、`:official`、`@eu`、`@default`、`-v1`、`-YYYYMMDD`。
3. 小写；`.` 和 `_` 一律当作 `-`。
4. **不做任何版本数字合并**：`v4.1` 与 `v4` 是两个模型。
5. 入口集合只收 OpenRouter 身份；models.dev 独有身份仅作别名。

规则 4 是有意为之。把 `4.1` 并进 `4` 会让新模型的涨价被历史价格摊平，宁可多一行。

装饰后缀的清洗最多迭代三轮，处理 `:free:thinking` 这种叠加写法：

```js
const DECORATIONS = [
  /:(?:free|thinking|official|fast|online|extended|beta|none|auto|batch)$/,
  /:peft:\d+$/,
  /@(?:eu|us|global|jp|au|in|cn|default|\d+)$/,
  /-v\d+(?::\d+)?$/,
  /-(?:19|20)\d{2}(?:0\d|1[0-2])?(?:[0-3]\d)?$/
];
```

## 生成产物

```bash
node canonical/build.mjs            # 在线拉取后生成
node canonical/build.mjs --offline  # 只用 canonical/.cache/
```

产物是 `src/core/canonical-table.js`，内容是一张表：

```js
{ id: "claude-sonnet-4", vendor: "anthropic", aliases: ["claude-3-5-sonnet", "claude sonnet 4"] }
```

表是生成物，不进代码评审的手工修改范围。要加别名，改的是插件里的 `models.json` 或用户侧的人工覆盖。

## 什么时候要重算

- 上游新增模型，比价表里出现「未匹配」且确实有基准价。
- 上游改了模型 id 写法。
- 改了 `canonical.js` 的归一逻辑（两边必须同步）。

重算后跑 `npm test`，`model-identity.test.js` 会抓归一行为变化。

## 查某个写法落到哪

```bash
node scripts/model-lookup.mjs "claude 3.5 sonnet (20241022)"
```

输出是规范 id 和命中的规则。查不到就说明该写法不在表里，需要别名或人工覆盖。

## 相关

- [模型匹配](../configuration/matching)
- [扩展侧插件协议](../plugin-development)
- [测试与验收](./testing)