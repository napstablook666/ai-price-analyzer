// AllRouter（allrouter.cc）的价格映射。
//
// /api/pricing 匿名可读，报文和 TokenFlux 同构：data 是行数组，group_ratio / usable_group /
// enable_groups / supported_endpoint_types 都在，规则整份复用，只改两处：倍率类按 1 = $2 折算、
// 币种是美元。
//
// 站点口径（2026-11-18 实测 /api/pricing，52 个模型、102 条「模型 × 分组」）：
//   model_ratio 1 = $2/百万 token，与 billing_expr 里的美元系数对得上；抽样
//   claude-opus-5-5 ratio 2 ↔ expr p*4，claude-haiku-4-5 ratio 0.5 ↔ 官方 $1/M。
//   分组倍率是公开的，每条模型的 enable_groups 就是它真正在卖的分组：
//     default 0.75（官方 API）、deepseek 0.4、gemini 0.45、glm 0.3、gpt-azure-api 0.6、
//     claude-official-api 0.65、gpt 0.053（自营 codex 号池）、grok 0.045、
//     claude-max 0.25、kimi 号池 0.06。
//   站点计费口径就是「官方价 × 分组倍率」，见 docs.allrouter.cc/billing。
//
// 37 个模型把真实价写在 billing_expr 里，带长度分段（len <= 272000 之类）或分时条件
// （DeepSeek 三个：工作日 9–12 点与 14–18 点走 peak，其余时段与法定节假日走 off_peak 半价），
// 这些以表达式为准，ratio 只是占位。解析器只认识长度条件，不认 time 谓词，所以 DeepSeek
// 出两行（peak / off_peak），档位名自己说明了适用哪一段。
//
// 三个 gpt-image-2.5 的表达式是 p*5 + cr*1.25 + img*8 + c*30：img 系数按图片 token 计，
// 解析器不认，只报文本 token 价，按张的钱没有公开口径。

import { newcodexPriceMap } from "./newcodex.js";

const IMAGE_ENDPOINT = { path: "supported_endpoint_types", map: { "image-generation": "image" } };

// newcodex 那份就是 tokenflux + 倍率类乘 2，字段映射完全相同，只有两处要改：
// 币种换回美元，表达式规则补上媒体类型映射。
// 补 mediaType 是因为表达式规则本身不带它，而站点的出图模型恰恰全是表达式计费
// （gpt-image-2.5 走 tier("standard", p*5 + ...)），不补就会带着每百万 token 的价掉进文本榜。
export const allrouterPriceMap = {
  ...newcodexPriceMap,
  source: "allrouter",
  currency: "USD",
  rules: newcodexPriceMap.rules.map(rule => rule.kind === "expression" ? { ...rule, mediaType: IMAGE_ENDPOINT } : rule)
};
