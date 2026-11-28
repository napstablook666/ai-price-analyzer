// 站点体检：跑一遍在线审计，把每站结果与基线比对，只输出「和上次比哪里变了」。
//
// 与 direct-audit 的分工：
//   direct-audit.mjs  回答「这一跑能不能采集、覆盖多少」
//   health-check.mjs  回答「和上次比，哪几家变了、变在哪、该发版还是该打补丁」
//
// 分类固定 8 类，名字对齐 keiyoushi 的 issue 标签口径：
//   ok / price-drift / catalog-shrunk / structure-changed
//   auth-wall / domain-moved / http-error / timeout
//
// 用法：
//   node scripts/health-check.mjs --json out/health/report.json
//   node scripts/health-check.mjs --only 0ait,agentgate
//   node scripts/health-check.mjs --update-baseline   # 人工确认变化无误后再跑

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditDirectSites, directEntries, summarize } from "./direct-audit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_FILE = path.join(ROOT, "scripts", "health", "baseline.json");
const OUT_DIR = path.join(ROOT, "out", "health");
const LAST_RUN_FILE = path.join(OUT_DIR, "last-run.json");
const STATE_FILE = path.join(OUT_DIR, "state.json");
const STATUS_FILE = path.join(OUT_DIR, "status.md");

const BASELINE_SCHEMA = 1;
const SHRINK_RATIO = 0.7;      // 模型数跌破基线的 70% 视作目录收缩
const MEDIAN_SHIFT = 0.2;      // 中位价偏移超过 20% 视作整体调价
const MODEL_DRIFT_RATIO = 3;   // 单个模型涨跌超过 3 倍视作异常
const MAX_EVIDENCE = 3;

export const CLASS_LABELS = {
  ok: "正常",
  "price-drift": "报价变化",
  "catalog-shrunk": "目录收缩",
  "structure-changed": "结构变化",
  "auth-wall": "认证墙",
  "domain-moved": "域名/端点变化",
  "http-error": "HTTP/传输失败",
  timeout: "超时"
};

// 每类该走哪条修法，决定了报告怎么分组。
const FIX_ROUTE = {
  "price-drift": "补丁",
  "catalog-shrunk": "补丁",
  "structure-changed": "发版",
  "domain-moved": "发版",
  "http-error": "发版",
  timeout: "观察"
};

const LEVEL_ORDER = ["green", "yellow", "red", "obsolete"];

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function hostOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function fingerprintOf(result) {
  return {
    host: hostOf(result.endpoint),
    httpStatus: result.httpStatus ?? null,
    responseFormat: result.responseFormat || "unknown",
    models: Number(result.pricedModels) || 0,
    rows: Number(result.rows) || 0,
    modes: Object.keys(result.billingModes || {}).sort(),
    currency: [...(result.currency || [])].sort(),
    ratioBase: result.ratioBase ?? null
  };
}

export function samplesMap(samples = []) {
  const map = {};
  for (const entry of samples) {
    if (!Array.isArray(entry)) continue;
    const [model, input, output] = entry;
    if (!model) continue;
    map[String(model)] = [input ?? null, output ?? null];
  }
  return map;
}

function isTimeoutReason(reason) {
  return /timeout|timed out|ETIMEDOUT|aborted|socket hang up/i.test(String(reason || ""));
}

function isDnsReason(reason) {
  return /ENOTFOUND|EAI_AGAIN|getaddrinfo|DNS|name not resolved/i.test(String(reason || ""));
}

function anyModelDrift(previous, current) {
  const hits = [];
  for (const [model, price] of Object.entries(current)) {
    const before = previous[model];
    if (!before) continue;
    const from = Number(before[0]);
    const to = Number(price[0]);
    if (!(from > 0) || !(to > 0)) continue;
    const ratio = to / from;
    if (ratio >= MODEL_DRIFT_RATIO || ratio <= 1 / MODEL_DRIFT_RATIO) {
      hits.push({ model, from, to, ratio });
    }
  }
  hits.sort((left, right) => Math.abs(Math.log(right.ratio)) - Math.abs(Math.log(left.ratio)));
  return hits.slice(0, MAX_EVIDENCE);
}

function medianRatio(previous, current) {
  const ratios = [];
  for (const [model, price] of Object.entries(current)) {
    const before = previous[model];
    if (!before) continue;
    const from = Number(before[0]);
    const to = Number(price[0]);
    if (!(from > 0) || !(to > 0)) continue;
    ratios.push(to / from);
  }
  if (!ratios.length) return null;
  ratios.sort((left, right) => left - right);
  return ratios[Math.floor(ratios.length / 2)];
}

function formatRatio(value) {
  if (!Number.isFinite(value)) return "?";
  return `${Math.round(value * 100) / 100}x`;
}

