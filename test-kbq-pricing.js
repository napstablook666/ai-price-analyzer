const fs = require("fs");
const assert = require("node:assert/strict");

const source = fs.readFileSync("AI中转站价格分析工具.js", "utf8");

function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`${name} not found`);
    let depth = 0;
    let opened = false;
    for (let index = start; index < source.length; index++) {
        if (source[index] === "{") {
            depth++;
            opened = true;
        }
        if (source[index] === "}" && opened && --depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`${name} not closed`);
}

const base = source.match(/const SYSTEM_BASE_PRICE_PER_1M = ([\d.]+)/)[1];
const aliases = source.match(/const MODEL_ALIASES = \{[\s\S]*?\n    \};/)[0];
const parserStart = source.indexOf("class ParsingStrategy");
const parserEnd = source.indexOf("\n    function normalizeProxyData", parserStart);
const parserCode = source.slice(parserStart, parserEnd).replace(/^    /gm, "");
const parse = Function(`const SYSTEM_BASE_PRICE_PER_1M = ${base}; ${parserCode}; return raw => new PqhPricingStrategy().parse(raw);`)();
const parseJiji = Function(`const SYSTEM_BASE_PRICE_PER_1M = ${base}; ${parserCode}; return raw => new JijiModelPlazaStrategy().parse(raw);`)();
const matchModel = Function(`${aliases}\n${extract("normalizeProxyModelName")}\n${extract("getOfficialNames")}\n${extract("cleanModelName")}\n${extract("removeVersion")}\n${extract("matchModel")}\nreturn matchModel;`)();
const prices = Function(`const SYSTEM_BASE_PRICE_PER_1M = ${base}; ${extract("currencyToRMB")}\n${extract("getProxyPrices")}\n${extract("workloadCost")}\nreturn { getProxyPrices, workloadCost };`)();

