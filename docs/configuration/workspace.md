# 工作区文件格式 📦

工作区文件是纯 JSON，可以进版本库、可以 diff。这份文档写清楚它的结构、写入口径和校验规则，方便你自己脚本化处理。

## 位置与命名

工作区是一个**目录**，扩展在目录里固定读写一个文件：

```
<你选的目录>/ai-price-analyzer.workspace.json
```

目录通过浏览器的目录选择器授权，句柄存在扩展本地。授权被回收或扩展重载后要重选目录。

## 顶层结构

```json
{
  "format": "ai-price-analyzer-workspace",
  "version": 1,
  "updatedAt": 1730000000000,
  "state": {
    "stations": [],
    "snapshots": [],
    "settings": {},
    "references": {}
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `format` | 固定 `ai-price-analyzer-workspace`，用于识别 |
| `version` | 目前是 `1`，不匹配直接拒绝加载 |
| `updatedAt` | 写入时的毫秒时间戳 |
| `state.stations` | 站点配置数组 |
| `state.snapshots` | 采集快照数组 |
| `state.settings` | 偏好与成本设置 |
| `state.references` | 官方参考价与汇率缓存 |

## 脱敏

站点里的 `auth` 只保留 `type`：

```json
{ "auth": { "type": "bearer" } }
```

`token`、`username`、`password` 在写入前被抹掉。所以：

- 工作区文件可以放心进版本库。
- 换设备恢复后需要重填凭据，签到也会停在「待登录」。

## 校验

加载时按顺序检查，任何一条不过就整份拒绝，不会半加载：

| 检查 | 失败提示 |
| --- | --- |
| `version` 等于 1 | 工作区文件版本不受支持 |
| 顶层是对象且 `stations` 是数组 | 工作区数据格式不正确 |
| 站点数与快照数在限制内 | 导入文件格式不正确 / 导入快照格式不正确 |
| 每条快照结构合法且不大于 2 MB | 导入快照格式不正确 |
| `references` 是对象且不大于 2 MB | 导入参考数据过大或格式不正确 |
| 文件是合法 JSON | 工作区文件不是有效 JSON |

限制值：

| 项 | 上限 |
| --- | --- |
| 站点数 | 100 |
| 快照数 | 500 |
| 单条记录 | 2 MB |
| 导入时快照年龄 | 30 天 |

## 写入口径

- 整体覆盖，不做字段级合并。
- 写入排队串行执行，连续两次保存按顺序落盘。
- 写入失败会 `abort` 掉临时文件，原文件保持上一次的内容。
- 目录里没有这个文件时，读取返回空，不报错。

## 与 JSON 导出的区别

| | 工作区文件 | 导出 JSON |
| --- | --- | --- |
| 顶层 | `format` + `version` + `state` | `version` + `exportedAt` + 平铺字段 |
| 写入方式 | 覆盖你选的目录 | 浏览器下载 |
| 快照 | 全部 | 最近 500 条 |
| 凭据 | 已抹除 | 已抹除 |
| 用途 | 长期同步 | 一次性备份、迁移 |

导出 JSON 更平铺：

```json
{ "version": 1, "exportedAt": 1730000000000, "settings": {}, "references": {}, "stations": [], "snapshots": [] }
```

导入时两种结构都能认：带 `format` 的按工作区文档解析，不带的按平铺状态解析。

## 手工编辑的边界

可以安全改：

- `settings.usage` 里的数字
- `settings.exchangeRate`
- 站点里的 `tags`、`name`、`rechargeRateNote`
- `references` 里明显过时的价格

不要改：

- `format`、`version`
- `stations[].id`（会断掉快照关联）
- 快照里的 `collectedAt`
- 键名大小写

改完先跑一次加载，报错就用备份回滚。

## 相关

- [工作区与备份](../guide/workspace)
- [站点字段](./station-fields)
- [偏好与成本](./settings)