# 使用手册

这份文件是入口索引。完整、带搜索和侧边栏的文档站源码在 `docs/`，用 VitePress 构建：

```bash
npm install
npm run docs:dev      # 本地预览 http://localhost:5173
npm run docs:build    # 产物在 docs/.vitepress/dist
```

## 开始使用

- [概览](./guide/index.md)
- [快速开始](./guide/quick-start.md)
- [安装与加载](./guide/install.md)

## 日常使用

- [站点与插件](./guide/stations.md)
- [登录与会话](./guide/session.md)
- [采集价格](./guide/collection.md)
- [价格对比](./guide/dashboard.md)
- [成本与推荐](./guide/cost.md)
- [基准参考价](./guide/openrouter-prices.md)

## 配置

- [配置总览](./configuration/index.md)
- [站点配置字段](./configuration/station-fields.md)
- [偏好与成本](./configuration/settings.md)
- [模型匹配](./configuration/matching.md)

## 参考

- [常见问题](./faq.md)
- [故障排查](./troubleshooting.md)
- [隐私与安全](./security.md)
- [生态](./ecosystem.md)

## 一句话版本

1. 加载本仓库根目录。
2. 点仪表盘顶栏的齿轮「设置」，在「插件仓库」装站点插件，再到「已安装」对插件点「添加站点」。
3. 点「刷新全部」采集，回面板看比价表。
4. 在「偏好与成本」里填月用量，看月成本和价差。