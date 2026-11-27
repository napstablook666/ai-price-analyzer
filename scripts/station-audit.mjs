// 兼容旧命令名：在线站点体检已统一到 direct-audit。
// 旧入口默认跑在线审计；需要只查口径时传 --inventory。
import { main } from "./direct-audit.mjs";

const args = process.argv.slice(2);
const modeArgs = args.includes("--inventory") || args.includes("--online") ? args : ["--online", ...args];

main(modeArgs).then(code => {
  process.exitCode = code;
}).catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