// 判定顺序即优先级：先排除「根本没拿到数据」，再比结构，最后才谈价格。
export function classify({ result, baseline = null, lastSamples = null }) {
  const current = fingerprintOf(result);
  const isNew = !baseline;

  if (result.state === "BLOCKED") {
    if (result.reasonCategory === "auth") {
      return { klass: "auth-wall", current, isNew, evidence: [`HTTP ${result.httpStatus ?? "?"} 认证/权限阻断`] };
    }
    if (isTimeoutReason(result.reason)) return { klass: "timeout", current, isNew, evidence: [result.reason] };
    if (isDnsReason(result.reason)) return { klass: "domain-moved", current, isNew, evidence: [`域名解析失败：${result.reason}`] };
    return { klass: "http-error", current, isNew, evidence: [result.reason] };
  }

  if (result.state === "FAIL") {
    if (result.reasonCategory === "http" && Number(result.httpStatus) >= 500) {
      return { klass: "http-error", current, isNew, evidence: [`HTTP ${result.httpStatus}`] };
    }
    return {
      klass: "structure-changed",
      current,
      isNew,
      evidence: [`${result.reasonCategory || "fail"}：${result.reason || "解析失败"}`]
    };
  }

  if (isNew) return { klass: "ok", current, isNew, evidence: ["首次登记"] };

  // 域名/端点换了位置：先于一切数据比较。
  if (current.host && baseline.host && current.host !== baseline.host) {
    return { klass: "domain-moved", current, isNew, evidence: [`端点 ${baseline.host} → ${current.host}`] };
  }

  const modeChanged = current.modes.join(",") !== (baseline.modes || []).join(",");
  if (modeChanged) {
    return {
      klass: "structure-changed",
      current,
      isNew,
      evidence: [`计费模式 ${(baseline.modes || []).join(",") || "none"} → ${current.modes.join(",") || "none"}`]
    };
  }

  if (baseline.models > 0 && current.models < baseline.models * SHRINK_RATIO) {
    return {
      klass: "catalog-shrunk",
      current,
      isNew,
      evidence: [`模型数 ${baseline.models} → ${current.models}`]
    };
  }

  const currencyChanged = current.currency.join(",") !== (baseline.currency || []).join(",");
  const ratioChanged = current.ratioBase !== (baseline.ratioBase ?? null);

  const evidence = [];
  let drifted = false;

  if (ratioChanged) {
    evidence.push(`倍率基准 ${baseline.ratioBase ?? "无"} → ${current.ratioBase ?? "无"}`);
    drifted = true;
  }
  if (currencyChanged) {
    evidence.push(`币种 ${(baseline.currency || []).join(",") || "无"} → ${current.currency.join(",") || "无"}`);
    drifted = true;
  }

  if (lastSamples) {
    const hits = anyModelDrift(lastSamples, samplesMap(result.priceSamples || []));
    if (hits.length) {
      drifted = true;
      for (const hit of hits) {
        evidence.push(`${hit.model} 输入价 ${hit.from} → ${hit.to}（${formatRatio(hit.ratio)}）`);
      }
    }
    const median = medianRatio(lastSamples, samplesMap(result.priceSamples || []));
    if (median !== null && Math.abs(median - 1) > MEDIAN_SHIFT) {
      drifted = true;
      evidence.push(`中位价 ${formatRatio(median)}`);
    }
  }

  if (drifted) return { klass: "price-drift", current, isNew, evidence: evidence.slice(0, MAX_EVIDENCE + 2) };
  return { klass: "ok", current, isNew, evidence: [] };
}

// 认证墙既不推进退役计时，也不重置它——它既不是坏，也不是恢复。
export function nextLevel(level = "green", klass) {
  const current = LEVEL_ORDER.includes(level) ? level : "green";
  if (klass === "ok") return "green";
  if (klass === "auth-wall") return current;
  if (current === "green") return "yellow";
  if (current === "yellow") return "red";
  return "obsolete";
}

// 出口可疑（本机到不了、CI runner 出不去）时候判结果不算数，既不能推进也不能复位。
// ok 例外：真拿到数据就说明这一站通了，照常回绿。
export function decideLevel({ lastLevel = "green", klass, environmentSuspect = false }) {
  const advanced = nextLevel(lastLevel, klass);
  const held = Boolean(environmentSuspect) && klass !== "ok";
  return { level: held ? (LEVEL_ORDER.includes(lastLevel) ? lastLevel : "green") : advanced, held };
}

export function levelLabel(level) {
  if (level === "green") return "—";
  if (level === "yellow") return "1 期";
  if (level === "red") return "2 期";
  return "3 期+";
}

