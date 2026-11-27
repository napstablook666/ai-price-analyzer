import * as rust from "./rust-shim.js";

// 充值档位：额度升序去重，折扣必须在 (0,1]。空数组表示不建模折扣。
// 放在叶子模块里，避免 declarative-plugin 与 schema 互相 import 形成循环。
export function normalizeRechargeTiers(input) {
  return rust.normalizeRechargeTiers(input);
}

// 充值方案是展示/追溯元数据，不参与 rechargeTiers 的自动落档计算。
// 这样「需管理员处理」和「按周刷新订阅」不会被误当成永久充值折扣。
export function normalizeRechargePlans(input) {
  return rust.normalizeRechargePlans(input);
}
