---
layout: home

hero:
  name: AI 比价
  text: 在浏览器里横向比较 AI 中转站
  tagline: 采集一次，按模型身份对齐，用真实月成本做决定。浏览器扩展，无服务端，密钥不出本机。
  image:
    src: /logo.svg
    alt: AI 比价
  actions:
    - theme: brand
      text: 快速开始 🚀
      link: /guide/quick-start
    - theme: alt
      text: 它解决什么问题
      link: /guide/
    - theme: alt
      text: GitHub
      link: https://github.com/napstablook666/ai-price-analyzer

features:
  - icon: 🧩
    title: 一个站点一个插件
    details: 采集逻辑和站点知识放在插件里，新增站点只动插件目录，不用改核心。
  - icon: 🧬
    title: 先对齐模型身份
    details: 中转站把同一个模型写成十几种样子，扩展用规范模型表把它们归到同一行。
  - icon: 💰
    title: 按你的用量算月成本
    details: 输入、缓存读写、输出、图片分别计价，最后落到一个月账单和相对官方的价差。
  - icon: 🔐
    title: 登录态复用，密钥留本地
    details: 站点凭据存在扩展本地存储，模型服务密钥只进会话存储，两者都不发往任何第三方。
  - icon: 📦
    title: 不依赖构建链
    details: 仓库根目录就是可加载的扩展，没有 bundler、没有运行时依赖。
  - icon: 🧪
    title: 有测试兜底
    details: 核心、采集、匹配、插件生成物都有 node:test 用例，改完跑一遍。
---