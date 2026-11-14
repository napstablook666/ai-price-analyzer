# 站点插件

一个中转站一个目录。这里是插件的唯一手写源，`extension/src/site-plugins/` 下的同名文件和 `catalog.js` 都是从这里生成的。

```
<id>/
  manifest.json   站点元数据：id / name / host / mode / order / paths / description
  plugin.js       站点适配实现，export const sitePlugin
  models.json     站内模型写法 → 规范模型 id 的别名表，没有就留 {"aliases":{}}
```

改完必须重新生成：

```bash
node scripts/plugin-build.mjs          # 或 npm run plugins:build
node scripts/plugin-build.mjs --check  # 只检查有没有漂移
```

写别名之前先查规范 id：

```bash
node scripts/model-lookup.mjs claude sonnet
```

完整规范（字段含义、导入规则、匹配优先级、验收步骤、常见坑）见 [docs/plugin-development.md](../docs/plugin-development.md)。