const sortResults = Function(`${extract("sortResults")} return sortResults;`)();
const sortRows = [
    { model_name: "cheap", real_cost: 10, diff_percent: -20 },
    { model_name: "premium", real_cost: 90, diff_percent: 40 },
    { model_name: "mid", real_cost: 50, diff_percent: 5 }
];
assert.deepEqual(sortResults(sortRows.slice(), { primary: "none", secondary: "real_cost", direction: "desc" }).map(row => row.model_name), ["premium", "mid", "cheap"]);
assert.deepEqual(sortResults(sortRows.slice(), { primary: "none", secondary: "diff_percent", direction: "desc" }).map(row => row.model_name), ["premium", "mid", "cheap"]);
assert.deepEqual(sortResults(sortRows.slice(), { primary: "none", secondary: "real_cost", direction: "asc" }).map(row => row.model_name), ["cheap", "mid", "premium"]);
const recommendationRows = [
    { model_name: "eligible", recommendation_score: 50, recommendation_eligible: true },
    { model_name: "verify", recommendation_score: 90, recommendation_eligible: false }
];
assert.deepEqual(sortResults(recommendationRows.slice(), { primary: "none", secondary: "recommendation_score", direction: "desc" }).map(row => row.model_name), ["eligible", "verify"]);
assert.deepEqual(sortResults(recommendationRows.slice(), { primary: "none", secondary: "recommendation_score", direction: "asc" }).map(row => row.model_name), ["verify", "eligible"]);
const filterReset = Function(`
    const chips = [false, false].map(() => {
        const chip = { active: false };
        chip.classList = { add() { chip.active = true; } };
        return chip;
    });
    const keyword = { value: "gpt" };
    const state = { modal: { querySelectorAll: () => chips } };
    const document = {};
    const getModalElement = () => keyword;
    let renderCount = 0;
    const applySortingAndRender = () => renderCount++;
    ${extract("resetFilters")}
    return { resetFilters, chips, keyword, getRenderCount: () => renderCount };
`)();
filterReset.resetFilters();
assert.deepEqual(filterReset.chips.map(chip => chip.active), [true, true]);
assert.equal(filterReset.keyword.value, "");
assert.equal(filterReset.getRenderCount(), 1);
const sinanTools = Function(`
    const SYSTEM_BASE_PRICE_PER_1M = ${base};
    const window = { location: { hostname: "compute.sinanlab.com", pathname: "/", hash: "" } };
    ${extract("firstNumber")}
    ${extract("isSinanModelPlaza")}
    ${extract("parseSinanPricingTable")}
    return { parseSinanPricingTable, window };
`)();
const jiji = {
    code: 0,
    data: {
        groups: [{
            name: "Codex Pro",
            rate_multiplier: 0.2,
            models: [{
                name: "gpt-5.4",
                pricing: {
                    input_price: 0.0000025,
                    output_price: 0.000015,
                    cache_write_price: 0.00000625,
                    cache_read_price: 0.00000025,
                    per_request_price: null
                }
            }, {
                name: "image-model",
                pricing: {
                    input_price: null,
                    output_price: null,
                    per_request_price: 0.025
                }
            }]
        }]
    }
};
const jijiParsed = parseJiji(jiji);
assert.equal(jijiParsed.data.length, 2);
const jijiToken = jijiParsed.data.find(item => item.model_name === "gpt-5.4");
assert.equal(jijiToken.input_price, 0.5);
assert.equal(jijiToken.output_price, 3);
assert.equal(jijiToken.cache_read_price, 0.05);
assert.equal(jijiToken.cache_write_price, 1.25);
assert.equal(jijiToken.group_ratio, 0.2);
assert.equal(jijiParsed.group_ratio["Codex Pro"], 0.2);
const jijiRequest = jijiParsed.data.find(item => item.model_name === "image-model");
assert.equal(jijiRequest.input_price, null);
assert.ok(Math.abs(jijiRequest.request_price - 0.005) < 1e-12);
const sinanRows = [
    ["openrouter 公开市场 · 供应商标价", "1.20 参考价", "0.200"],
    ["nomissapi.top NoMiss API", "0.534 抓取", "0.089"],
    ["待核渠道", "—", "—"]
].map(cells => ({ children: cells.map(textContent => ({ textContent })) }));
const sinanTable = {
    querySelectorAll(selector) {
        assert.equal(selector, "tbody tr");
        return sinanRows;
    }
};
for (const modelId of ["gpt-5.6-luna", "deepseek-v4.1-flash"]) {
    sinanTools.window.location.hash = `#m=${modelId}`;
    const sinanParsed = sinanTools.parseSinanPricingTable(sinanTable);
    assert.equal(sinanParsed.data.length, 2);
    assert.equal(sinanParsed.data[0].model_name, modelId);
    assert.equal(sinanParsed.data[0].output_price, 1.2);
    assert.equal(sinanParsed.data[0].input_price, 0.2);
    assert.equal(sinanParsed.data[1].proxy_group_name, "nomissapi.top NoMiss API");
    assert.equal(sinanParsed.data[1].output_price, 0.534);
    assert.equal(sinanParsed.data[1].input_price, 0.089);
}
const sinanOfficial = [
    { name: "openai/gpt-5.6-luna", aliases: ["gpt-5.6-luna"], provider: "openai" },
    { name: "deepseek/deepseek-v4.1-flash", aliases: ["deepseek-v4.1-flash"], provider: "deepseek" }
];
const sinanRules = [{ id: "exact", enabled: true, name: "完全匹配" }];
for (const modelId of ["gpt-5.6-luna", "deepseek-v4.1-flash"]) {
    assert.equal(matchModel(modelId, sinanOfficial, sinanRules).length, 1, modelId);
}
const raw = {
    group_ratio: { default: 1 },
    pricing_version: "kbq",
    data: [
        { model_name: "[0.2]deepseek-v4.1-flash-expires-on-0910", quota_type: 0, model_ratio: 0.15, model_price: 0, completion_ratio: 3, cache_ratio: 0.0333, enable_groups: ["default"] },
        { model_name: "[自部署]deepseek-v4.1-flash", quota_type: 0, model_ratio: 0.45, model_price: 0, completion_ratio: 3, cache_ratio: 0.033333333333, enable_groups: ["default"] },
        { model_name: "[次]deepseek-v4.1-flash", quota_type: 1, model_ratio: 0, model_price: 0.015, completion_ratio: 0, cache_ratio: null, create_cache_ratio: null, enable_groups: ["default"] }
    ]
};

