import { finitePrice, readPath } from "../price-map.js";

// 广场的分组状态只有 ok 的可信：unstable / bad / unknown 的价站点自己都不保证。
const PLAZA_GROUP_STATUS = "ok";

// 飓星API（token.stellaisle.com）的价格映射。站点把价格拆成两层，映射也拆两份。
//
// 1. stellaislePriceMap —— /api/pricing 的站内基准价。
//    报文和 TokenFlux 同构：data / group_ratio / usable_group / vendors 一次给齐，
//    规则一条不改地复用 tokenflux 那份，只换 source 名字。
//    这条路径只出基准价：94 条模型的 enable_groups 全是空数组，站点自己也不说哪个
//    模型在哪个渠道分组卖。早先按 emptyMeansAll 从倍率表的键反推，等于给每个模型
//    编出 17 个分组，gpt 模型被挂到「grok分组（特惠）」下面，站上根本没有这回事。
//
// 2. stellaislePlazaPriceMap —— /api/group-plaza 的分组广场，这才是真正能买的分组。
//    列表给 ratio / 状态 / 模型清单 / 供应商，逐组详情 /api/group-plaza/groups/{id}
//    给每个模型的真实价：tiered 给 billing_expr，token 给 input_per_m，
//    按次给 price_per_call。35 个分组里 status=ok 的 21 个展开成 178 行。
//
// 分组广场的价格口径（2026-11 实测验证，改之前先重验）：
// - token 模式：input_per_m 已经乘过分组倍率。同模型跨分组 input_per_m / ratio 恒定
//   （codex-auto-review 在 7 个分组全是 0.75，claude-opus-5-5 在 6 个分组全是 4）。
// - 按次模式：price_per_call 同样已经乘过（gpt-image-2.5 在 ratio 0.143 的分组是
//   0.02145，等于基准 0.15 × 0.143）。
// - tiered 模式：billing_expr 没乘。分组 11 的 gemini-3.8-flash 是 p*0.75，乘 0.473
//   得 0.35475，正好等于同组 gemini-3.8-flash-high 的 input_per_m。
// 所以前两种的倍率恒为 1，只有表达式那一档按分组 ratio 现乘。这条差异落在
// normalizers 的展开逻辑里（每条数据的 __group_ratio），映射只负责读它。

import { tokenfluxPriceMap } from "./tokenflux.js";

export const stellaislePriceMap = {
  ...tokenfluxPriceMap,
  source: "stellaisle",
  groups: { ...tokenfluxPriceMap.groups, unlisted: "站内基准价" }
};

export const stellaislePlazaPriceMap = {
  schemaVersion: "price-map/1",
  source: "stellaisle",
  rootPath: "/data",
  nameField: "model_name",
  labelField: "model_name",
  // 广场的价也是美元额度：group 17 的 claude-opus-5-5 输入 1.76 = 4 × 0.44（分组倍率），
  // 与主站 /api/pricing 同一套单位。页面标 ¥ 是因为站点 FAQ 写明「1 元 = 1 美元额度」，
  // 换算系数本来就是 1，改回 USD 只是把口径说对，数字不动。
  currency: "USD",
  groups: {
    // 展开时每条数据都带着分组名与倍率，不用再查站点级表。
    listPath: "__group_name",
    ratioField: "__group_ratio"
  },
  rules: [
    {
      when: { path: "billing_expr", present: true },
      kind: "expression",
      exprPath: "billing_expr"
    },
    {
      when: { path: "pricing_mode", equals: "per_call" },
      kind: "request",
      price: "price_per_call",
      unit: "image",
      mediaType: "image"
    },
    {
      when: { path: "pricing_mode", equals: "token" },
      kind: "token",
      input: "input_per_m",
      output: "output_per_m",
      cacheRead: "cached_input_per_m",
      cacheWrite: "cache_write_per_m",
      tierName: "标准"
    }
  ]
};

// ---------- 分组广场的报文读取 ----------
// 这段住在映射旁边而不是采集器里：golden 快照要直接跑它，才能把「整包响应解包」
// 这类形状问题钉在测试里（早先漏解一层，线上一直退回基准价）。
// 分组表的报文是 {data:{items:[…],total,…}}，明细是逐组响应体的数组。
export function stellaislePlazaGroups(raw) {
  const aux = raw && typeof raw === "object" ? raw.__aux : null;
  const items = readPath(aux, "groups.data.items");
  return Array.isArray(items) ? items : [];
}

export function stellaislePlazaPrices(raw) {
  const aux = raw && typeof raw === "object" ? raw.__aux : null;
  return Array.isArray(aux?.groupPrices) ? aux.groupPrices : [];
}

export function stellaislePlazaAvailable(raw) {
  return stellaislePlazaGroups(raw).length > 0 && stellaislePlazaPrices(raw).length > 0;
}

export function stellaislePlazaRows(raw) {
  const byId = new Map();
  for (const entry of stellaislePlazaPrices(raw)) {
    // 逐条拉取存的是整包响应（{success,data:{group_id,…}}），分组详情在 data 里。
    // 早先拿裸详情测，这条解包漏了，线上一直退回基准价。
    const detail = entry && typeof entry === "object" && entry.data && typeof entry.data === "object" ? entry.data : entry;
    if (!detail || typeof detail !== "object") continue;
    const id = String(detail.group_id ?? "").trim();
    if (id) byId.set(id, detail);
  }
  const data = [];
  for (const group of stellaislePlazaGroups(raw)) {
    if (!group || typeof group !== "object") continue;
    // 站点把不可用的分组也列在表里（unstable / bad / unknown），价格不可信，跳过。
    if (String(group.status ?? "").trim() !== PLAZA_GROUP_STATUS) continue;
    const id = String(group.group_id ?? "").trim();
    const detail = byId.get(id);
    if (!detail) continue;
    const ratio = finitePrice(group.ratio);
    if (ratio === null) continue;
    const groupName = String(group.name ?? "").trim() || `分组 ${id}`;
    const vendor = String(group.vendor_name ?? "").trim();
    const label = vendor ? `${vendor} · ${groupName}` : groupName;
    const prices = Array.isArray(detail.model_prices) ? detail.model_prices : [];
    for (const price of prices) {
      if (!price || typeof price !== "object") continue;
      const model = String(price.model_name ?? "").trim();
      if (!model) continue;
      const mode = String(price.pricing_mode ?? "").trim();
      // unconfigured 是站上还没定价的占位模型。
      if (!mode || mode === "unconfigured") continue;
      // token 与按次的价已经在站内乘过分组倍率，标成 1 免得映射再乘一次；
      // 只有 tiered 的 billing_expr 是未折算的，按分组 ratio 现乘。
      const billed = mode !== "tiered";
      data.push({ ...price, model_name: model, __group_name: label, __group_ratio: billed ? 1 : ratio });
    }
  }
  return data;
}
