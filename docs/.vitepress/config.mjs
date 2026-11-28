import { defineConfig } from "vitepress";
// GitHub Pages 项目站点部署在 /<repo>/ 下，构建时用 DOCS_BASE 传入；本地开发不设该变量，回落成根路径。
function resolveBase(raw) {
  if (!raw) return "/";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.endsWith("/") ? withSlash : `${withSlash}/`;
}

const base = resolveBase(process.env.DOCS_BASE);

const repo = "https://github.com/napstablook666/ai-price-analyzer";

export default defineConfig({
  lang: "zh-CN",
  title: "AI 比价",
  description:
    "AI 中转站价格对比扩展的文档：安装、采集、比价、成本估算、插件开发与故障排查。",
// 部署到 GitHub Pages 的项目路径时：DOCS_BASE=/ai-price-analyzer/ npm run docs:build
  base,
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ["link", { rel: "icon", href: `${base}logo.svg` }],
    ["meta", { name: "theme-color", content: "#0f766e" }],
  ],

  themeConfig: {
    logo: `${base}logo.svg`,
    siteTitle: "AI 比价文档",

    nav: [
      { text: "使用指南", link: "/guide/quick-start", activeMatch: "^/guide/" },
      { text: "配置", link: "/configuration/", activeMatch: "^/configuration/" },
      { text: "开发", link: "/development/", activeMatch: "^/development/" },
      { text: "常见问题", link: "/faq" },
      { text: "生态", link: "/ecosystem" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "开始使用",
          items: [
            { text: "概览", link: "/guide/" },
            { text: "快速开始 🚀", link: "/guide/quick-start" },
            { text: "安装与加载 🖥️", link: "/guide/install" },
          ],
        },
        {
          text: "日常使用",
          items: [
            { text: "站点与插件 🧩", link: "/guide/stations" },
            { text: "登录与会话 🔐", link: "/guide/session" },
            { text: "采集价格 📡", link: "/guide/collection" },
            { text: "价格对比 📊", link: "/guide/dashboard" },
            { text: "成本与推荐 💰", link: "/guide/cost" },
            { text: "基准参考价 🏛️", link: "/guide/openrouter-prices" },
          ],
        },
      ],

      "/configuration/": [
        {
          text: "配置",
          items: [
            { text: "配置总览 ⚙️", link: "/configuration/" },
            { text: "站点配置字段 📝", link: "/configuration/station-fields" },
            { text: "偏好与成本 🧮", link: "/configuration/settings" },
            { text: "模型匹配 🔗", link: "/configuration/matching" },
          ],
        },
        {
          text: "参考",
          items: [
            { text: "常见问题 ❓", link: "/faq" },
            { text: "故障排查 🧯", link: "/troubleshooting" },
            { text: "隐私与安全 🛡️", link: "/security" },
            { text: "免责声明 ⚖️", link: "/disclaimer" },
          ],
        },
      ],

      "/development/": [
        {
          text: "开发",
          items: [
            { text: "开发总览 🏗️", link: "/development/" },
            { text: "架构与数据流", link: "/architecture" },
            { text: "扩展侧插件协议", link: "/plugin-development" },
            { text: "规范模型表 🧬", link: "/development/canonical" },
            { text: "生图模型计费 🖼️", link: "/development/image-billing" },
            { text: "生图与视频比价坐标 📐", link: "/development/media-pricing" },
            { text: "价格映射文档 🧭", link: "/development/price-map" },
            { text: "测试与验收 🧪", link: "/development/testing" },
            { text: "站点体检 🩺", link: "/development/station-health" },
            { text: "发布流程 📦", link: "/development/release" },
          ],
        },
      ],
    },

    search: {
      provider: "local",
      options: {
        locales: {
          root: {
            translations: {
              button: {
                buttonText: "搜索",
                buttonAriaLabel: "搜索文档",
              },
              modal: {
                noResultsText: "没有找到结果",
                resetButtonTitle: "清除条件",
                resetButtonText: "清除",
                footer: {
                  selectText: "选择",
                  selectKeyAriaLabel: "回车",
                  navigateText: "切换",
                  navigateUpKeyAriaLabel: "上方向键",
                  navigateDownKeyAriaLabel: "下方向键",
                  closeText: "关闭",
                  closeKeyAriaLabel: "Esc",
                },
              },
            },
          },
        },
      },
    },

    editLink: {
      pattern: `${repo}/edit/main/docs/:path`,
      text: "在 GitHub 上编辑此页",
    },

    outline: {
      level: [2, 3],
      label: "本页目录",
    },

    docFooter: {
      prev: "上一篇",
      next: "下一篇",
    },

    lastUpdatedText: "最后更新",
    returnToTopLabel: "回到顶部",
    sidebarMenuLabel: "菜单",
    darkModeSwitchLabel: "外观",

    socialLinks: [{ icon: "github", link: repo }],

    footer: {
      message: '基于 GPL-3.0 发布，密钥只保存在浏览器本地 · 友链 <a href="https://linux.do/" target="_blank" rel="noopener noreferrer">LINUX DO 社区</a>',
      copyright: "AI Price Analyzer Contributors",
    },
  },
});