const aggretoken = {
    success: true,
    pricing_version: "a42d372ccf0b5dd13ecf71203521f9d2",
    group_ratio: { Standard: 1 },
    auto_groups: ["Standard"],
    usable_group: { Standard: "默认分组" },
    data: [
        { model_name: "gpt-5.5", quota_type: 0, model_ratio: 0.35, model_price: 0, completion_ratio: 5, cache_ratio: 0.1, enable_groups: ["Ultra", "Pro", "Starter", "Standard"] },
        { model_name: "gpt-image-2", quota_type: 1, model_ratio: 0, model_price: 0.025, completion_ratio: 0, enable_groups: ["svip", "Standard", "default", "vip"] },
        { model_name: "claude-opus-4-7", quota_type: 0, model_ratio: 0.45, model_price: 0, completion_ratio: 5, cache_ratio: 0.1, enable_groups: ["default", "svip", "vip"] }
    ]
};
const official = [{ name: "deepseek/deepseek-v4.1-flash", aliases: ["deepseek-v4.1-flash"], provider: "deepseek" }];
const rules = [{ id: "exact", enabled: true, name: "完全匹配" }];
const parsed = parse(raw);
const aggretokenParsed = parse(aggretoken);
assert.equal(aggretokenParsed.data.length, 2);
assert.deepEqual([...new Set(aggretokenParsed.data.map(item => item.enable_groups[0]))], ["Standard"]);
const aggretokenToken = aggretokenParsed.data.find(item => item.model_name === "gpt-5.5");
assert.equal(aggretokenToken.input_price, 0.7);
assert.equal(aggretokenToken.output_price, 3.5);
const aggretokenRequest = aggretokenParsed.data.find(item => item.model_name === "gpt-image-2");
assert.equal(aggretokenRequest.request_price, 0.025);
assert.equal(aggretokenParsed.data.some(item => item.model_name === "claude-opus-4-7"), false);
const autoGroupSubset = {
    auto_groups: ["default", "codex-开业优惠"],
    group_ratio: { default: 0.6, "codex-开业优惠": 0.25, "codex-稳定": 0.5, vip: 1 },
    usable_group: {
        default: "全量模型可调用",
        "codex-开业优惠": "混合号池",
        "codex-稳定": "正价pro",
        vip: "vip分组"
    },
    data: [{
        model_name: "gpt-5.6-luna",
        model_ratio: 0.5,
        completion_ratio: 6,
        cache_ratio: 0.1,
        enable_groups: ["codex-稳定", "codex-开业优惠", "vip", "default"]
    }]
};
const autoGroupSubsetParsed = parse(autoGroupSubset);
assert.deepEqual(
    [...new Set(autoGroupSubsetParsed.data.map(item => item.enable_groups[0]))],
    ["codex-稳定", "codex-开业优惠", "vip", "default"]
    );

assert.equal(parsed.data.length, 3);
for (const item of parsed.data) assert.equal(matchModel(item.model_name, official, rules).length, 1, item.model_name);
const requestItem = parsed.data.find(item => item.model_name === "[次]deepseek-v4.1-flash");
assert.equal(requestItem.request_price, 0.015);
assert.equal(requestItem.cache_read_price, null);
const requestPrices = prices.getProxyPrices(requestItem, 1, 1);
assert.ok(Math.abs(prices.workloadCost(requestPrices, { requests: 1696, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }) - 25.44) < 1e-9);
const standardPrices = prices.getProxyPrices({ input_price: 2, output_price: 4, price_currency: "USD" }, 1, 1.2);
assert.equal(standardPrices.input, 2.4, "USD 价格应纳入自定义充值比例");
const cnyPrices = prices.getProxyPrices({ input_price: 2, output_price: 4, price_currency: "CNY" }, 1, 1.2);
assert.equal(cnyPrices.input, 2, "人民币价格不应重复乘充值比例");

