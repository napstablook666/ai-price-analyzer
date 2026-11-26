// Rust wasm 单元的构建输入指纹。
//
// 为什么需要：`rust-wire-check.mjs` 要判断「产物是不是比源码旧」。用提交时间比不准——
// 源码改动如果不影响 codegen（比如删掉一个多余的取址），重建出来的 wasm 字节完全一致，
// `rust-dist/` 里不会有新提交，产物路径的最后提交永远停在旧的那次，检查就永久红。
// 改比输入指纹：产物里存一份「我这次是照着哪些文件编出来的」的哈希，检查时按当前文件
// 重算一次，对上了就是新的，对不上就是该重建。字节变没变不参与判断。
//
// 指纹只读 crate 目录内的相对路径，产物要提交进仓库，绝对路径会让换机器签出后立刻判旧。

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** 参与指纹的文件：crate 的 src/ 全树 + Cargo.toml + Cargo.lock + rust-anything.json。 */
function inputFiles(crateDir) {
  const files = [];

  const walk = dir => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(join(crateDir, "src"));

  for (const name of ["Cargo.toml", "Cargo.lock", "rust-anything.json"]) {
    const path = join(crateDir, name);
    if (statSync(path, { throwIfNoEntry: false })) files.push(path);
  }

  return files;
}

/** crate 目录当前内容 → 稳定哈希。路径按 crate 内相对路径参与，跨机器一致。 */
export function sourceFingerprint(crateDir) {
  const hash = createHash("sha256");
  for (const file of inputFiles(crateDir)) {
    hash.update(relative(crateDir, file).replace(/\\/g, "/"));
    hash.update("\0");
    // 行尾归一：`core.autocrlf` 让同一份源码在工作区是 CRLF、在干净签出里也是 CRLF，
    // 但库里和别的机器上是 LF。不归一的话指纹跟签出方式绑定，verify:clean 会误判。
    hash.update(readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** 指纹文件名。 */
export const FINGERPRINT_NAME = "build-inputs.json";

export function fingerprintPayload(unitName, crateDir) {
  return { unit: unitName, source: sourceFingerprint(crateDir) };
}
