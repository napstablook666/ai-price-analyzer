// >>> rust-anything: scripts-lib-rs is on. `rust-anything disable ../../rust/scripts-lib-rs` removes this block.
// @ts-ignore
const __rustAnything_scripts_lib_rs = ((p) => p && p.env.RUST_ANYTHING_MODE !== 'old' && p.env.RUST_ANYTHING_UNIT_SCRIPTS_LIB !== 'original' && (() => { try { const m = p.getBuiltinModule('node:module'); const at = p.getBuiltinModule('node:path').join(import.meta.dirname, "../../rust/scripts-lib-rs/index.cjs"); return m.createRequire(at)(at) } catch (e) { if (p.env.RUST_ANYTHING_MODE === 'new') throw e } })())(globalThis.process)
// @ts-ignore
if (__rustAnything_scripts_lib_rs) { resolveMinShell = __rustAnything_scripts_lib_rs.resolveMinShell }
// <<< rust-anything: scripts-lib-rs
// update.json 里 minShell 的取值规则。
//
// minShell 是「自更新协议的最低兼容 shell 版本」，不是「这一版的版本号」。
// 取成本版版本号时，canSelfUpdate（src/core/self-update.js）与 update.ps1 都会
// 把任何更旧的安装挡在门外，自更新通道只对本版自己生效。
//
// 协议没有不兼容变更，这个值就必须保持不变。协议真的变了，才在 package.json
// 的 updateMinShell 里往上推，并在发布说明里写清为什么要手动下载一次。

import { compareVersions, parseVersion } from "../../src/core/update-check.js";

function normalize(value) {
  return String(value ?? "").trim().replace(/^v/i, "");
}

// 返回 { minShell, warnings }。取值不成立时直接抛错，不做静默回落：
// 回落到 version 正是把自更新关死的那条路径。
export function resolveMinShell({ cliValue, packageJson, version }) {
  const target = normalize(version);
  if (!parseVersion(target)) throw new Error(`版本号不是语义化版本：${target || "(空)"}`);

  const fromCli = normalize(cliValue);
  const fromPackage = normalize(packageJson?.updateMinShell);
  const source = fromCli || fromPackage;

  if (!source) {
    throw new Error(
      "缺少 updateMinShell：在 package.json 里写 \"updateMinShell\"（自更新协议的最低兼容版本），或用 --min-shell 显式传值"
    );
  }
  if (!parseVersion(source)) {
    throw new Error(`updateMinShell 不是语义化版本：${source}`);
  }

  // 清单声明的兼容下限比产出它的版本还新，说明写错了：装本版的人自己都不满足。
  if (compareVersions(source, target) === 1) {
    throw new Error(`updateMinShell ${source} 高于本版版本 ${target}，没有哪一版能自更新到它`);
  }

  const warnings = [];
  if (compareVersions(source, target) === 0) {
    warnings.push(
      `updateMinShell 等于本版版本 ${target}：只有装这一版的人能自更新，更旧的版本只能手动下载`
    );
  }
  if (fromCli && fromPackage && fromCli !== fromPackage) {
    warnings.push(`--min-shell ${fromCli} 覆盖了 package.json 的 updateMinShell ${fromPackage}`);
  }

  return { minShell: source, warnings };
}