const autorouter = {
    pricing_version: "v2",
    group_ratio: { default: 1, svip2: 1, "gpt-pro": 0.2, "gpt-auto": 0.4, "gpt-official": 0.75, "claude-max": 0.35, "claude-auto": 0.6, "claude-official": 0.75 },
    catalog_group_ratio: { default: 1, svip2: 1, "gpt-pro": 0.2, "gpt-auto": 0.4, "gpt-official": 0.75, "claude-max": 0.35, "claude-auto": 0.6, "claude-official": 0.75 },
    data: [{
        model_name: "deepseek-v4-pro",
        model_ratio: 0.225,
        completion_ratio: 2,
        cache_ratio: 0.08888888888888889,
        enable_groups: ["default", "svip2", "max", "official", "pro"],
        active_discount_rates: { "*": 90, svip2: 80 },
        active_discount_display: { "*": true, svip2: true }
    }]
};
const autorouterParsed = parse(autorouter);
const autorouterByGroup = new Map(autorouterParsed.data.map(item => [item.enable_groups[0], item]));
assert.equal(autorouterParsed.data.length, 8);
assert.ok(Math.abs(autorouterByGroup.get("default").input_price - 0.45) < 1e-12);
assert.ok(Math.abs(autorouterByGroup.get("svip2").input_price - 0.36) < 1e-12);
assert.ok(Math.abs(autorouterByGroup.get("gpt-pro").input_price - 0.09) < 1e-12);
assert.ok(Math.abs(autorouterByGroup.get("claude-max").output_price - 0.315) < 1e-12);
assert.ok(Math.abs(autorouterByGroup.get("svip2").cache_read_price - 0.032) < 1e-12);
assert.equal(autorouterByGroup.get("svip2").group_ratio, 0.8);
assert.equal(autorouterByGroup.get("gpt-pro").group_ratio, 0.2);
assert.ok(Math.abs(autorouterByGroup.get("gpt-official").input_price - 0.3375) < 1e-12);
const profilesBlock = source.match(/const RECOMMENDATION_PROFILES = \{[\s\S]*?\n\};/)[0];
const profiles = Function(`${profilesBlock} return RECOMMENDATION_PROFILES;`)();
for (const [key, profile] of Object.entries(profiles)) {
    assert.equal(profile.quality, undefined, `${key} 不应再含质量权重`);
    assert.ok(Math.abs(profile.cost + profile.confidence - 1) < 1e-9, `${key} 成本+证据权重应为 1`);
}
assert.ok(!/quality/i.test(source), "服务质量因子应已从脚本删除");
assert.ok(source.includes("人民币：中转币 = <strong id=\"rechargeRateValue\">1.0000:1</strong>"), "默认比例应为人民币:中转币 1:1");
assert.ok(source.includes("每 1 中转币成本 ¥<span id=\"rechargeCostValue\">1.0000</span>"), "应显示每个中转币的人民币成本");
const score = Function(`const RECOMMENDATION_PROFILES = ${JSON.stringify(profiles)};
const state = { recommendationProfile: "balanced" };
${extract("clampScore")}
${extract("normalizeLowerIsBetter")}
${extract("calculateConfidenceScore")}
${extract("addRecommendationScores")}
return rows => { addRecommendationScores(rows); return rows; };`)();
const scored = score([
    { model_name: "m", real_cost: 10, official_daily_cost: 100, match_rule: "完全匹配", official_name: "m", official_provider: "p" },
    { model_name: "m", real_cost: 20, official_daily_cost: 100, match_rule: "模糊", official_name: "", official_provider: "" }
]);
assert.ok(scored[0].recommendation_score > scored[1].recommendation_score, "更便宜且证据更全的行应得分更高");
assert.ok(scored[0].recommendation_score <= 100 && scored[0].recommendation_score >= 0, "推荐分应落在 0-100");
assert.equal(scored[0].quality_score, undefined, "不应再写入质量分");
assert.ok(source.includes("function setupFloatingButtonDrag(btn)"), "浮动按钮应支持长按拖动");
assert.ok(source.includes("setTimeout(() => {"), "拖动应通过长按触发");
assert.ok(source.includes("btn.style.left = `${Math.min(maxLeft, Math.max(0, event.clientX - offsetX))}px`;"), "拖动位置应限制在视口内");
assert.ok(source.includes("suppressClickUntil = Date.now() + 400"), "拖动结束后应避免误触发点击");
assert.ok(source.includes('writeStorage(memoryKey, value)'), "拖动结束后应保存按钮位置");
assert.ok(source.includes('loadPosition();'), "初始化时应恢复按钮位置");
assert.ok(!source.includes("btn.removeAttribute('style')"), "初始化不应清除拖动位置");
assert.ok(source.includes("return (isModelPricingPage() || isJijiModelListPage()) && !isSinanModelPlaza();"), "模型/价格页应尝试同源 pricing API，吉吉模型页使用专用路由");
assert.ok(source.includes("if (isSinanModelPlaza()) {"), "司南页面应保留专用表格解析");
assert.ok(source.includes("if (!data || !Array.isArray(data.data) || !data.data.length) return false;"), "空 pricing API 数据应触发 DOM 兜底");
assert.ok(source.includes('window.addEventListener("popstate", refreshPricingCapture);'), "SPA 路由切换应刷新价格数据");
assert.match(source, /\.ai-pricing-modal\[data-ai-pricing-modal="true"\] \.main-body\s*\{\s*display: grid !important;/, "桌面弹窗应使用稳定的双栏布局");
assert.match(source, /@media \(max-width: 760px\) \{\s*\.ai-pricing-modal \{/, "应保留移动端媒体查询");
assert.match(source, /\.ai-pricing-modal\[data-ai-pricing-modal="true"\] \.main-body\s*\{\s*display: flex !important;/, "移动端应覆盖桌面布局为单栏");
assert.ok(source.indexOf('.ai-pricing-modal[data-ai-pricing-modal="true"] .main-body { display: flex !important;') > source.indexOf('@media (max-width: 760px) {'), "移动端单栏规则应位于媒体查询内并覆盖桌面规则");
assert.match(source, /\.ai-pricing-modal\[data-ai-pricing-modal="true"\] \.sidebar\s*\{\s*position: static !important;/, "弹窗侧栏应隔离宿主页面的 fixed sidebar 样式");
assert.match(source, /\.ai-pricing-modal\[data-ai-pricing-modal="true"\] \.content-area\s*\{\s*flex: 0 0 min\(68dvh, 620px\) !important;/, "移动端结果区应保持可见高度，避免被 flex 压缩");


console.log("KBQ pricing checks passed");
