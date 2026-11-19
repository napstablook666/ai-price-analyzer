#!/usr/bin/env node
// 充值取证第二步：把 out/recharge/<host>.json 合进 plugins/<id>/plugin.js。
// 只写 rechargePayments（收银台证据）；rechargeTiers 不动，避免和手写档位表打架。
// 生成段落带标记，重复跑不产生 diff；--check 只报告不写盘。

import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = path.resolve(here, "..");
const WORKSPACE_DIR = path.resolve(EXTENSION_DIR, "..");
const PLUGINS_DIR = path.join(WORKSPACE_DIR, "plugins");
const OUT_DIR = path.join(EXTENSION_DIR, "out", "recharge");

const BLOCK_START = "  // >>> recharge-probe（由 scripts/recharge-apply.mjs 生成，勿手改）";
const BLOCK_END = "  // <<< recharge-probe";
const BLOCK_PATTERN = /\n?[ \t]*\/\/ >>> recharge-probe[^\n]*\n[\s\S]*?[ \t]*\/\/ <<< recharge-probe\n/;
const PRESET_ANCHOR = "const preset = {\n";

function parseArgs(argv) {
  return { check: argv.includes("--check"), help: argv.includes("--help") || argv.includes("-h") };
}

function printHelp() {
  console.log(`用法：
  node scripts/recharge-apply.mjs           把 out/recharge/*.json 写进插件
  node scripts/recharge-apply.mjs --check   只报告谁会被改，不写盘`);
}

export function renderBlock(record) {
  const payments = Array.isArray(record.payments) ? record.payments : [];
  if (payments.length === 0) return null;
  const collectedDate = String(record.collectedAt || "").slice(0, 10);
  const lines = [BLOCK_START, "  rechargePayments: ["];
  for (const payment of payments) {
    const fields = [
      `channel: ${JSON.stringify(payment.channel)}`,
      `faceAmount: ${payment.faceAmount}`,
      `payAmount: ${payment.payAmount}`,
      `currency: ${JSON.stringify(payment.currency)}`
    ];
    if (Number.isFinite(payment.paidRmb)) fields.push(`paidRmb: ${payment.paidRmb}`);
    if (Number.isFinite(payment.feeRate)) fields.push(`feeRate: ${payment.feeRate}`);
    const at = payment.at || collectedDate;
    if (at) fields.push(`at: ${JSON.stringify(at)}`);
    if (payment.note) fields.push(`note: ${JSON.stringify(payment.note)}`);
    lines.push(`    { ${fields.join(", ")} },`);
  }
  lines.push("  ],", "  rechargePaymentsVerified: true,", BLOCK_END);
  return `${lines.join("\n")}\n`;
}

export function upsertBlock(source, block) {
  if (BLOCK_PATTERN.test(source)) return source.replace(BLOCK_PATTERN, `\n${block}`);
  const index = source.indexOf(PRESET_ANCHOR);
  if (index === -1) return null;
  const head = source.slice(0, index + PRESET_ANCHOR.length);
  const tail = source.slice(index + PRESET_ANCHOR.length);
  return `${head}${block}${tail}`;
}

async function loadRecords() {
  const entries = await readdir(OUT_DIR, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "auth.json") continue;
    try {
      const record = JSON.parse(await readFile(path.join(OUT_DIR, entry.name), "utf8"));
      if (record && typeof record === "object" && record.plugin && Array.isArray(record.payments)) records.push(record);
    } catch {
      // 手工编辑坏的 JSON 跳过，不阻断其它站。
    }
  }
  return records;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const records = await loadRecords();
  if (records.length === 0) {
    console.log(`${path.relative(EXTENSION_DIR, OUT_DIR)} 里没有可用的 JSON，先跑 npm run recharge:probe`);
    return;
  }

  let written = 0;
  let unchanged = 0;
  const skipped = [];
  for (const record of records) {
    const block = renderBlock(record);
    if (!block) {
      skipped.push(`${record.host}（payments 为空）`);
      continue;
    }
    const pluginPath = path.join(PLUGINS_DIR, record.plugin, "plugin.js");
    let source;
    try {
      source = await readFile(pluginPath, "utf8");
    } catch {
      skipped.push(`${record.host}（找不到 plugins/${record.plugin}/plugin.js）`);
      continue;
    }
    const next = upsertBlock(source, block);
    if (!next) {
      skipped.push(`${record.host}（plugins/${record.plugin}/plugin.js 没有 const preset 定义）`);
      continue;
    }
    if (next === source) {
      unchanged += 1;
      continue;
    }
    if (!args.check) await writeFile(pluginPath, next, "utf8");
    written += 1;
    console.log(`${args.check ? "会改" : "已写"} ${record.plugin}：${record.payments.length} 条渠道实付`);
  }

  if (args.check) console.log(`\n检查完成：${written} 个待更新，${unchanged} 个已一致，${skipped.length} 个跳过`);
  else console.log(`\n完成：写 ${written} 个，已一致 ${unchanged} 个，跳过 ${skipped.length} 个`);
  if (skipped.length) console.log(`跳过：${skipped.join("、")}`);
}

const isDirectRun = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
