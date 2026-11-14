# 站点字段 reference ⚙️

添加站点就是填这一组字段。改错了不会炸，只是数字不准或采集失败，所以下面每条都写清楚填错的症状。

## 基本信息

| 字段 | 类型 | 说明 | 填错会怎样 |
| --- | --- | --- | --- |
| `name` | 文本 | 显示名，随便起 | 不影响采集 |
| `baseUrl` | URL | 站点根地址，必须带协议 | 采集全失败，通常报 DNS 或 404 |
| `enabled` | 布尔 | 关掉后不采集、不参与比价 | 面板里整行消失 |
| `mode` | `direct` / `page` | 采集通道，默认 `direct` | 见[站点与插件](../guide/stations) |
| `tags` | 字符串数组 | 自定义标签，用于筛选 | 只是分类 |

`baseUrl` 用根地址，不要带 `/pricing` 这类具体路径。路径由调接口的端点字段决定。

## 充值比例

充值比例决定「站点币值多少钱」。

| 字段 | 说明 |
| --- | --- |
| `rechargeRmb` | 实际付出的金额 |
| `rechargeCurrency` | 金额币种，`CNY` 或 `USD` |
| `rechargeCredits` | 到账的中转币数量 |
| `rechargeRate` | 推导出的单位成本，保存时自动算 |
| `rechargeRateVerified` | 是否人工确认过 |
| `rechargeRateNote` | 备注，写来源和日期 |

例子：充 100 元到账 200 万积分，就是 `rechargeRmb: 100`、`rechargeCredits: 2000000`，单位成本 `0.00005 元/积分`。

没核对过就别勾「已核实」。扩展会在状态里标「币种待核验」，折算结果打折看待。

## 价格口径

| 字段 | 说明 |
| --- | --- |
| `priceCurrency` | 站点报价的单位，只认 `CREDITS`（中转币，默认）、`CNY`、`USD`；填 `UNKNOWN` 表示单位没确认，折算会被标成币种待核验 |
| `priceCurrencyVerified` | 是否确认过单位含义 |
| `priceCurrencyNote` | 单位说明，比如「接口返回的是每 1M token 的中转币」 |
| `basePricePerMillion` | 站点声称的「基础价 / 1M USD」，用于反推折扣 |

`priceCurrency` 填错是成本算错最常见的原因。站点说「$3/M」时可能指美元，也可能指「3 个中转币」，这一栏就是区分它们的。

## 登录认证

`auth` 是一组字段，一次只用一种。

| `auth.type` | 需要的字段 | 用在哪 |
| --- | --- | --- |
| `none` | 无 | 公开价格页 |
| `bearer` | `token` | `Authorization: Bearer <token>` |
| `api-key` | `token` | `X-API-Key: <token>` |
| `basic` | `username` + `password` | HTTP Basic 认证 |

Token 存在扩展本地存储里，不进工作区文件、不进导出的 JSON。换设备要重填。

`page` 模式的站点不用填 token，用的是浏览器里的登录态。

## 采集适配器

`adapter` 描述「怎么问站点要价格」。

| 字段 | 说明 |
| --- | --- |
| `kind` | 适配器类型，默认 `custom` |
| `endpoint` | 相对 `baseUrl` 的路径，如 `/api/pricing` |
| `method` | `GET` 或 `POST` |
| `responseFormat` | 响应格式，默认 `auto` 自动识别 |
| `rawJson` | 手工填的响应示例，用于本地调试解析 |

`auto` 会依次试几种常见结构（`data` 数组、对象映射、`models` 列表）。识别不出来再手选格式。

带插件的站点（`plugins/<id>/`）不走这些字段，价格由插件代码采集，面板里对应配置项会隐藏。

## 签到

| 字段 | 说明 |
| --- | --- |
| `checkin.autoEnabled` | 是否参与每日签到，默认关 |
| `checkin.token` | 部分站点签到要单独 token |

签到细节见[每日签到](../guide/checkin)。

## 常见填错对照

| 数字不对 | 看这里 |
| --- | --- |
| 所有价格都差 1000 倍 | `priceCurrency` 是每 M 还是每 K |
| 价差恒为 0 | `rechargeCredits` 填成了「到账金额」而不是积分 |
| 输入价对、输出价差几倍 | 站点输出档位没对上，检查 responseFormat |
| 整站无数据 | `baseUrl` 或 `endpoint` 错，或需要登录 |

## 相关

- [偏好与成本](./settings)
- [模型匹配](./matching)
- [工作区文件格式](./workspace)