function row(line) {
  return `| ${line.join(" | ")} |`;
}

export function renderStatus({ items, counts, generatedAt, previousLevels = {} }) {
  const lines = [];
  const escalated = items.filter(item => ["red", "obsolete"].includes(item.level) && previousLevels[item.id] !== item.level);
  lines.push(`# 站点体检 ${generatedAt}`);
  lines.push("");
  lines.push(`覆盖 ${counts.total} 站：${Object.entries(counts.byClass)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ")}`);
  if (escalated.length) {
    lines.push("");
    lines.push(`新增待处理（进入 red/obsolete）：${escalated.length} 站 —— ${escalated.map(item => item.id).join("、")}`);
  }
  if (counts.recovered.length) {
    lines.push("");
    lines.push(`本次恢复：${counts.recovered.join("、")}`);
  }

  const groups = [
    ["需要发版处理", ["structure-changed", "domain-moved", "http-error"]],
    ["报价变化，可走补丁", ["price-drift", "catalog-shrunk"]],
    ["认证墙（不是坏）", ["auth-wall"]],
    ["观察中", ["timeout"]],
    ["退役候选", []]
  ];

  for (const [title, classes] of groups) {
    // 退役候选组独占 obsolete，避免同一个站同时出现在「需要发版」和「退役候选」里。
    const rows = items.filter(item => (item.level === "obsolete"
      ? !classes.length
      : classes.includes(item.klass)));
    if (!rows.length) continue;
    lines.push("");
    lines.push(`## ${title}`);
    lines.push("");
    lines.push(row(["站点", "名称", "分类", "持续", "证据"]));
    lines.push(row(["---", "---", "---", "---", "---"]));
    for (const item of rows.sort((left, right) => String(left.id).localeCompare(String(right.id)))) {
      const evidence = item.evidence.map(text => String(text).replace(/\|/g, "／")).join("；") || "—";
      lines.push(row([`\`${item.id}\``, item.name, CLASS_LABELS[item.klass] || item.klass, levelLabel(item.level), evidence]));
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

// 一整轮里网络层阻断占比过高，说明是这台机器的出口有问题（没配代理、CI runner
// 到不了海外），不是这些站变了。这种情况照判会批量刷红，把真正的变化淹没。
export function environmentVerdict(results, { minSample = 8, ceiling = 0.15 } = {}) {
  const network = results.filter(result => result.reasonCategory === "network").length;
  const ratio = results.length ? network / results.length : 0;
  const suspect = results.length >= minSample && ratio > ceiling;
  return {
    network,
    total: results.length,
    blockedRatio: Math.round(ratio * 1000) / 1000,
    suspect,
    note: suspect
      ? `网络层阻断 ${network}/${results.length}（${Math.round(ratio * 100)}%），疑似本机出口问题，结论不可作为站点判据`
      : ""
  };
}

export function summarizeHealth(items, previousLevels = {}) {
  const byClass = Object.fromEntries(Object.keys(CLASS_LABELS).map(key => [key, 0]));
  for (const item of items) byClass[item.klass] = (byClass[item.klass] || 0) + 1;
  return {
    total: items.length,
    byClass,
    escalated: items.filter(item => ["red", "obsolete"].includes(item.level) && previousLevels[item.id] !== item.level).map(item => item.id),
    recovered: items.filter(item => item.klass === "ok" && previousLevels[item.id] && previousLevels[item.id] !== "green").map(item => item.id),
    obsolete: items.filter(item => item.level === "obsolete").map(item => item.id)
  };
}

export function exitCodeForHealth(counts) {
  if (!counts.total) return 2;
  if (counts.escalated.length) return 1;
  return 0;
}

function parseArgs(args) {
  const value = flag => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : "";
  };
  return {
    jsonPath: value("--json"),
    baselinePath: value("--baseline") || BASELINE_FILE,
    statePath: value("--state") || STATE_FILE,
    lastRunPath: value("--last-run") || LAST_RUN_FILE,
    statusPath: value("--status") || STATUS_FILE,
    only: value("--only"),
    concurrency: Number(value("--concurrency")) || undefined,
    updateBaseline: args.includes("--update-baseline"),
    quiet: args.includes("--quiet")
  };
}

function loadBaseline(file) {
  const raw = readJson(file, null);
  if (!raw || typeof raw !== "object" || !raw.plugins) return { schemaVersion: BASELINE_SCHEMA, plugins: {} };
  return { schemaVersion: BASELINE_SCHEMA, plugins: raw.plugins };
}

function loadState(file) {
  const raw = readJson(file, null);
  if (!raw || typeof raw !== "object" || !raw.plugins) return { plugins: {} };
  return { plugins: raw.plugins };
}

function loadLastRun(file) {
  const raw = readJson(file, null);
  if (!raw || typeof raw !== "object" || !raw.plugins) return { plugins: {} };
  return { plugins: raw.plugins };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const baseline = loadBaseline(options.baselinePath);
  const state = loadState(options.statePath);
  const lastRun = loadLastRun(options.lastRunPath);

  const allEntries = directEntries();
  const only = options.only ? new Set(options.only.split(",").map(value => value.trim()).filter(Boolean)) : null;
  const entries = only ? allEntries.filter(entry => only.has(entry.id)) : allEntries;
  if (!entries.length) {
    console.error("没有匹配的 direct 站点，检查 --only 参数。");
    return 2;
  }

  const results = await auditDirectSites({
    entries,
    includeSamples: true,
    ...(options.concurrency ? { concurrency: options.concurrency } : {})
  });

  const generatedAt = new Date().toISOString();
  const previousLevels = Object.fromEntries(Object.entries(state.plugins).map(([id, value]) => [id, value.level || "green"]));
  const items = [];

  // 出口可疑时整轮冻结：一台没配代理的机器不该把一批站各推一期。
  const environment = environmentVerdict(results);
  if (environment.suspect && !options.quiet) {
    console.warn(`⚠ ${environment.note}`);
  }

  for (const result of results) {
    const previous = baseline.plugins[result.id] || null;
    const lastSamples = lastRun.plugins[result.id]?.samples
      ? samplesMap(lastRun.plugins[result.id].samples)
      : null;
    const verdict = classify({ result, baseline: previous, lastSamples });
    const { level, held } = decideLevel({
      lastLevel: previousLevels[result.id] || "green",
      klass: verdict.klass,
      environmentSuspect: environment.suspect
    });
    items.push({
      id: result.id,
      name: result.name || result.id,
      state: result.state,
      klass: verdict.klass,
      route: FIX_ROUTE[verdict.klass] || "—",
      level,
      evidence: held ? ["出口可疑，本轮不推进", ...verdict.evidence] : verdict.evidence,
      isNew: verdict.isNew,
      current: verdict.current
    });
    if (held) {
      const existing = state.plugins[result.id] || {
        level: lastLevel,
        klass: verdict.klass,
        since: generatedAt
      };
      state.plugins[result.id] = { ...existing, level, updatedAt: generatedAt };
      continue;
    }
    state.plugins[result.id] = {
      level,
      klass: verdict.klass,
      since: previousLevels[result.id] === level ? (state.plugins[result.id]?.since || generatedAt) : generatedAt,
      updatedAt: generatedAt
    };
  }

  const counts = summarizeHealth(items, previousLevels);
  const audit = summarize(results);

  // 基线只在人工确认后更新，且只吸收真正拿到数据的站；阻断/失败的站保留旧指纹，
  // 否则一次网络抖动就会把「坏」写进基线，下次永远判 ok。
  if (options.updateBaseline) {
    for (const item of items) {
      if (!["OK", "WARN"].includes(item.state)) continue;
      baseline.plugins[item.id] = item.current;
    }
    baseline.generatedAt = generatedAt;
    writeJson(options.baselinePath, baseline);
    if (!options.quiet) console.log(`基线已更新 ${options.baselinePath}（${Object.keys(baseline.plugins).length} 站）`);
  }

  const sampleStore = { generatedAt, plugins: {} };
  for (const result of results) {
    if (!result.priceSamples?.length) continue;
    sampleStore.plugins[result.id] = { samples: result.priceSamples };
  }
  writeJson(options.lastRunPath, sampleStore);
  writeJson(options.statePath, state);

  const status = renderStatus({ items, counts, generatedAt, previousLevels });
  mkdirSync(path.dirname(options.statusPath), { recursive: true });
  writeFileSync(options.statusPath, status);

  if (options.jsonPath) {
    writeJson(path.resolve(process.cwd(), options.jsonPath), { generatedAt, audit, environment, counts, items });
  }

  if (!options.quiet) {
    for (const item of items) {
      if (item.klass === "ok") continue;
      console.log(`${item.id.padEnd(20)} ${item.klass.padEnd(18)} ${levelLabel(item.level).padEnd(5)} ${item.evidence.join("；")}`);
    }
    console.log(`\n${Object.entries(counts.byClass).filter(([, value]) => value > 0).map(([key, value]) => `${key}=${value}`).join(" ")}`);
    console.log(`audit: ok=${audit.ok} warn=${audit.warn} fail=${audit.fail} blocked=${audit.blocked}`);
    if (counts.escalated.length) console.log(`新增待处理：${counts.escalated.join("、")}`);
    console.log(`状态文件 ${path.relative(ROOT, options.statusPath)}`);
  }

  return exitCodeForHealth(counts);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
