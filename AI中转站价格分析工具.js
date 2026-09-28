// ==UserScript==
// @name         AI中转站价格分析工具 (v4.15.13)
// @namespace    http://tampermonkey.net/
// @version      4.15.13
// @author       37012 & Gemini
// @license      GPL-3.0
// @match        https://*/model*
// @match        https://*/pricing*
// @match        https://*/rate*
// @match        https://compute.sinanlab.com/
// @match        https://soleapi.com/zh/models*
// @match        https://www.soleapi.com/zh/models*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      openrouter.ai
// @connect      www.boc.cn
// @run-at       document-end
// ==/UserScript==

(function () {
    "use strict";

    // === 1. 全局配置与状态 ===
const OFFICIAL_DATA_SOURCE = "https://openrouter.ai/api/v1/models";
const STORAGE_KEY_DATA = "ai_pricing_openrouter_v2_data";
const STORAGE_KEY_FLOAT_POSITION = "ai_pricing_float_position";
const STORAGE_KEY_RULES = "ai_pricing_v4_rules";
const OFFICIAL_CACHE_TTL = 6 * 60 * 60 * 1000;
const RECOMMENDATION_PROFILES = {
    balanced: { label: "均衡推荐", cost: 0.8, confidence: 0.2 },
    price: { label: "价格优先", cost: 0.9, confidence: 0.1 },
    reliability: { label: "稳定优先", cost: 0.7, confidence: 0.3 }
};
let officialDataPromise = null;
let exchangeRatePromise = null;
let proxyDataPromise = null;
const SYSTEM_BASE_PRICE_PER_1M = 2.0; // 系统基准 $2/1M tokens
const OFFICIAL_EXCHANGE_RATE_SOURCE = "https://www.boc.cn/sourcedb/whpj/";
const DEFAULT_EXCHANGE_RATE = 7.3;
const DEFAULT_USAGE_PROFILE = { requests: 7900, input: 66.5, cacheRead: 550.7, output: 5.5, cacheWrite: 0, peakShare: 7 / 24 };
const SCRIPT_VERSION = "4.15.13";

    // 默认匹配规则配置
    const DEFAULT_MATCHING_RULES = [
        { id: "exact", name: "完全匹配", enabled: true, desc: "名称完全一致 (gpt-4 = gpt-4)" },
        { id: "suffix", name: "后缀匹配", enabled: false, desc: "忽略厂商前缀 (openai/gpt-4 = gpt-4)" },
        { id: "ignore_version", name: "忽略版本号", enabled: false, desc: "忽略日期后缀 (gpt-4-0613 = gpt-4)" },
        { id: "fuzzy", name: "智能模糊", enabled: false, desc: "基于相似度自动匹配 (最后的兜底)" }
    ];

    // Keep known provider renames explicit; exact matches still win.
    const MODEL_ALIASES = {
        "deepseek-v4.1-flash": ["deepseek-v4-flash", "deepseek-flash"]
    };

    let state = {
        isModalOpen: false,
        modal: null,
        capturedProxyData: null,
        capturedProxySource: "",
officialData: null,
        analysisResults: [],
        recommendationProfile: "price",
        matchingRules: loadMatchingRules(),
        sortConfig: {
            primary: 'group_name',
            secondary: 'recommendation_score',
            direction: 'desc'
        },
        floatBtn: null, // 存储按钮引用
        modalPreviousOverflow: "",
        modalPreviousFocus: null,
        domCaptureSignature: "" // 页面模型卡片最近一次签名
    };


    function getModalElement(id) {
        return (state.modal || document).querySelector(`#${id}`);
    }
    // === 2. CSS 样式 ===
    const styles = `
        .ai-pricing-float-btn {
            position: fixed; right: 20px; bottom: 20px; z-index: 2147483646;
            display: none; align-items: center; gap: 8px; min-height: 44px;
            padding: 10px 20px; border: 0; border-radius: 999px;
            background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff;
            font: 600 14px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            box-shadow: 0 8px 24px rgba(37, 99, 235, .35); cursor: grab;
            user-select: none; touch-action: none; transition: transform .2s ease, box-shadow .2s ease, opacity .2s ease;
        }
        .ai-pricing-float-btn.visible { display: flex !important; animation: aiPricingFadeIn .2s ease; }
        .ai-pricing-float-btn:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(37, 99, 235, .45); }
        .ai-pricing-float-btn.dragging { cursor: grabbing; opacity: .9; transition: none; }
        .ai-pricing-float-btn.dragging:hover { transform: none; }
        @keyframes aiPricingFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

        .ai-pricing-modal {
            position: fixed !important; inset: 0 !important; z-index: 2147483645 !important;
            display: none; align-items: center; justify-content: center;
            width: 100% !important; height: 100% !important; padding: 12px;
            background: rgba(15, 23, 42, .72); backdrop-filter: blur(4px);
            overscroll-behavior: contain;
        }
        .ai-pricing-modal[aria-hidden="false"] { display: flex !important; }
        .ai-pricing-modal-content,
        .ai-pricing-modal-content * { box-sizing: border-box; }
        .ai-pricing-modal-content {
            display: flex; flex-direction: column; min-width: 0; min-height: 0;
            width: min(1680px, 100%); height: min(960px, 100%); max-height: calc(100dvh - 24px);
            overflow: hidden; border: 1px solid #cbd5e1; border-radius: 14px;
            background: #f8fafc; color: #0f172a;
            font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            box-shadow: 0 24px 70px rgba(15, 23, 42, .28); isolation: isolate;
        }
        .ai-pricing-modal .header-bar {
            display: flex !important; align-items: center; justify-content: space-between; gap: 16px;
            flex: 0 0 auto; min-height: 72px; padding: 14px clamp(16px, 2vw, 28px);
            background: #fff; border-bottom: 1px solid #dbe3ee;
        }
        .ai-pricing-modal .header-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .ai-pricing-modal .header-title {
            min-width: 0; margin: 0; color: #0f172a; font-size: clamp(18px, 1.6vw, 24px);
            font-weight: 700; line-height: 1.25; overflow-wrap: anywhere;
        }
        .ai-pricing-modal .header-subtitle { margin: 4px 0 0; color: #64748b; font-size: 12px; }
        .ai-pricing-modal .header-title .badge { vertical-align: middle; margin-left: 8px; }
        .ai-pricing-modal .close-btn {
            flex: 0 0 44px; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 8px;
            background: transparent; color: #64748b; font-size: 28px; line-height: 1; cursor: pointer;
        }
        .ai-pricing-modal .close-btn:hover, .ai-pricing-modal .close-btn:focus-visible {
            background: #f1f5f9; color: #0f172a; outline: none;
        }

        .ai-pricing-modal[data-ai-pricing-modal="true"] .main-body {
            display: grid !important; grid-template-columns: minmax(250px, 310px) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr);
            flex: 1 1 auto; min-width: 0; min-height: 0; gap: 16px; padding: 16px; overflow: hidden;
        }
        .ai-pricing-modal[data-ai-pricing-modal="true"] .sidebar {
            position: static !important; inset: auto !important; z-index: auto !important;
            display: flex !important; flex-direction: column !important; align-items: stretch; gap: 12px;
            width: auto !important; height: auto !important; min-width: 0; min-height: 0; padding: 0 4px 0 0;
            overflow-x: hidden; overflow-y: auto; flex: none !important;
        }
        .ai-pricing-modal[data-ai-pricing-modal="true"] .content-area {
            display: flex; flex-direction: column; min-width: 0; min-height: 0; width: auto !important;
            overflow: hidden; border: 1px solid #dbe3ee; border-radius: 10px; background: #fff;
        }
        .ai-pricing-modal .panel-card {
            display: flex; flex: 0 0 auto; flex-direction: column; gap: 10px; width: 100%; min-width: 0;
            padding: 14px; border: 1px solid #dbe3ee; border-radius: 10px; background: #fff;
        }
        .ai-pricing-modal .panel-title {
            display: flex; align-items: center; min-width: 0; margin: 0 0 2px; padding-bottom: 9px;
            border-bottom: 1px solid #e5eaf1; color: #334155; font-size: 14px; font-weight: 700;
        }
        .ai-pricing-modal .input-row { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
        .ai-pricing-modal .input-row label { color: #475569; font-size: 12px; font-weight: 600; }
        .ai-pricing-modal input, .ai-pricing-modal textarea, .ai-pricing-modal select {
            display: block; width: 100%; min-width: 0; min-height: 40px; padding: 9px 10px;
            border: 1px solid #cbd5e1; border-radius: 7px; background: #fff; color: #0f172a;
            font: inherit; outline: none;
        }
        .ai-pricing-modal textarea { min-height: 116px; height: 116px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; line-height: 1.45; }
        .ai-pricing-modal input:focus, .ai-pricing-modal textarea:focus, .ai-pricing-modal select:focus {
            border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, .14);
        }
        .ai-pricing-modal .btn {
            display: inline-flex; align-items: center; justify-content: center; min-height: 40px;
            padding: 9px 14px; border: 1px solid transparent; border-radius: 7px;
            font-family: inherit; font-size: 13px; font-weight: 600; line-height: 1.2; cursor: pointer; transition: background .15s ease, border-color .15s ease, transform .15s ease;
        }
        .ai-pricing-modal .btn:active { transform: translateY(1px); }
        .ai-pricing-modal .btn-primary { width: 100%; background: #2563eb; color: #fff; }
        .ai-pricing-modal .btn-primary:hover { background: #1d4ed8; }
        .ai-pricing-modal .btn-secondary { background: #fff; border-color: #cbd5e1; color: #334155; }
        .ai-pricing-modal .btn-secondary:hover { background: #f8fafc; border-color: #94a3b8; }
        .ai-pricing-modal .rule-item {
            display: flex; align-items: flex-start; gap: 8px; min-width: 0; padding: 9px;
            border: 1px solid #e5eaf1; border-radius: 7px; font-size: 12px;
        }
        .ai-pricing-modal .rule-item input { flex: 0 0 auto; width: 16px; min-height: 16px; margin-top: 2px; }
        .ai-pricing-modal .rule-desc { flex: 1 1 auto; min-width: 0; color: #64748b; font-size: 11px; overflow-wrap: anywhere; }
        .ai-pricing-modal .filter-actions { display: flex; justify-content: flex-end; gap: 8px; margin: 0; }
        .ai-pricing-modal .filter-link {
            min-height: 32px; padding: 5px 8px; border: 0; border-radius: 6px;
            background: transparent; color: #2563eb; font-family: inherit; font-size: 12px; font-weight: 600; line-height: 1.2; cursor: pointer;
        }
        .ai-pricing-modal .filter-link:hover { background: #eff6ff; }
        .ai-pricing-modal .filter-link:focus-visible { background: #eff6ff; outline: 2px solid #2563eb; outline-offset: 2px; }
        .ai-pricing-modal .sort-toolbar .filter-link { min-height: 44px; }
        .ai-pricing-modal .filter-chips {
            display: flex; flex-wrap: wrap; align-content: flex-start; gap: 7px; max-height: 164px; min-height: 32px;
            margin-top: 0; overflow-x: hidden; overflow-y: auto;
        }
        .ai-pricing-modal .chip {
            display: inline-flex; align-items: center; justify-content: center; max-width: 100%; min-height: 32px;
            padding: 5px 10px; border: 1px solid #cbd5e1; border-radius: 999px;
            background: #fff; color: #475569; font-family: inherit; font-size: 12px; font-weight: 500; line-height: 1.2; cursor: pointer;
            overflow-wrap: anywhere; text-align: center;
        }
        .ai-pricing-modal .chip.active { border-color: #2563eb; background: #eff6ff; color: #1d4ed8; }
        .ai-pricing-modal .chip:hover, .ai-pricing-modal .chip:focus-visible { border-color: #2563eb; outline: none; }
        .ai-pricing-modal .sort-toolbar {
            display: flex; flex: 0 0 auto; align-items: center; flex-wrap: wrap; gap: 10px 14px;
            min-width: 0; padding: 12px 14px; border-bottom: 1px solid #dbe3ee; background: #f8fafc; color: #475569;
        }
        .ai-pricing-modal .sort-group { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; min-width: 0; }
        .ai-pricing-modal .sort-group strong { color: #334155; white-space: nowrap; }
        .ai-pricing-modal .radio-label { display: inline-flex; align-items: center; gap: 5px; min-height: 32px; cursor: pointer; user-select: none; white-space: nowrap; }
        .ai-pricing-modal .radio-label input { width: 16px; min-height: 16px; }
        .ai-pricing-modal .sort-toolbar select { width: auto; min-width: 180px; min-height: 36px; padding: 7px 9px; }
        .ai-pricing-modal .result-summary { margin-left: auto; color: #64748b; white-space: nowrap; }
        .ai-pricing-modal .result-summary strong { color: #0f172a; }
        .ai-pricing-modal .sort-divider { width: 1px; height: 22px; background: #dbe3ee; }
        .ai-pricing-modal .table-container { flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; position: relative; -webkit-overflow-scrolling: touch; }
        .ai-pricing-modal table { width: max(100%, 980px); min-width: 980px; border-collapse: separate; border-spacing: 0; table-layout: fixed; font-size: 12px; text-align: left; }
        .ai-pricing-modal thead { position: sticky; top: 0; z-index: 2; background: #f1f5f9; }
        .ai-pricing-modal th { padding: 11px 12px; color: #475569; font-weight: 700; white-space: nowrap; background: #f1f5f9; border-bottom: 1px solid #cbd5e1; }
        .ai-pricing-modal td { padding: 10px 12px; color: #334155; vertical-align: top; border-bottom: 1px solid #e5eaf1; overflow-wrap: anywhere; }
        .ai-pricing-modal tr:hover td { background: #f8fafc; }
        .ai-pricing-modal .group-header td { padding: 9px 12px; border-top: 1px solid #cbd5e1; background: #e2e8f0; color: #1e293b; font-weight: 700; }
        .ai-pricing-modal .badge { display: inline-block; max-width: 100%; padding: 3px 7px; border-radius: 5px; font-size: 10px; font-weight: 600; overflow-wrap: anywhere; }
        .ai-pricing-modal .badge-blue { background: #dbeafe; color: #1e40af; }
        .ai-pricing-modal .badge-gray { background: #f1f5f9; color: #64748b; }
        .ai-pricing-modal .price-details { color: #64748b; font-size: 11px; line-height: 1.5; }
        .ai-pricing-modal .recommendation-cell { min-width: 110px; }
        .ai-pricing-modal .recommendation-score { color: #0f766e; font-weight: 700; }
        .ai-pricing-modal .val-excellent { padding: 3px 7px; border-radius: 5px; background: #dcfce7; color: #166534; font-weight: 700; }
        .ai-pricing-modal .val-good { color: #15803d; font-weight: 600; }
        .ai-pricing-modal .val-fair { color: #a16207; font-weight: 600; }
        .ai-pricing-modal .val-bad { color: #b91c1c; font-weight: 700; }
        @media (max-width: 960px) {
            .ai-pricing-modal .main-body { grid-template-columns: minmax(220px, 280px) minmax(0, 1fr); gap: 12px; padding: 12px; }
            .ai-pricing-modal .panel-card { padding: 12px; }
        }
        @media (max-width: 760px) {
            .ai-pricing-modal { align-items: stretch; padding: 0; }
            .ai-pricing-modal-content { width: 100%; height: 100%; max-height: none; border-radius: 0; border: 0; }
            .ai-pricing-modal .header-bar { min-height: 64px; padding: 10px 12px; }
            .ai-pricing-modal .header-subtitle { display: none; }
            .ai-pricing-modal[data-ai-pricing-modal="true"] .main-body { display: flex !important; flex-direction: column; overflow-y: auto; overflow-x: hidden; padding: 10px; }
            .ai-pricing-modal[data-ai-pricing-modal="true"] .content-area { flex: 0 0 min(68dvh, 620px) !important; min-height: min(68dvh, 620px) !important; margin-top: 0; overflow: hidden; }
            .ai-pricing-modal[data-ai-pricing-modal="true"] .sidebar { order: 2; display: flex !important; height: auto !important; overflow: visible; padding: 0; }
            .ai-pricing-modal .sort-toolbar { align-items: stretch; padding: 10px; }
            .ai-pricing-modal .sort-group { width: 100%; }
            .ai-pricing-modal .sort-divider { display: none; }
            .ai-pricing-modal .result-summary { width: 100%; margin-left: 0; }
            .ai-pricing-modal .sort-toolbar select { flex: 1 1 160px; min-width: 0; }
            .ai-pricing-modal .table-container { min-height: 320px; }
        }
        @media (max-width: 480px) {
            .ai-pricing-modal .header-title { font-size: 17px; }
            .ai-pricing-modal .header-title .badge { font-size: 10px !important; }
            .ai-pricing-modal .panel-card { padding: 11px; }
            .ai-pricing-modal th, .ai-pricing-modal td { padding: 9px 8px; }
            .ai-pricing-modal .table-container table { width: 100%; min-width: 620px; }
            .ai-pricing-modal th:nth-child(2), .ai-pricing-modal td:nth-child(2),
            .ai-pricing-modal th:nth-child(3), .ai-pricing-modal td:nth-child(3),
            .ai-pricing-modal th:nth-child(5), .ai-pricing-modal td:nth-child(5),
            .ai-pricing-modal th:nth-child(7), .ai-pricing-modal td:nth-child(7) { display: none; }
            .ai-pricing-modal th:nth-child(1) { width: 36%; }
            .ai-pricing-modal th:nth-child(4) { width: 22%; }
            .ai-pricing-modal th:nth-child(6) { width: 16%; }
            .ai-pricing-modal th:nth-child(8) { width: 16%; }
            .ai-pricing-modal th:nth-child(9) { width: 10%; }
        }
        @media (prefers-reduced-motion: reduce) {
            .ai-pricing-modal *, .ai-pricing-float-btn { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
        }
    `;


    // === 3. 核心逻辑：数据处理与匹配 ===
    function loadMatchingRules() {
        try {
            const stored = typeof GM_getValue === "function" ? GM_getValue(STORAGE_KEY_RULES) : null;
            const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
            return Array.isArray(parsed) ? parsed : DEFAULT_MATCHING_RULES.map(rule => ({ ...rule }));
        } catch (e) {
            console.warn("AI Pricing: 匹配规则读取失败，已恢复默认规则", e);
            return DEFAULT_MATCHING_RULES.map(rule => ({ ...rule }));
        }
    }

    function requestResource(url, parseResponse) {
        const nativeRequest = () => fetch(url).then(response => {
            if (!response.ok) throw new Error(`请求失败: ${response.status}`);
            return parseResponse(response);
        });

        if (new URL(url, window.location.href).origin === window.location.origin || typeof GM_xmlhttpRequest !== "function") return nativeRequest();

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url,
                onload: (res) => {
                    if (res.status !== 200) {
                        nativeRequest().then(resolve, reject);
                        return;
                    }
                    try {
                        resolve(parseResponse({ text: () => Promise.resolve(res.responseText), json: () => Promise.resolve(JSON.parse(res.responseText)) }));
                    } catch (e) {
                        reject(e);
                    }
                },
                onerror: () => nativeRequest().then(resolve, reject),
                ontimeout: () => nativeRequest().then(resolve, reject)
            });
        });
    }

    function requestJson(url) {
        return requestResource(url, response => response.json());
    }

    function requestText(url) {
        return requestResource(url, response => response.text());
    }

    function parseOfficialExchangeRate(html) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const row = Array.from(doc.querySelectorAll("#priceTable tr")).find(tr => tr.dataset.currency === "美元");
        const ratePerHundred = Number(row?.querySelectorAll("td")[5]?.textContent.trim().replace(/,/g, ""));
        if (!Number.isFinite(ratePerHundred) || ratePerHundred <= 0) throw new Error("中国银行美元汇率数据不可用");
        return ratePerHundred / 100;
    }

    function loadOfficialExchangeRate() {
        if (exchangeRatePromise) return exchangeRatePromise;
        const input = getModalElement("realExchangeRate");
        const status = getModalElement("exchangeRateStatus");
        if (status) status.textContent = "正在查询中国银行...";
        const requestUrl = `${OFFICIAL_EXCHANGE_RATE_SOURCE}?_=${Date.now()}`;
        exchangeRatePromise = requestText(requestUrl)
            .then(parseOfficialExchangeRate)
            .then(rate => {
                if (input) input.value = rate.toFixed(4);
                if (status) status.textContent = `来源：中国银行中行折算价 ${rate.toFixed(4)}，已更新`;
                return rate;
            })
            .catch(error => {
                if (input && !(Number(input.value) > 0)) input.value = DEFAULT_EXCHANGE_RATE.toFixed(4);
                if (status) status.textContent = `查询失败，暂用 ${Number(input?.value) > 0 ? Number(input.value).toFixed(4) : DEFAULT_EXCHANGE_RATE.toFixed(4)}`;
                console.warn("AI Pricing: 中国银行汇率查询失败", error);
                return Number(input?.value) > 0 ? Number(input.value) : DEFAULT_EXCHANGE_RATE;
            })
            .finally(() => { exchangeRatePromise = null; });
        return exchangeRatePromise;
    }

    function loadOfficialData() {
        if (officialDataPromise) {
            return state.officialData ? Promise.resolve(state.officialData) : officialDataPromise;
        }
        let cached = null;
        let cachedAt = 0;
        try {
            const stored = typeof GM_getValue === "function" ? GM_getValue(STORAGE_KEY_DATA) : null;
            const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
            if (Array.isArray(parsed) && parsed.length > 0) {
                cached = parsed;
                state.officialData = parsed;
            } else if (parsed?.data && Array.isArray(parsed.data)) {
                cached = parsed.data;
                cachedAt = Number(parsed.savedAt) || 0;
                state.officialData = cached;
            }
        } catch (e) {
            console.warn("AI Pricing: 官方数据缓存读取失败", e);
        }
        const refresh = () => requestJson(OFFICIAL_DATA_SOURCE)
            .then(parseOpenRouterData)
            .then(flatData => {
                if (!flatData.length) throw new Error("OpenRouter 数据为空");
                state.officialData = flatData;
                if (typeof GM_setValue === "function") {
                    GM_setValue(STORAGE_KEY_DATA, { data: flatData, savedAt: Date.now() });
                }

                return flatData;
            });
        if (cached && cachedAt && Date.now() - cachedAt < OFFICIAL_CACHE_TTL) {
            return Promise.resolve(cached);
        }
        if (cached) {
            officialDataPromise = refresh().catch(error => {
                console.warn("AI Pricing: 官方数据后台刷新失败，继续使用缓存", error);
                return cached;
            }).finally(() => { officialDataPromise = null; });
            return Promise.resolve(cached);
        }
        officialDataPromise = refresh().finally(() => { officialDataPromise = null; });
        return officialDataPromise;
    }

    function pricePerMillion(value) {
        if (value === null || value === undefined || value === "") return null;
        const price = Number(value);
        return Number.isFinite(price) && price >= 0 ? price * 1_000_000 : null;
    }

    function pricePerRequest(value) {
        if (value === null || value === undefined || value === "") return null;
        const price = Number(value);
        return Number.isFinite(price) && price >= 0 ? price : null;
    }

    function parseOpenRouterData(json) {
        if (!json || !Array.isArray(json.data)) return [];
        return json.data.flatMap(model => {
            const pricing = model.pricing || {};
            const input = pricePerMillion(pricing.prompt);
            const output = pricePerMillion(pricing.completion);
            const imageOutput = pricePerMillion(pricing.image_output ?? pricing.image_token);
            const imagePrice = pricePerRequest(pricing.image);
            const modalities = model.architecture?.output_modalities;
            const isImageModel = Array.isArray(modalities) && modalities.includes('image');
            if (input === null && output === null && imageOutput === null && imagePrice === null) return [];
            const id = String(model.id || "").trim();
            const shortId = id.includes("/") ? id.split("/").slice(1).join("/") : id;
            const aliases = [id, shortId, model.name, model.canonical_slug]
                .filter(Boolean)
                .map(value => String(value).toLowerCase());
            return [{
                name: id || model.name,
                display_name: model.name || id,
                aliases: Array.from(new Set(aliases)),
                provider: id.split("/")[0] || "OpenRouter",
                input: input ?? 0,
                output: output ?? 0,
                cacheRead: pricePerMillion(pricing.input_cache_read),
                cacheWrite: pricePerMillion(pricing.input_cache_write),
                request: pricePerRequest(pricing.request),
                imageOutput,
                imagePrice,
                isImageModel
            }];
        });
    }

    function normalizeProxyModelName(name) {
        return String(name || "").trim().toLowerCase()
            .replace(/^(?:\[[^\]]*\]\s*)+/, "")
            .replace(/-expires-on-\d{4}(?:-\d{2}-\d{2})?$/, "");
    }

    function matchModel(proxyName, officialList, rules) {
        const rawName = String(proxyName || "").trim().toLowerCase();
        const pName = normalizeProxyModelName(rawName);

        for (const rule of rules) {
            if (!rule.enabled) continue;

            let matches = [];

            // 1. 完全匹配 (Exact) - 改为 filter 查找所有
            if (rule.id === 'exact') {
                const exactNames = [...new Set([rawName, pName].flatMap(name => [name, ...(MODEL_ALIASES[name] || [])]))];
                const exactName = exactNames.find(name => officialList.some(o => getOfficialNames(o).includes(name)));
                matches = exactName ? officialList.filter(o => getOfficialNames(o).includes(exactName)) : [];
            }
            // 2. 后缀匹配 (Suffix) - 改为 filter 查找所有
            else if (rule.id === 'suffix') {
                const cleanP = cleanModelName(pName);
                matches = officialList.filter(o => getOfficialNames(o).some(name => {
                    const cleanO = cleanModelName(name);
                    return cleanP === cleanO ||
                           pName.endsWith(name) ||
                           name.endsWith(cleanP);
                }));
            }
            // 3. 忽略版本号 (Ignore Version) - 改为 filter 查找所有
            else if (rule.id === 'ignore_version') {
                const baseP = removeVersion(pName);
                matches = officialList.filter(o => getOfficialNames(o).some(name => removeVersion(name) === baseP));
            }
            // 4. 智能模糊 (Fuzzy) - 模糊匹配通常只保留得分最高的一个，避免产生大量垃圾数据
            else if (rule.id === 'fuzzy') {
                let best = null, maxScore = 0;
                officialList.forEach(o => {
                    getOfficialNames(o).forEach(oName => {
                        if (pName.includes(oName) || oName.includes(pName)) {
                            const score = Math.min(pName.length, oName.length) / Math.max(pName.length, oName.length);
                            if (score > 0.6 && score > maxScore) {
                                maxScore = score;
                                best = o;
                            }
                        }
                    });
                });
                if (best) matches = [best]; // 模糊匹配我们只取最相似的一个
            }

            // 如果当前规则找到了匹配项（一个或多个），直接返回这些匹配项，不再执行后续低优先级规则
            if (matches.length > 0) {
                return matches.map(m => ({ match: m, rule: rule.name }));
            }
        }
        return []; // 返回空数组
    }

    function getOfficialNames(model) {
        return Array.from(new Set([model.name, ...(model.aliases || [])]
            .filter(Boolean)
            .map(name => String(name).toLowerCase())));
    }



    function cleanModelName(name) {
        const prefixes = ["openai/", "anthropic/", "google/", "meta/", "deepseek/", "qwen/", "azure/"];
        for (const p of prefixes) if (name.startsWith(p)) return name.substring(p.length);
        return name;
    }

    function removeVersion(name) {
        return name.replace(/-\d{8}|-v?\d+(\.\d+)*|-\d{4}-\d{2}-\d{2}/g, "");
    }

    function readUsageProfile() {
        const number = (id, fallback = 0) => {
            const value = Number.parseFloat(getModalElement(id)?.value);
            return Number.isFinite(value) ? Math.max(0, value) : fallback;
        };
        return {
            requests: number('usageRequests', DEFAULT_USAGE_PROFILE.requests),
            input: number('usageInput', DEFAULT_USAGE_PROFILE.input),
            cacheRead: number('usageCacheRead', DEFAULT_USAGE_PROFILE.cacheRead),
            output: number('usageOutput', DEFAULT_USAGE_PROFILE.output),
            cacheWrite: number('usageCacheWrite', DEFAULT_USAGE_PROFILE.cacheWrite),
            peakShare: Math.min(1, number('usagePeakShare', DEFAULT_USAGE_PROFILE.peakShare * 100) / 100)
        };
    }

    function workloadCost(prices, usage) {
        const input = Number.isFinite(prices.input) ? prices.input : 0;
        const cacheRead = Number.isFinite(prices.cacheRead) ? prices.cacheRead : input;
        const cacheWrite = Number.isFinite(prices.cacheWrite) ? prices.cacheWrite : input;
        const output = Number.isFinite(prices.output) ? prices.output : 0;
        const request = Number.isFinite(prices.request) ? prices.request : 0;
        return usage.input * input + usage.cacheRead * cacheRead + usage.cacheWrite * cacheWrite + usage.output * output + usage.requests * request;
    }

    function getTierShares(items, peakShare) {
        if (items.length <= 1) return [1];
        const shares = items.map(item => {
            const name = String(item.tier_name || '').toLowerCase();
            if (/peak|高峰|busy|high/.test(name) && !/off|低峰|非高峰|low/.test(name)) return peakShare;
            if (/off|低峰|非高峰|low/.test(name)) return 1 - peakShare;
            return null;
        });
        const known = shares.reduce((sum, share) => sum + (share ?? 0), 0);
        const unknownCount = shares.filter(share => share === null).length;
        if (unknownCount) {
            if (known >= 1) return shares.map(share => share === null ? 0 : share / known);
            const fallback = (1 - known) / unknownCount;
            return shares.map(share => share ?? fallback);
        }
        if (known > 0) return shares.map(share => share / known);
        return shares.map(() => 1 / shares.length);
    }

    function getProxyPrices(item, groupRatio, rechargeRate) {
        const factor = currencyToRMB(item.price_currency, rechargeRate);
        const explicit = value => Number.isFinite(value) ? value * factor : null;
        const billing = item.billing || {};
        const fallbackInput = (Number(item.model_ratio) || 0) * groupRatio * SYSTEM_BASE_PRICE_PER_1M * factor;
        const fallbackOutput = fallbackInput * (Number(item.completion_ratio) || 1);
        return {
            input: explicit(item.input_price) ?? fallbackInput,
            output: explicit(item.output_price) ?? fallbackOutput,
            cacheRead: Number.isFinite(item.cache_read_price) ? explicit(item.cache_read_price) : explicit(billing.cacheRead),
            cacheWrite: Number.isFinite(item.cache_write_price) ? explicit(item.cache_write_price) : explicit(billing.cacheWrite),
            request: Number.isFinite(item.request_price) ? explicit(item.request_price) : null
        };
    }

    // === 4. 分析与计算逻辑 ===
    function runAnalysis() {
        try {
            const rawJson = getModalElement('proxyDataJson').value;
            if (!rawJson) return alert("请先获取或粘贴API数据");
            if (!state.officialData) return alert("正在加载官方数据，请稍候...");

            const rechargeRate = readRechargeRate();
            const realRate = parseFloat(getModalElement('realExchangeRate').value) || 7.3;
            const usage = readUsageProfile();
            const proxyData = normalizeProxyData(JSON.parse(rawJson));
            const rows = new Map();
            const tierSharesByGroup = new Map();
            proxyData.data.forEach(item => {
                if (!item.tier_name) return;
                const groups = item.enable_groups || ["Default"];
                groups.forEach(groupValue => {
                    const group = item.proxy_group_name || groupValue;
                    const key = [item.model_name, group].join("\u0000");
                    if (!tierSharesByGroup.has(key)) tierSharesByGroup.set(key, []);
                    tierSharesByGroup.get(key).push(item);
                });
            });
            for (const [key, items] of tierSharesByGroup) {
                const shares = getTierShares(items, usage.peakShare);
                tierSharesByGroup.set(key, new Map(items.map((item, index) => [item, shares[index]])));
            }

            proxyData.data.forEach(pItem => {
                const matchResults = matchModel(pItem.model_name, state.officialData, state.matchingRules);
                matchResults.forEach(({ match: oItem, rule }) => {
                    const groups = pItem.enable_groups || ["Default"];
                    groups.forEach(groupValue => {
                        const group = pItem.proxy_group_name || groupValue;
                        const rawGroupRatio = pItem.group_ratio ?? proxyData.group_ratio?.[groupValue] ?? proxyData.group_ratio?.[group];
                        const groupRatio = Number.isFinite(Number(rawGroupRatio)) ? Number(rawGroupRatio) : 1;
                        const proxyPrices = getProxyPrices(pItem, groupRatio, rechargeRate);
                        const officialPrices = {
                            input: (oItem.input || 0) * realRate,
                            output: (oItem.output || 0) * realRate,
                            cacheRead: Number.isFinite(oItem.cacheRead) ? oItem.cacheRead * realRate : null,
                            cacheWrite: Number.isFinite(oItem.cacheWrite) ? oItem.cacheWrite * realRate : null,
                            request: Number.isFinite(oItem.request) ? oItem.request * realRate : null,
                            imageOutput: oItem.imageOutput !== null ? oItem.imageOutput * realRate : null,
                            imagePrice: oItem.imagePrice !== null ? oItem.imagePrice * realRate : null
                        };
                        const tierKey = [pItem.model_name, group].join("\u0000");
                        const share = pItem.tier_name
                            ? (tierSharesByGroup.get(tierKey)?.get(pItem) ?? 0)
                            : 1;
                        const key = [pItem.model_name, oItem.name, oItem.provider, group].join("\u0000");
                        const row = rows.get(key) || {
                            model_name: pItem.model_name,
                            model_display_name: pItem.model_name,
                            official_name: oItem.name,
                            official_provider: oItem.provider,
                            match_rule: rule,
                            group_name: group,
                            group_ratio: groupRatio,
                            p_input_rmb: 0,
                            p_output_rmb: 0,
                            p_cache_read_rmb: 0,
                            p_cache_write_rmb: 0,
                            p_cache_read_estimated: false,
                            p_cache_write_estimated: false,
                            o_input_rmb: 0,
                            o_output_rmb: 0,
                            o_cache_read_rmb: null,
                            o_cache_write_rmb: null,
                            p_request_rmb: null,
                            o_request_rmb: null,
                            daily_cost: 0,
                            official_daily_cost: 0,
                            real_exchange_rate: 0,
                            tier_names: new Set(),
                            is_image_model: oItem.isImageModel || false,
                            o_image_output_rmb: null,
                            o_image_price_rmb: null
                        };
                        const proxyCost = workloadCost(proxyPrices, usage);
                        const officialCost = workloadCost(officialPrices, usage);
                        row.p_input_rmb += proxyPrices.input * share;
                        row.p_output_rmb += proxyPrices.output * share;
                        if (proxyPrices.cacheRead === null) row.p_cache_read_estimated = true;
                        row.p_cache_read_rmb += (proxyPrices.cacheRead ?? proxyPrices.input) * share;
                        if (proxyPrices.cacheWrite === null) row.p_cache_write_estimated = true;
                        row.p_cache_write_rmb += (proxyPrices.cacheWrite ?? proxyPrices.input) * share;
                        row.o_input_rmb += officialPrices.input * share;
                        row.o_output_rmb += officialPrices.output * share;
                        if (proxyPrices.request !== null) row.p_request_rmb = (row.p_request_rmb ?? 0) + proxyPrices.request * share;
                        if (officialPrices.request !== null) row.o_request_rmb = (row.o_request_rmb ?? 0) + officialPrices.request * share;
                        if (officialPrices.cacheRead !== null) {
                            row.o_cache_read_rmb = (row.o_cache_read_rmb ?? 0) + officialPrices.cacheRead * share;
                        }
                        if (officialPrices.cacheWrite !== null) {
                            row.o_cache_write_rmb = (row.o_cache_write_rmb ?? 0) + officialPrices.cacheWrite * share;
                        }
                        if (officialPrices.imageOutput !== null) {
                            row.o_image_output_rmb = (row.o_image_output_rmb ?? 0) + officialPrices.imageOutput * share;
                        }
                        if (officialPrices.imagePrice !== null) {
                            row.o_image_price_rmb = (row.o_image_price_rmb ?? 0) + officialPrices.imagePrice * share;
                        }
                        row.daily_cost += proxyCost * share;
                        row.official_daily_cost += officialCost * share;
                        if (pItem.tier_name) row.tier_names.add(`${pItem.tier_name} ${Math.round(share * 100)}%`);
                        rows.set(key, row);
                    });
                });
            });

            state.analysisResults = Array.from(rows.values()).map(row => {
                row.real_cost = row.daily_cost;
                row.real_exchange_rate = row.official_daily_cost > 0
                    ? row.daily_cost / row.official_daily_cost
                    : 0;
                row.diff_percent = row.official_daily_cost > 0
                    ? ((row.daily_cost - row.official_daily_cost) / row.official_daily_cost) * 100
                    : 0;
                row.tier_summary = Array.from(row.tier_names).join(' / ');
                delete row.tier_names;
                if (row.daily_cost === 0 && row.official_daily_cost > 0) row.category = "excellent";
                else if (row.official_daily_cost === 0 && row.daily_cost > 0) row.category = "bad";
                else if (row.diff_percent < -40) row.category = "excellent";
                else if (row.diff_percent < -2) row.category = "good";
                else if (row.diff_percent > 50) row.category = "bad";
                else row.category = "fair";
                return row;
            });

            addRecommendationScores(state.analysisResults);

            renderAllFilters();
            applySortingAndRender();
        } catch (e) {
            console.error(e);
            alert("分析出错: " + e.message);
        }
    }
    function clampScore(value) {
        return Math.max(0, Math.min(100, Number(value) || 0));
    }

    function normalizeLowerIsBetter(value, min, max) {
        if (max <= min) return 100;
        return clampScore(((max - value) / (max - min)) * 100);
    }

    function calculateConfidenceScore(row) {
        let score = 100;
        if (row.match_rule !== "完全匹配") score -= 25;
        if (row.p_cache_read_estimated) score -= 10;
        if (row.p_cache_write_estimated) score -= 5;
        if (!row.official_name || !row.official_provider) score -= 15;
        return clampScore(score);
    }

    function addRecommendationScores(rows) {
        const profile = RECOMMENDATION_PROFILES[state.recommendationProfile] || RECOMMENDATION_PROFILES.balanced;
        const grouped = new Map();
        rows.forEach(row => {
            if (!grouped.has(row.model_name)) grouped.set(row.model_name, []);
            grouped.get(row.model_name).push(row);
        });
        grouped.forEach(candidates => {
            const costs = candidates.map(row => row.real_cost);
            const minCost = Math.min(...costs);
            const maxCost = Math.max(...costs);
            candidates.forEach(row => {
                const costScore = normalizeLowerIsBetter(row.real_cost, minCost, maxCost);
                const confidenceScore = calculateConfidenceScore(row);
                row.confidence_score = confidenceScore;
                row.recommendation_score = costScore * profile.cost + confidenceScore * profile.confidence;
                row.recommendation_eligible = row.match_rule === "完全匹配" && row.official_daily_cost > 0;
                row.recommendation_label = row.recommendation_eligible ? (row.recommendation_score >= 75 ? "推荐" : row.recommendation_score >= 55 ? "可选" : "谨慎") : "需核验";
            });
            candidates.sort((a, b) => b.recommendation_score - a.recommendation_score);
            candidates.forEach((row, index) => { row.recommendation_rank = index + 1; });
        });
    }
    function refreshRecommendationScores() {
        addRecommendationScores(state.analysisResults);
        applySortingAndRender();
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "\"": "&quot;",
            "'": "&#39;"
        }[char]));
    }

    // === 5. 排序与渲染逻辑===
    function sortResults(rows, config) {
        const { primary, secondary, direction } = config;
        const sortFn = (a, b, key) => {
            const valA = a[key], valB = b[key];
            return typeof valA === 'string' ? valA.localeCompare(valB) : valA - valB;
        };

        return rows.sort((a, b) => {
            if (primary !== 'none') {
                const result = sortFn(a, b, primary);
                if (result !== 0) return result;
            }
            if (secondary === 'recommendation_score' && a.recommendation_eligible !== b.recommendation_eligible) {
                return direction === 'asc'
                    ? Number(a.recommendation_eligible) - Number(b.recommendation_eligible)
                    : Number(b.recommendation_eligible) - Number(a.recommendation_eligible);
            }
            const result = sortFn(a, b, secondary);
            return direction === 'asc' ? result : -result;
        });
    }
    function applySortingAndRender() {
        const { primary } = state.sortConfig;
        const container = getModalElement('resultsBody');
        container.innerHTML = "";

        const root = state.modal || document;
        const activeProviderChips = Array.from(root.querySelectorAll('#providerFilters .chip.active')).map(c => c.dataset.val);
        const activeGroupChips = Array.from(root.querySelectorAll('#groupFilters .chip.active')).map(c => c.dataset.val);

        const keyword = (getModalElement('modelKeyword')?.value || '').trim().toLowerCase();
        let filtered = state.analysisResults.filter(r => {
            const providerMatch = activeProviderChips.length === 0 || activeProviderChips.includes(r.official_provider);
            const groupMatch = activeGroupChips.length === 0 || activeGroupChips.includes(r.group_name);
            const keywordMatch = matchesModelKeyword(r, keyword);
            return providerMatch && groupMatch && keywordMatch;
        });

        if (filtered.length === 0) {
            container.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:20px; color:#94a3b8;">无匹配数据，请检查筛选条件</td></tr>`;
            getModalElement('resultCount').innerText = "0";
            return;
        }

        sortResults(filtered, state.sortConfig);

        let lastGroupVal = null;

        filtered.forEach(row => {
            if (primary !== 'none') {
                const groupVal = row[primary];
                if (groupVal !== lastGroupVal) {
                    lastGroupVal = groupVal;
                    const headerRow = document.createElement('tr');
                    headerRow.className = 'group-header';
                    headerRow.innerHTML = `<td colspan="9">📂 ${escapeHtml(primary === 'group_name' ? '分组' : '供应商')}: ${escapeHtml(groupVal)}</td>`;
                    container.appendChild(headerRow);
                }
            }

            const tr = document.createElement('tr');
            const diffClass = row.diff_percent > 0 ? 'color:#dc2626' : 'color:#16a34a';
            const diffSign = row.diff_percent > 0 ? '+' : '';
            const ratingMap = { excellent: "神价", good: "折扣", fair: "公道", bad: "溢价" };
            const ratingClass = `val-${row.category}`;
            tr.innerHTML = `
                <td>
                    <div style="font-weight:600;">${row.is_image_model ? '<span class="badge badge-blue" style="margin-right:4px;">🖼️</span>' : ''}${escapeHtml(row.model_display_name || row.model_name)}</div>
                    ${row.tier_summary ? `<div style="font-size:10px;color:#64748b;">档位: ${escapeHtml(row.tier_summary)}</div>` : ""}
                    <div style="font-size:10px; color:#94a3b8;">匹配: ${escapeHtml(row.official_name)} (${escapeHtml(row.match_rule)})</div>
                <td><span class="badge badge-blue">${escapeHtml(row.official_provider)}</span></td>
                <td><span class="badge badge-gray">${escapeHtml(row.group_name)}</span><div style="font-size:10px;color:#64748b;">倍率 ×${row.group_ratio}</div></td>
                <td class="price-details">
                    <div>入: ¥${row.p_input_rmb.toFixed(4)}</div>
                    <div>出: ¥${row.p_output_rmb.toFixed(4)}</div>
                    ${row.p_request_rmb === null ? "" : `<div>按次: ¥${row.p_request_rmb.toFixed(4)}</div>`}
                    <div>缓存读: ¥${row.p_cache_read_rmb.toFixed(4)}${row.p_cache_read_estimated ? '（估算）' : ''}</div>
                    <div>缓存写: ¥${row.p_cache_write_rmb.toFixed(4)}${row.p_cache_write_estimated ? '（估算）' : ''}</div>
                </td>
                <td class="price-details">
                    ${row.is_image_model ? `
                        <div style="color:#2563eb;font-weight:600;margin-bottom:4px;">🖼️ 生图定价</div>
                        ${row.o_image_output_rmb !== null ? `<div>图Token: ¥${row.o_image_output_rmb.toFixed(6)}/${row.o_image_output_rmb >= 0.01 ? '' : 'M'}</div>` : ''}
                        ${row.o_image_price_rmb !== null ? `<div>按张: ¥${row.o_image_price_rmb.toFixed(6)}</div>` : ''}
                        <div style="font-size:10px;color:#64748b;margin-top:2px;">Token价仅供换算参考</div>
                    ` : `
                    <div>入: ¥${row.o_input_rmb.toFixed(4)}</div>
                    <div>出: ¥${row.o_output_rmb.toFixed(4)}</div>
                    ${row.o_request_rmb === null ? "" : `<div>按次: ¥${row.o_request_rmb.toFixed(4)}</div>`}
                    <div>缓存读: ${row.o_cache_read_rmb === null ? '未提供（按入价估算）' : `¥${row.o_cache_read_rmb.toFixed(4)}`}</div>
                    <div>缓存写: ${row.o_cache_write_rmb === null ? '未提供（按入价估算）' : `¥${row.o_cache_write_rmb.toFixed(4)}`}</div>
                    `}</td>
                <td style="font-weight:bold; font-size:13px;">¥${row.real_cost.toFixed(2)}<div style="font-size:10px;color:#94a3b8;">官方 ¥${row.official_daily_cost.toFixed(2)}</div></td>
                <td style="font-weight:bold; ${diffClass}">${diffSign}${row.diff_percent.toFixed(0)}%</td>
                <td class="recommendation-cell"><span class="recommendation-score">${row.recommendation_score.toFixed(0)} 分</span><div style="font-size:10px;color:#64748b;">${row.recommendation_label} · 证据 ${row.confidence_score.toFixed(0)}</div></td>
                <td><span class="${ratingClass}">${ratingMap[row.category]}</span></td>
            `;
            container.appendChild(tr);
        });

        getModalElement('resultCount').innerText = `${filtered.length} 个`;
    }
    function matchesModelKeyword(model, keyword) {
        const term = String(keyword || "").trim().toLowerCase();
        if (!term) return true;
        return [model.model_name, model.model_display_name, model.official_name]
            .some(value => String(value || "").toLowerCase().includes(term));
    }
    function renderAllFilters() {
        renderFilterSection('providerFilters', 'official_provider');
        renderFilterSection('groupFilters', 'group_name');
    }

    function renderFilterSection(containerId, dataKey) {
        const container = (state.modal || document).querySelector(`#${containerId}`);
        container.innerHTML = "";
        const items = Array.from(new Set(state.analysisResults.map(r => r[dataKey]))).sort();

        items.forEach(item => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip active';
            chip.textContent = item;
            chip.dataset.val = item;
            chip.onclick = () => {
                chip.classList.toggle('active');
                applySortingAndRender();
            };
            container.appendChild(chip);
        });
    }

    function toggleFilterAll(containerId, isActive) {
        const root = state.modal || document;
        const chips = root.querySelectorAll(`#${containerId} .chip`);
        chips.forEach(c => isActive ? c.classList.add('active') : c.classList.remove('active'));
        applySortingAndRender();
    }

    function resetFilters() {
        const root = state.modal || document;
        root.querySelectorAll('#providerFilters .chip, #groupFilters .chip').forEach(chip => chip.classList.add('active'));
        getModalElement('modelKeyword').value = '';
        applySortingAndRender();
    }

    function setupFloatingButtonDrag(btn) {
        let pointerId = null;
        let dragging = false;
        let moved = false;
        let suppressClickUntil = 0;
        let startX = 0;
        let startY = 0;
        let offsetX = 0;
        let offsetY = 0;
        let buttonWidth = 0;
        let buttonHeight = 0;
        const openFromButton = event => {
            if (Date.now() < suppressClickUntil || dragging) return;
            event?.preventDefault();
            event?.stopPropagation();
            try {
                openModal();
            } catch (error) {
                state.isModalOpen = false;
                console.error("AI Pricing: 弹窗打开失败", error);
            }
        };
        const storageKey = STORAGE_KEY_FLOAT_POSITION;
        const memoryKey = `ai-pricing:${storageKey}`;
        const readStorage = (key, fallback = null) => {
            try { return window.localStorage.getItem(key) ?? fallback; } catch { return fallback; }
        };
        const writeStorage = (key, value) => {
            try { window.localStorage.setItem(key, value); } catch { /* storage may be blocked */ }
        };
        const savePosition = () => {
            const left = Number.parseFloat(btn.style.left);
            const top = Number.parseFloat(btn.style.top);
            if (!Number.isFinite(left) || !Number.isFinite(top)) return;
            const value = JSON.stringify({ left, top });
            writeStorage(memoryKey, value);
            if (typeof GM_setValue === "function") {
                try { GM_setValue(storageKey, { left, top }); } catch (error) { console.warn("AI Pricing: 浮动按钮位置保存失败", error); }
            }
        };
        const loadPosition = () => {
            let saved = readStorage(memoryKey);
            if (saved) { try { saved = JSON.parse(saved); } catch { saved = null; } }
            if (!saved && typeof GM_getValue === "function") {
                try { saved = GM_getValue(storageKey, null); } catch (error) { console.warn("AI Pricing: 浮动按钮位置读取失败", error); }
            }
            const left = Number(saved?.left);
            const top = Number(saved?.top);
            if (!Number.isFinite(left) || !Number.isFinite(top)) return;
            btn.style.left = `${left}px`;
            btn.style.top = `${top}px`;
            btn.style.right = "auto";
            btn.style.bottom = "auto";
        };
        const clampToViewport = () => {
            if (!btn.style.left || !btn.style.top) return;
            const rect = btn.getBoundingClientRect();
            btn.style.left = `${Math.min(Math.max(0, rect.left), Math.max(0, window.innerWidth - rect.width))}px`;
            btn.style.top = `${Math.min(Math.max(0, rect.top), Math.max(0, window.innerHeight - rect.height))}px`;
            savePosition();
        };
        const endPointer = () => {
            if (dragging) {
                dragging = false;
                suppressClickUntil = Date.now() + 400;
                btn.classList.remove("dragging");
                savePosition();
            }
            pointerId = null;
        };
        loadPosition();
        clampToViewport();
        window.addEventListener("resize", clampToViewport);
        btn.onpointerdown = event => {
            if (event.isPrimary === false || event.button !== 0 || pointerId !== null) return;
            pointerId = event.pointerId;
            moved = false;
            startX = event.clientX;
            startY = event.clientY;
            const rect = btn.getBoundingClientRect();
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;
            buttonWidth = rect.width;
            buttonHeight = rect.height;
            btn.setPointerCapture?.(event.pointerId);
        };
        btn.onpointermove = event => {
            if (event.pointerId !== pointerId) return;
            if (!dragging && Math.hypot(event.clientX - startX, event.clientY - startY) <= 8) return;
            if (!dragging) {
                dragging = true;
                moved = true;
                btn.style.left = `${event.clientX - offsetX}px`;
                btn.style.top = `${event.clientY - offsetY}px`;
                btn.style.right = "auto";
                btn.style.bottom = "auto";
                btn.classList.add("dragging");
            }
            const maxLeft = Math.max(0, window.innerWidth - buttonWidth);
            const maxTop = Math.max(0, window.innerHeight - buttonHeight);
            btn.style.left = `${Math.min(maxLeft, Math.max(0, event.clientX - offsetX))}px`;
            btn.style.top = `${Math.min(maxTop, Math.max(0, event.clientY - offsetY))}px`;
            event.preventDefault();
        };
        btn.onpointerup = event => {
            if (event.pointerId !== pointerId) return;
            const wasMoved = moved;
            endPointer();
            if (wasMoved) {
                moved = false;
                event.preventDefault();
                return;
            }
            openFromButton(event);
        btn.onpointercancel = btn.onlostpointercapture = event => {
            if (event.pointerId === pointerId) endPointer();
        };
        btn.onclick = event => {
            if (moved || Date.now() < suppressClickUntil) {
                moved = false;
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            openFromButton(event);
        };
        };
    }

    function initUI() {
        addStyle(styles);

        const existingModal = document.querySelector('.ai-pricing-modal');
        if (existingModal && !isCurrentModal(existingModal)) existingModal.remove();
        let btn = document.querySelector('.ai-pricing-float-btn');
        if (!btn) {
            btn = document.createElement('button');
            document.body.appendChild(btn);
        }
        btn.className = 'ai-pricing-float-btn';
        btn.type = 'button';
        btn.setAttribute('data-ai-pricing-button', 'true');
        btn.innerHTML = `<span>📊</span> 价格分析`;
        setupFloatingButtonDrag(btn);
        state.floatBtn = btn;
        // 启动URL检测和数据捕获
        setupUrlChangeListener();
        checkVisibility(); // 初始检查
    }

    // 检查是否应该显示按钮
    function checkVisibility() {
        const url = window.location.href;
        const isPricingPage = isModelPricingPage() || url.includes('/pricing') || url.includes('/rate');
        const hasCapturedData = !!state.capturedProxyData;

        // 规则：如果是定价页面，或者已经捕获到了数据，就显示按钮
        if (isPricingPage || hasCapturedData) {
            state.floatBtn.classList.add('visible');
            state.floatBtn.style.setProperty('display', 'flex', 'important');
        } else {
            state.floatBtn.classList.remove('visible');
            state.floatBtn.style.removeProperty('display');
        }
    }

    function resetPricingCapture() {
        state.capturedProxyData = null;
        state.capturedProxySource = "";
        state.domCaptureSignature = "";
    }

    function refreshPricingCapture() {
        resetPricingCapture();
        setTimeout(() => {
            checkVisibility();
            if (isSinanModelPlaza()) {
                captureSinanPricing();
            } else if (shouldFetchPricingApi()) {
                fetchProxyData().catch(() => captureModelPricingCards());
            } else {
                captureModelPricingCards();
            }
        }, 100);
    }

    function setupUrlChangeListener() {
        // 监听 History API 变化 (SPA应用)
        const originalPush = history.pushState;
        const originalReplace = history.replaceState;

        history.pushState = function (...args) {
            originalPush.apply(this, args);
            refreshPricingCapture();
        };

        history.replaceState = function (...args) {
            originalReplace.apply(this, args);
            refreshPricingCapture();
        };

        window.addEventListener("popstate", refreshPricingCapture);
        window.addEventListener("hashchange", refreshPricingCapture);

        // 定时器兜底 (处理某些特殊路由变化)
        setInterval(checkVisibility, 2000);
    }

    function isCurrentModal(modal) {
        return Boolean(
            modal &&
            modal.matches('.ai-pricing-modal[data-ai-pricing-modal="true"]') &&
            modal.dataset.scriptVersion === SCRIPT_VERSION &&
            ['.ai-pricing-modal-content', '.header-bar', '.main-body', '.sidebar', '.content-area', '#resultsBody']
                .every(selector => modal.querySelector(selector))
        );
    }

    function closeModal(modal = document.querySelector('.ai-pricing-modal')) {
        if (!modal) return;
        state.isModalOpen = false;
        modal.setAttribute('aria-hidden', 'true');
        modal.style.removeProperty('display');
        document.body.style.overflow = state.modalPreviousOverflow;
        if (state.modalPreviousFocus && state.modalPreviousFocus.isConnected && typeof state.modalPreviousFocus.focus === 'function') {
            state.modalPreviousFocus.focus();
        }
        state.modalPreviousFocus = null;
    }

    function openModal() {
        if (state.isModalOpen) return;
        state.isModalOpen = true;

        let modal = document.querySelector('.ai-pricing-modal');
        if (modal && !isCurrentModal(modal)) {
            modal.remove();
            modal = null;
        }
        if (!modal) {
            modal = document.createElement('div');
            modal.className = 'ai-pricing-modal';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.setAttribute('aria-labelledby', 'pricingModalTitle');
            modal.setAttribute('aria-hidden', 'true');
            modal.dataset.scriptVersion = SCRIPT_VERSION;
            modal.setAttribute('data-ai-pricing-modal', 'true');
            modal.innerHTML = `
                <div class="ai-pricing-modal-content">
                    <div class="header-bar">
                        <div class="header-brand">
                            <div>
                                <h2 class="header-title" id="pricingModalTitle">🤖 AI中转站价格分析 <span class="badge badge-blue" style="font-size:12px; margin-left:10px;">v${SCRIPT_VERSION}</span></h2>
                                <p class="header-subtitle">调整参数、筛选模型并查看 24 小时成本对比</p>
                            </div>
                        </div>
                        <button type="button" class="close-btn" aria-label="关闭价格分析" title="关闭">&times;</button>
                    </div>

                    <div class="main-body">
                        <!-- 左侧设置栏 -->
                        <div class="sidebar">
                            <div class="panel-card">
                                <div class="panel-title">📥 数据源</div>
                                <div class="input-row">
                                    <label>人民币充值金额</label>
                                        <input type="number" id="rechargeRmb" value="1" step="0.01" min="0.01" placeholder="例如 1 RMB">
                                    <label>中转币到账数量</label>
                                        <input type="number" id="rechargeCredits" value="1" step="0.01" min="0.01" placeholder="例如 1 中转币">
                                    <div style="font-size:11px;color:#64748b;line-height:1.4;">人民币：中转币 = <strong id="rechargeRateValue">1.0000:1</strong>（每 1 中转币成本 ¥<span id="rechargeCostValue">1.0000</span>）</div>
                                    <label>官方美元兑人民币汇率</label>
                                        <input type="number" id="realExchangeRate" value="7.3000" step="0.0001" min="0.01" placeholder="例如 7.3000">
                                        <button type="button" id="refreshExchangeRate" class="btn" title="从中国银行刷新汇率">↻ 刷新官方汇率</button>
                                    <div id="exchangeRateStatus" style="font-size:11px;color:#64748b;line-height:1.4;">打开窗口后自动查询中国银行中行折算价；也可手动输入。</div>
                                    </div>
                                <div class="input-row">
                                    <label>定价数据 (JSON)</label>
                                    <textarea id="proxyDataJson" placeholder="自动捕获中... 或粘贴JSON"></textarea>
                                </div>
                                <div class="input-row">
                                    <label>模型关键词筛选</label>
                                    <input type="search" id="modelKeyword" placeholder="例如 luna，留空显示全部">
                                </div>
                                <button id="analyzeBtn" class="btn btn-primary">🚀 开始计算</button>
                                <div class="panel-title">📊 24 小时工作负载</div>
                                <div class="input-row"><label>请求数</label><input type="number" id="usageRequests" value="7900" step="1" min="0"></div>
                                <div class="input-row"><label>未缓存输入 (M token)</label><input type="number" id="usageInput" value="66.5" step="0.01" min="0"></div>
                                <div class="input-row"><label>缓存读取 (M token)</label><input type="number" id="usageCacheRead" value="550.7" step="0.01" min="0"></div>
                                <div class="input-row"><label>输出 (M token)</label><input type="number" id="usageOutput" value="5.5" step="0.01" min="0"></div>
                                <div class="input-row"><label>缓存写入 (M token)</label><input type="number" id="usageCacheWrite" value="0" step="0.01" min="0"></div>
                                <div class="input-row"><label>高峰档工作量占比 (%)</label><input type="number" id="usagePeakShare" value="29.17" step="0.01" min="0" max="100"></div>
                                <div style="font-size:11px;color:#64748b;line-height:1.4;">默认按当前规则的高峰时段占全天 7/24 = 29.17% 计算；可按你的实际使用时段调整。未识别档位按剩余比例等权估算。缓存未单独定价时按普通输入价计算。</div>
                            </div>

                            <div class="panel-card">
                                <div class="panel-title">🧭 推荐模式</div>
                                <div class="input-row">
                                    <label for="recommendationProfile">综合评分侧重</label>
                                    <select id="recommendationProfile">
                                        <option value="balanced">均衡推荐（成本 80% / 证据 20%）</option>
                                        <option value="price" selected>价格优先（成本 90% / 证据 10%）</option>
                                        <option value="reliability">稳定优先（成本 70% / 证据 30%）</option>
                                    </select>
                                    <div style="font-size:11px;color:#64748b;line-height:1.4;">证据分来自匹配规则与官方数据完整度；模糊匹配只显示“需核验”，不会进入首选推荐。</div>
                                </div>
                            </div>

                            <div class="panel-card">
                                <div class="panel-title">🗂️ 分组筛选</div>
                                <div class="filter-actions">
                                    <button type="button" class="filter-link" id="groupAll">全选</button>
                                    <button type="button" class="filter-link" id="groupNone">清空</button>
                                </div>
                                <div id="groupFilters" class="filter-chips"></div>
                            </div>

                            <div class="panel-card">
                                <div class="panel-title">🏭 供应商筛选</div>
                                <div class="filter-actions">
                                    <button type="button" class="filter-link" id="providerAll">全选</button>
                                    <button type="button" class="filter-link" id="providerNone">清空</button>
                                </div>
                                <div id="providerFilters" class="filter-chips"></div>
                            </div>

                            <div class="panel-card">
                                <div class="panel-title">🧩 匹配规则</div>
                                <div id="rulesContainer" style="display:flex; flex-direction:column; gap:5px;"></div>
                            </div>
                        </div>

                        <!-- 右侧结果区 -->
                        <div class="content-area">
                            <div class="sort-toolbar">
                                <div class="sort-group">
                                    <strong>分组:</strong>
                                    <label class="radio-label"><input type="radio" name="groupBy" value="group_name" checked> 分组名</label>
                                    <label class="radio-label"><input type="radio" name="groupBy" value="official_provider"> 供应商</label>
                                    <label class="radio-label"><input type="radio" name="groupBy" value="none"> 不分组</label>
                                </div>
                                <div style="width:1px; height:20px; background:#e2e8f0; margin:0 10px;"></div>
                                <div class="sort-group">
                                    <strong>排序:</strong>
                                    <select id="sortBySelect" aria-label="排序字段">
                                        <option value="recommendation_score" selected>综合推荐</option>
                                        <option value="real_cost">24小时成本（中转）</option>
                                        <option value="diff_percent">相对官方（溢价率）</option>
                                        <option value="model_name">模型名称</option>
                                    </select>
                                    <strong>方向:</strong>
                                    <select id="sortDirectionSelect" aria-label="排序方向">
                                        <option value="asc">升序</option>
                                        <option value="desc" selected>降序</option>
                                    </select>
                                </div>
                                <button type="button" class="filter-link" id="resetFilters">重置筛选</button>
                                <div class="result-summary">
                                    共找到 <strong id="resultCount">0</strong> 个结果
                                </div>
                            </div>

                            <div class="table-container">
                                <table>
                                    <thead>
                                        <tr>
                                            <th width="19%">中转模型</th>
                                            <th width="9%">官方源</th>
                                            <th width="9%">分组</th>
                                            <th width="14%">中转单价 (¥/M)</th>
                                            <th width="14%">官方单价 <span style="font-weight:400;font-size:10px;color:#64748b;">(含生图)</span></th>
                                            <th width="9%">24小时成本 (¥)</th>
                                            <th width="7%">相对官方</th>
                                            <th width="11%">综合推荐</th>
                                            <th width="8%">评价</th>
                                        </tr>
                                    </thead>
                                    <tbody id="resultsBody">
                                        <tr><td colspan="9" style="text-align:center; padding:30px; color:#94a3b8;">请点击左侧“开始计算”</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
            `;
            document.body.appendChild(modal);
            state.modal = modal;

            const close = () => closeModal(modal);
            modal.querySelector('.close-btn').onclick = close;
            modal.addEventListener('click', event => {
                if (event.target === modal) close();
            });
            modal.addEventListener('keydown', event => {
                if (event.key === 'Escape') close();
            });
            getModalElement('analyzeBtn').onclick = runAnalysis;
            getModalElement('refreshExchangeRate').onclick = loadOfficialExchangeRate;
            ['rechargeRmb', 'rechargeCredits', 'realExchangeRate'].forEach(id => {
                getModalElement(id).oninput = updateRechargeRateDisplay;
            });
            getModalElement('recommendationProfile').value = state.recommendationProfile;
            getModalElement('recommendationProfile').onchange = (e) => {
                state.recommendationProfile = e.target.value;
                state.sortConfig.secondary = 'recommendation_score';
                getModalElement('sortBySelect').value = 'recommendation_score';
                state.sortConfig.direction = 'desc';
                getModalElement('sortDirectionSelect').value = 'desc';
                refreshRecommendationScores();
            };
            updateRechargeRateDisplay();

            renderRulesConfig();

            const root = state.modal || document;
            root.querySelectorAll('input[name="groupBy"]').forEach(el => {
                el.onchange = (e) => { state.sortConfig.primary = e.target.value; applySortingAndRender(); };
            });
            getModalElement('sortBySelect').onchange = (e) => {
                state.sortConfig.secondary = e.target.value;
                state.sortConfig.direction = e.target.value === 'recommendation_score' ? 'desc' : 'asc';
                getModalElement('sortDirectionSelect').value = state.sortConfig.direction;
                applySortingAndRender();
            };
            getModalElement('sortDirectionSelect').onchange = (e) => {
                state.sortConfig.direction = e.target.value;
                applySortingAndRender();
            };

            getModalElement('groupAll').onclick = () => toggleFilterAll('groupFilters', true);
            getModalElement('groupNone').onclick = () => toggleFilterAll('groupFilters', false);
            getModalElement('providerAll').onclick = () => toggleFilterAll('providerFilters', true);
            getModalElement('providerNone').onclick = () => toggleFilterAll('providerFilters', false);
            getModalElement('resetFilters').onclick = resetFilters;
            getModalElement('modelKeyword').oninput = applySortingAndRender;
        }
        state.modal = modal;

        state.modalPreviousFocus = document.activeElement;
        state.modalPreviousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        modal.setAttribute('aria-hidden', 'false');
        modal.style.removeProperty('display');
        modal.querySelector('.close-btn').focus();
        loadOfficialExchangeRate();
        const refreshResults = () => {
            const dataInput = getModalElement('proxyDataJson');
            if (dataInput && !dataInput.value && state.capturedProxyData) {
                dataInput.value = JSON.stringify(state.capturedProxyData, null, 2);
            }
        };
        const loadProxyData = isSinanModelPlaza()
            ? captureSinanPricing()
            : !state.capturedProxyData || (shouldFetchPricingApi() && state.capturedProxySource !== "api")
                ? fetchProxyData()
                : Promise.resolve(state.capturedProxyData);
        loadProxyData.then(refreshResults).catch(e => {
            console.warn("AI Pricing: 无法获取价格数据，请使用页面模型卡片或粘贴 JSON", e);
            refreshResults();
        });
        if (state.officialData) {
            refreshResults();
        } else {
            loadOfficialData().then(refreshResults).catch(e => {
                console.warn("AI Pricing: 官方数据加载失败", e);
            });
        }
    }

    function renderRulesConfig() {
        const container = getModalElement('rulesContainer');
        container.innerHTML = "";
        state.matchingRules.forEach((rule, idx) => {
            const div = document.createElement('div');
            div.className = 'rule-item';
            div.innerHTML = `
                <input type="checkbox" ${rule.enabled ? 'checked' : ''}>
                <span>${rule.name}</span>
                <span class="rule-desc">${rule.desc}</span>
            `;
            div.querySelector('input').onchange = (e) => {
                state.matchingRules[idx].enabled = e.target.checked;
                if (typeof GM_setValue === "function") GM_setValue(STORAGE_KEY_RULES, JSON.stringify(state.matchingRules));
            };
            container.appendChild(div);
        });
    }

    // === 7. 辅助函数 ===
    function addStyle(css) {
        document.querySelectorAll('style').forEach(style => {
            const isOwnStyle = style.dataset.aiPricingStyle ||
                (style.textContent.includes('.ai-pricing-modal') && style.textContent.includes('.ai-pricing-float-btn'));
            if (isOwnStyle) style.remove();
        });
        const style = document.createElement('style');
        style.dataset.aiPricingStyle = SCRIPT_VERSION;
        style.textContent = css;
        document.head.appendChild(style);
    }

// === 策略模式重构：数据标准化处理 ===

    /**
     * 策略基类 (接口定义)
     */
    class ParsingStrategy {
        canParse(raw) { return false; }
        parse(raw) { return { data: [], group_ratio: {} }; }

        // 辅助：安全转浮点数
        _toFloat(val, def = 1) {
            const f = parseFloat(val);
            return isNaN(f) ? def : f;
        }
    }

    /**
     * 策略 PQH: /api/pricing 格式，支持 billing_expr 多档位定价。
     */
    class PqhPricingStrategy extends ParsingStrategy {
        canParse(raw) {
            const items = Array.isArray(raw?.data) ? raw.data : [];
            const hasPqhEnvelope = Boolean(raw && (raw.pricing_version || raw.usable_group || raw.vendors));
            const hasBillingMetadata = items.some(item => item &&
                (item.billing_mode === "tiered_expr" || typeof item.billing_expr === "string")
            );
            return Boolean(items.length && raw.group_ratio && typeof raw.group_ratio === "object" &&
                (hasPqhEnvelope || hasBillingMetadata) && items.some(item =>
                    item && typeof item.model_name === "string" &&
                    (Array.isArray(item.enable_groups) || typeof item.enable_groups === "string") &&
                    (Object.prototype.hasOwnProperty.call(item, "model_ratio") || typeof item.billing_expr === "string")
                ));
        }

        _getActiveGroups(raw, groupRatios) {
            const usableGroups = raw?.usable_group && typeof raw.usable_group === "object"
                ? Object.keys(raw.usable_group)
                : [];
            const activeGroups = usableGroups.filter(group => Object.prototype.hasOwnProperty.call(groupRatios, group));
            return activeGroups.length ? activeGroups : null;
        }

        parse(raw) {
            console.log("AI Pricing: 使用 [PQH] 策略解析");
            const groupRatios = Object.fromEntries(
                Object.entries(raw.group_ratio).map(([group, ratio]) => [group, this._toFloat(ratio, 1)])
            );
            const catalogGroupRatios = raw.catalog_group_ratio && typeof raw.catalog_group_ratio === "object"
                ? Object.fromEntries(Object.entries(raw.catalog_group_ratio).map(([group, ratio]) => [group, this._toFloat(ratio, 1)]))
                : null;
            const isCatalogPricing = Boolean(catalogGroupRatios && Object.keys(catalogGroupRatios).length);
            const displayGroups = isCatalogPricing ? Object.keys(catalogGroupRatios) : null;
            // auto_groups describes automatic routing defaults; it must not hide priced groups.
            const activeGroups = isCatalogPricing ? null : this._getActiveGroups(raw, groupRatios);
            const list = [];

            for (const item of raw.data) {
                if (!item || typeof item.model_name !== "string") continue;
                const itemGroups = Array.isArray(item.enable_groups)
                    ? item.enable_groups
                    : [item.enable_groups].filter(Boolean);
                if (!itemGroups.length) continue;
                const tiers = parseBillingTiers(item.billing_expr);
                const variants = tiers.length ? tiers : [{
                    name: "标准",
                    input: Number(item.model_ratio) * SYSTEM_BASE_PRICE_PER_1M,
                    output: Number(item.model_ratio) * SYSTEM_BASE_PRICE_PER_1M * Number(item.completion_ratio || 1),
                    ratio: item.model_ratio,
                    completion: item.completion_ratio,
                    request: Number(item.quota_type) === 1 && Number.isFinite(Number(item.model_price))
                        ? Number(item.model_price)
                        : null,
                    billing: {
                        cacheRead: item.cache_ratio !== null && item.cache_ratio !== undefined && item.cache_ratio !== "" && Number.isFinite(Number(item.cache_ratio))
                            ? Number(item.model_ratio) * SYSTEM_BASE_PRICE_PER_1M * Number(item.cache_ratio)
                            : null,
                        cacheWrite: item.create_cache_ratio !== null && item.create_cache_ratio !== undefined && item.create_cache_ratio !== "" && Number.isFinite(Number(item.create_cache_ratio))
                            ? Number(item.model_ratio) * SYSTEM_BASE_PRICE_PER_1M * Number(item.create_cache_ratio)
                            : null
                    }
                }];
                const targetGroups = isCatalogPricing
                    ? displayGroups
                    : (activeGroups ? itemGroups.filter(group => activeGroups.includes(group)) : itemGroups);
                const discountRates = item.active_discount_rates || {};
                const discountDisplay = item.active_discount_display || {};

                for (const group of targetGroups) {
                    const groupRatio = this._toFloat((isCatalogPricing ? catalogGroupRatios : groupRatios)[group], 1);
                    const discountKey = isCatalogPricing && Object.prototype.hasOwnProperty.call(discountRates, group)
                        ? group
                        : null;
                    const discountValue = discountKey && discountDisplay[discountKey] !== false
                        ? Number(discountRates[discountKey])
                        : null;
                    const discountFactor = Number.isFinite(discountValue) ? discountValue / 100 : 1;

                    for (const tier of variants) {
                        const billing = tier.billing || {};
                        const inputPrice = Number.isFinite(tier.input) ? tier.input * groupRatio * discountFactor : null;
                        const outputPrice = Number.isFinite(tier.output) ? tier.output * groupRatio * discountFactor : null;
                        const ratio = inputPrice !== null
                            ? inputPrice / SYSTEM_BASE_PRICE_PER_1M
                            : this._toFloat(tier.ratio, this._toFloat(item.model_ratio, 1)) * groupRatio * discountFactor;
                        const completion = outputPrice !== null && inputPrice > 0
                            ? outputPrice / inputPrice
                            : this._toFloat(tier.completion, this._toFloat(item.completion_ratio, 1));
                        list.push({
                            model_name: item.model_name,
                            model_display_name: item.model_name,
                            model_ratio: ratio,
                            completion_ratio: completion,
                            input_price: inputPrice,
                            output_price: outputPrice,
                            cache_read_price: Number.isFinite(billing.cacheRead) ? billing.cacheRead * groupRatio * discountFactor : null,
                            cache_write_price: Number.isFinite(billing.cacheWrite) ? billing.cacheWrite * groupRatio * discountFactor : null,
                            cache_write_1h_price: Number.isFinite(billing.cacheWrite1h) ? billing.cacheWrite1h * groupRatio * discountFactor : null,
                            request_price: Number.isFinite(tier.request) ? tier.request * groupRatio * discountFactor : null,
                            price_currency: "USD",
                            enable_groups: [group],
                            proxy_group_name: group,
                            tier_name: tier.name,
                            group_ratio: groupRatio * discountFactor
                        });
                    }
                }
            }

            return {
                data: list,
                group_ratio: isCatalogPricing
                    ? Object.fromEntries(displayGroups.map(group => [group, 1]))
                    : groupRatios
            };
        }
    }

    class JijiModelPlazaStrategy extends ParsingStrategy {
        canParse(raw) {
            return raw?.code === 0 && Array.isArray(raw?.data?.groups);
        }

        parse(raw) {
            const data = [];
            const groupRatio = {};
            for (const group of raw.data.groups) {
                const groupName = String(group?.name || "").trim();
                if (!groupName) continue;
                const rateMultiplier = this._toFloat(group?.rate_multiplier, 1);
                groupRatio[groupName] = rateMultiplier;
                for (const model of Array.isArray(group.models) ? group.models : []) {
                    const pricing = model?.pricing || {};
                    const finitePrice = value => {
                        if (value === null || value === undefined || value === "") return null;
                        const number = Number(value);
                        return Number.isFinite(number) && number >= 0 ? number : null;
                    };
                    const perMillion = value => {
                        const number = finitePrice(value);
                        return number === null ? null : number * 1_000_000;
                    };
                    const applyRate = value => value === null ? null : value * rateMultiplier;
                    const input = applyRate(perMillion(pricing.input_price));
                    const output = applyRate(perMillion(pricing.output_price));
                    const request = applyRate(finitePrice(pricing.per_request_price));
                    if (!model?.name || (input === null && request === null)) continue;
                    data.push({
                        model_name: String(model.name),
                        model_display_name: String(model.name),
                        model_ratio: input === null ? 0 : input / SYSTEM_BASE_PRICE_PER_1M,
                        completion_ratio: input > 0 && output !== null ? output / input : 1,
                        input_price: input,
                        output_price: output,
                        cache_read_price: applyRate(perMillion(pricing.cache_read_price)),
                        cache_write_price: applyRate(perMillion(pricing.cache_write_price)),
                        request_price: request,
                        price_currency: "USD",
                        enable_groups: [groupName],
                        proxy_group_name: groupName,
                        group_ratio: rateMultiplier
                    });
                }
            }
            if (!data.length) throw new Error("吉吉模型价格数据为空");
            return { data, group_ratio: groupRatio };
        }
    }

// PQH 的 p/c/cr/cc 系数表示 USD/1M tokens 的不同计费项；这里只取输入和输出。
function parseBillingTiers(expression) {
    if (typeof expression !== "string" || !expression.includes("tier(")) return [];
    const tiers = [];
    const pattern = /tier\(\s*["']([^"']+)["']\s*,\s*([^)]*)\)/gi;
    let match;

    while ((match = pattern.exec(expression))) {
        const coefficients = {};
        const terms = match[2].match(/[+-]?[^+-]+/g) || [];
        for (const term of terms) {
            const parts = term.trim().match(/^([+-]?)\s*(?:(\d+(?:\.\d+)?|\.\d+)\s*\*\s*)?([a-z]+)(?:\s*\*\s*(\d+(?:\.\d+)?|\.\d+))?$/i);
            if (!parts) continue;
            const sign = parts[1] === "-" ? -1 : 1;
            const coefficient = Number(parts[2] || parts[4] || 1) * sign;
            const variable = parts[3].toLowerCase();
            coefficients[variable] = (coefficients[variable] || 0) + coefficient;
        }

        const input = Number(coefficients.p || 0);
        const output = Number(coefficients.c || 0);
        const cacheRead = Number(coefficients.cr || 0);
        const cacheWrite = Number(coefficients.cc || 0);
        const cacheWrite1h = Number(coefficients.cc1h || 0);
        if (input > 0 || output > 0) tiers.push({
            name: match[1],
            input,
            output,
            ratio: input / SYSTEM_BASE_PRICE_PER_1M,
            completion: input > 0 ? output / input : 1,
            billing: { cacheRead, cacheWrite, cacheWrite1h }
        });
    }
    return tiers;
}
    /**
     * 策略 A: NewAPI/OneAPI 标准格式
     * 特征: data.ModelRatio (对象) + data.GroupRatio (对象)
     */
    class StandardNewApiStrategy extends ParsingStrategy {
        canParse(raw) {
            return raw.data && raw.data.ModelRatio && raw.data.GroupRatio;
        }

        parse(raw) {
            console.log("AI Pricing: 使用 [StandardNewApi] 策略解析");
            const list = [];
            const groupRatios = raw.data.GroupRatio;
            const allGroups = Object.keys(groupRatios);
            const modelRatios = raw.data.ModelRatio || {};
            const completionRatios = raw.data.CompletionRatio || {};

            for (const [mName, ratio] of Object.entries(modelRatios)) {
                list.push({
                    model_name: mName,
                    model_ratio: this._toFloat(ratio),
                    completion_ratio: this._toFloat(completionRatios[mName], 1),
                    enable_groups: allGroups // 假设全分组可见
                });
            }
            return { data: list, group_ratio: groupRatios };
        }
    }

    /**
     * 策略 B: 旧版嵌套格式
     * 特征: data.model_group (对象)
     */
    class LegacyStrategy extends ParsingStrategy {
        canParse(raw) {
            return raw.data && raw.data.model_group;
        }

        parse(raw) {
            console.log("AI Pricing: 使用 [Legacy] 策略解析");
            const list = [];
            const groups = raw.data.model_group;
            const completions = raw.data.model_completion_ratio || {};
            const modelMap = {};

            // 1. 遍历分组建立映射
            for (const [gName, gData] of Object.entries(groups)) {
                const prices = gData.ModelPrice || {};
                for (const [mName, mPrice] of Object.entries(prices)) {
                    if (!modelMap[mName]) {
                        modelMap[mName] = { ratio: mPrice.price, groups: [] };
                    }
                    modelMap[mName].groups.push(gName);
                }
            }

            // 2. 转换为列表
            for (const [mName, info] of Object.entries(modelMap)) {
                list.push({
                    model_name: mName,
                    model_ratio: this._toFloat(info.ratio),
                    completion_ratio: this._toFloat(completions[mName], 1),
                    enable_groups: info.groups
                });
            }

            // 3. 提取分组倍率
            const groupRatios = {};
            for (const [g, d] of Object.entries(groups)) {
                groupRatios[g] = this._toFloat(d.GroupRatio);
            }

            return { data: list, group_ratio: groupRatios };
        }
    }

    /**
     * 策略 C: 复杂嵌套/新版格式 (Go-Chat/BerryAPI 等变种)
     * 特征: data.model_info (数组) + data.group_info (对象)
     * 逻辑: 支持同一模型在不同分组有不同基础倍率，解析时进行"展开"处理
     */
    class AdvancedNestedStrategy extends ParsingStrategy {
        canParse(raw) {
            return raw.data && Array.isArray(raw.data.model_info) && raw.data.group_info;
        }

        parse(raw) {
            console.log("AI Pricing: 使用 [AdvancedNested] 策略解析");
            const list = [];
            const rawGroups = raw.data.group_info;
            const rawModels = raw.data.model_info;

            // 1. 提取分组倍率
            const groupRatios = {};
            for (const [gName, gData] of Object.entries(rawGroups)) {
                groupRatios[gName] = this._toFloat(gData.GroupRatio);
            }

            // 2. 遍历模型并展开
            rawModels.forEach(item => {
                if (!item.model_name) return;

                // 获取该模型定义了价格的所有分组
                // 优先看 enable_groups，如果没有，则看 price_info 的 key
                let targetGroups = item.enable_groups;
                const priceMap = item.price_info || {};

                if (!targetGroups || targetGroups.length === 0) {
                    targetGroups = Object.keys(priceMap);
                }

                if (!targetGroups || targetGroups.length === 0) return;

                // 核心逻辑：为了适配 runAnalysis，如果一个模型属于多个分组，
                // 且我们在 JSON 里能获取到它在每个分组的具体 price_info，
                // 我们就为每个分组生成一条独立的记录。
                // 这样做的好处是：即使不同分组的 model_ratio 不同，计算也是准确的。

                targetGroups.forEach(groupName => {
                    // 尝试获取该分组下的特定配置
                    const groupPriceConfig = priceMap[groupName]?.default;

                    // 如果该分组有特定配置，使用特定值；否则使用一个默认逻辑(或者跳过)
                    // 这里为了稳健，如果找不到具体配置，我们尝试找任意一个存在的配置作为 fallback，或者跳过
                    // 在新版 JSON 中，通常 price_info 包含了所有 enable_groups 的 key

                    let ratio = 0;
                    let completionRatio = 1;

                    if (groupPriceConfig) {
                        ratio = this._toFloat(groupPriceConfig.model_ratio, 0);
                        const cr = parseFloat(groupPriceConfig.model_completion_ratio);
                        completionRatio = isNaN(cr) ? 1 : cr;
                    } else {
                        // 如果没有特定配置，尝试找第一个可用的作为基准 (兼容性兜底)
                        const firstKey = Object.keys(priceMap)[0];
                        if (firstKey && priceMap[firstKey].default) {
                            const fallback = priceMap[firstKey].default;
                            ratio = this._toFloat(fallback.model_ratio, 0);
                            const cr = parseFloat(fallback.model_completion_ratio);
                            completionRatio = isNaN(cr) ? 1 : cr;
                        }
                    }

                    list.push({
                        model_name: item.model_name,
                        model_ratio: ratio,
                        completion_ratio: completionRatio,
                        enable_groups: [groupName] // 关键：每条记录只对应一个分组，确保计算精确
                    });
                });
            });

            return { data: list, group_ratio: groupRatios };
        }
    }

    /**
     * 上下文环境：标准化入口函数
     */
    function normalizeProxyData(raw) {
        const strategies = [
            new JijiModelPlazaStrategy(),
            new PqhPricingStrategy(),
            new StandardNewApiStrategy(),
            new LegacyStrategy(),
            new AdvancedNestedStrategy()
        ];

        for (const strategy of strategies) {
            if (!strategy.canParse(raw)) continue;
            try {
                return strategy.parse(raw);
            } catch (e) {
                console.error("策略解析失败:", e);
                break;
            }
        }

        console.warn("AI Pricing: 未知的数据格式，无法解析");
        return raw;
    }
    function isModelPricingPage() {
        return /\/(?:models?|pricing|rate)(?:\/|$)/i.test(window.location.pathname) || isJijiModelListPage() || isSinanModelPlaza();
    }
    function isSinanModelPlaza() {
        return /(?:^|\.)compute\.sinanlab\.com$/i.test(window.location.hostname) && window.location.pathname === "/";
    }


    function readRechargeRate() {
        const rmb = Number(getModalElement('rechargeRmb')?.value);
        const credits = Number(getModalElement('rechargeCredits')?.value);
        return rmb > 0 && credits > 0 ? rmb / credits : 1;
    }

    function updateRechargeRateDisplay() {
        const rate = readRechargeRate();
        const display = getModalElement('rechargeRateValue');
        const cost = getModalElement('rechargeCostValue');
        if (display) display.textContent = `${rate.toFixed(4)}:1`;
        if (cost) cost.textContent = rate.toFixed(4);
    }

    function currencyToRMB(currency, rechargeRate) {
        const code = String(currency || "USD").toUpperCase();
        if (code === "CNY" || code === "RMB" || code === "¥" || code === "￥") return 1;
        return Number(rechargeRate) || 1;
    }

    function isJijiModelListPage() {
        return /(?:^|\.)jiji\.cc$/i.test(window.location.hostname) && /^\/model-list\/?$/i.test(window.location.pathname);
    }
    function shouldFetchPricingApi() {
        return (isModelPricingPage() || isJijiModelListPage()) && !isSinanModelPlaza();
    }

    function firstNumber(text) {
        const match = String(text || "").replace(/,/g, "").match(/-?(?:\d+(?:\.\d+)?|\.\d+)/);
        return match ? Number(match[0]) : null;
    }

    function detectPriceCurrency(text) {
        return /credits?/i.test(text)
            ? "CREDITS"
            : /cny|rmb|¥|￥/i.test(text) ? "CNY" : "USD";
    }

    function findExactTextElement(root, labels) {
        const normalizeLabel = value => String(value || '').trim().toLowerCase().replace(/[：:]\s*$/, '');
        const wanted = labels.map(normalizeLabel);
        return Array.from(root.querySelectorAll('*')).find(el => {
            return el.children.length === 0 && wanted.includes(normalizeLabel(el.textContent));
        });
    }

    function readTokenPrice(card, labels) {
        const label = findExactTextElement(card, labels);
        const block = label && label.parentElement;
        if (!block) return null;
        const unit = Array.from(block.querySelectorAll("*")).find(el => {
            return el.children.length === 0 && /(?:credits?|usd|cny|rmb|[$€¥￥])?\s*\/\s*(?:m|1m|million|百万|tokens?)/i.test(el.textContent.trim());
        });
        if (!unit || !unit.parentElement) return null;

        const priceNode = unit.parentElement;
        const directText = Array.from(priceNode.childNodes)
            .filter(node => node.nodeType === 3)
            .map(node => node.textContent)
            .join(" ");
        const value = firstNumber(directText) ?? firstNumber(priceNode.textContent);
        const priceContainer = priceNode.parentElement;
        const approximateNode = priceContainer && Array.from(priceContainer.querySelectorAll("*")).find(el => {
            if (!/≈\s*[¥￥]/.test(el.textContent)) return false;
            return Array.from(el.childNodes).some(node => node.nodeType === 3 && /[¥￥]\s*\d/.test(node.textContent));
        });
        const approximateText = approximateNode
            ? Array.from(approximateNode.childNodes)
                .filter(node => node.nodeType === 3)
                .map(node => node.textContent)
                .join(" ")
            : "";
        const approximateValue = firstNumber(approximateText);
        return {
            value: Number.isFinite(value) ? value : null,
            approximateRmb: Number.isFinite(approximateValue) ? approximateValue : null,
            currency: detectPriceCurrency(unit.textContent)
        };
    }

    function readRequestPrice(card) {
        const label = findExactTextElement(card, ["按次计费", "按次", "request"]);
        const block = label && label.parentElement;
        if (!block) return null;
        const priceNode = block.querySelector(".value") || block;
        const value = firstNumber(priceNode.textContent);
        return {
            value: Number.isFinite(value) ? value : null,
            approximateRmb: null,
            currency: detectPriceCurrency(block.textContent)
        };
    }

    function readTablePrice(cell) {
        const text = cell?.textContent?.trim() || "";
        const value = firstNumber(text);
        if (!Number.isFinite(value)) return null;
        return { value, approximateRmb: null, currency: detectPriceCurrency(text) };
    }

    function directText(node) {
        return Array.from(node?.childNodes || [])
            .filter(child => child.nodeType === 3)
            .map(child => child.textContent)
            .join(" ")
            .trim();
    }

    function getCardModelInfo(card) {
        const id = (card.id || card.dataset.modelId || card.dataset.model || "").trim();
        const link = card.querySelector('a[href*="/models/"]');
        const amlNameNode = card.querySelector(".aml-model-name, .name") || card.querySelector(".aml-name-cell > div > div");
        const amlName = directText(amlNameNode) || amlNameNode?.textContent?.trim() || "";
        const displayName = (link?.textContent || card.querySelector("h2,h3,h4")?.textContent || amlName || id).trim();
        const codeName = card.querySelector(".font-mono")?.textContent.trim();
        const providerNode = card.querySelector(".aml-tag.alt, .aml-pill") || Array.from(card.querySelectorAll("span,div")).find(el => {
            const text = el.textContent.trim();
            return el.children.length === 0 && /[·•]/.test(text) && /(上下文|context)/i.test(text);
        });
        const provider = providerNode ? providerNode.textContent.split(/[·•]/)[0].trim() : "";
        return { modelName: id || codeName || amlName || displayName, displayName: displayName || id, provider };
    }

    function addDomPricingItem(data, info, inputPrice, outputPrice, requestPrice, cachePrice, groupName) {
        const hasTokenPrice = inputPrice?.value !== null && inputPrice?.value >= 0 && outputPrice?.value !== null && outputPrice?.value >= 0;
        const hasRequestPrice = requestPrice?.value !== null && requestPrice?.value >= 0;
        if (!info.modelName || (!hasTokenPrice && !hasRequestPrice)) return;
        const tokenInput = hasTokenPrice ? inputPrice : { value: 0, approximateRmb: null, currency: requestPrice.currency };
        const tokenOutput = hasTokenPrice ? outputPrice : { value: 0, approximateRmb: null, currency: tokenInput.currency };
        const inputRmb = tokenInput.approximateRmb ?? (tokenInput.currency === "USD" ? tokenInput.value : null);
        const outputRmb = tokenOutput.approximateRmb ?? (tokenOutput.currency === "USD" ? tokenOutput.value : null);
        const useRmb = hasTokenPrice && tokenInput.approximateRmb !== null && tokenOutput.approximateRmb !== null;
        const inputValue = useRmb ? inputRmb : tokenInput.value;
        const outputValue = useRmb ? outputRmb : tokenOutput.value;
        const cacheValue = cachePrice && Number.isFinite(cachePrice.value)
            ? (useRmb ? cachePrice.approximateRmb : cachePrice.value)
            : null;
        data.push({
            model_name: info.modelName,
            model_display_name: info.displayName,
            input_price: inputValue,
            output_price: outputValue,
            model_ratio: inputValue / SYSTEM_BASE_PRICE_PER_1M,
            completion_ratio: inputValue > 0 ? outputValue / inputValue : 1,
            request_price: hasRequestPrice ? requestPrice.value : null,
            cache_read_price: Number.isFinite(cacheValue) ? cacheValue : null,
            price_currency: useRmb ? "CNY" : tokenInput.currency,
            enable_groups: [groupName]
        });
    }

    function parseSinanPricingTable(table = document.querySelector("#tbl"), modelId = window.location.hash.slice(3)) {
        if (!isSinanModelPlaza() || !table || !modelId) return null;
        const data = Array.from(table.querySelectorAll("tbody tr"), row => {
            const cells = Array.from(row.children, cell => cell.textContent.trim());
            const channel = cells[0]?.replace(/\s+/g, " ");
            const outputPrice = firstNumber(cells[1]);
            const inputPrice = firstNumber(cells[2]);
            if (!channel || !Number.isFinite(inputPrice) || !Number.isFinite(outputPrice)) return null;
            return {
                model_name: modelId,
                model_display_name: modelId,
                input_price: inputPrice,
                output_price: outputPrice,
                model_ratio: inputPrice / SYSTEM_BASE_PRICE_PER_1M,
                completion_ratio: inputPrice > 0 ? outputPrice / inputPrice : 1,
                request_price: null,
                cache_read_price: null,
                cache_write_price: null,
                price_currency: "USD",
                enable_groups: [channel],
                proxy_group_name: channel,
                group_ratio: 1
            };
        }).filter(Boolean);
        if (!data.length) return null;
        return { data, group_ratio: Object.fromEntries(data.map(item => [item.proxy_group_name, 1])) };
    }

    function captureSinanPricing() {
        if (!isSinanModelPlaza()) return Promise.resolve(false);
        const parsed = parseSinanPricingTable();
        if (!parsed) return Promise.resolve(false);
        const signature = `${window.location.hash}|${parsed.data.map(item => `${item.proxy_group_name}:${item.input_price}:${item.output_price}`).join("|")}`;
        if (signature === state.domCaptureSignature) return Promise.resolve(true);
        state.domCaptureSignature = signature;
        state.capturedProxyData = parsed;
        state.capturedProxySource = "sinan";
        checkVisibility();
        const input = getModalElement("proxyDataJson");
        if (input && document.activeElement !== input) input.value = JSON.stringify(parsed, null, 2);
        console.log(`AI Pricing: 从司南模型广场捕获 ${parsed.data.length} 条价格数据`);
        return Promise.resolve(true);
    }

    function parseModelPricingCards() {
        if (!isModelPricingPage()) return null;
        const groupName = window.location.hostname.replace(/^www\./i, "") || "页面价格";
        const data = [];
        document.querySelectorAll('article, div.group.relative, .aml-card-item, .aml-row').forEach(card => {
            if (card.querySelector('article, div.group.relative, .aml-card-item, .aml-row')) return;
            const info = getCardModelInfo(card);
            addDomPricingItem(
                data,
                info,
                readTokenPrice(card, ["输入", "输入价格", "input"]),
                readTokenPrice(card, ["输出", "输出价格", "output"]),
                readRequestPrice(card),
                readTokenPrice(card, ["缓存", "缓存读取", "cache", "cache read"]),
                groupName
            );
        });
        document.querySelectorAll(".aml-table tbody tr").forEach(row => {
            const info = getCardModelInfo(row);
            const priceCells = Array.from(row.querySelectorAll("td.num"));
            if (priceCells.length === 1 && /\/\s*(?:次|request)/i.test(priceCells[0].textContent)) {
                addDomPricingItem(data, info, null, null, readTablePrice(priceCells[0]), null, groupName);
                return;
            }
            addDomPricingItem(
                data,
                info,
                readTablePrice(priceCells[0]),
                readTablePrice(priceCells[1]),
                null,
                readTablePrice(priceCells[2]),
                groupName
            );
        });
        if (!data.length) return null;
        return { data, group_ratio: { [groupName]: 1 } };
    }

    function captureModelPricingCards() {
        const parsed = parseModelPricingCards();
        if (!parsed) return false;
        const signature = parsed.data.map(item => `${item.model_name}:${item.model_ratio}:${item.completion_ratio}`).join("|");
        if (signature === state.domCaptureSignature) return true;
        state.domCaptureSignature = signature;
        if (state.capturedProxySource === "api") return true;
        state.capturedProxySource = "dom";
        checkVisibility();
        const input = getModalElement("proxyDataJson");
        if (input && document.activeElement !== input) input.value = JSON.stringify(parsed, null, 2);
        console.log(`AI Pricing: 从页面模型卡片捕获 ${parsed.data.length} 条价格数据`);
        return true;
    }


    function setupDomPricingCapture() {
        const scan = () => {
            if (isSinanModelPlaza()) {
                captureSinanPricing();
                return;
            }
            if (shouldFetchPricingApi()) {
                if (state.capturedProxySource === "api") return;
                fetchProxyData().catch(() => captureModelPricingCards());
                return;
            }
            captureModelPricingCards();
        };
        scan();
        if (window.MutationObserver && document.body) {
            let timer;
            new MutationObserver(() => {
                if (!isModelPricingPage()) return;
                clearTimeout(timer);
                timer = setTimeout(scan, 300);
            }).observe(document.body, { childList: true, subtree: true });
        }
        setInterval(() => { if (isModelPricingPage()) scan(); }, 2000);
    }
    function setupInterception() {
        // 拦截 fetch
        const origFetch = window.fetch;
        window.fetch = function(...args) {
            if (args[0] && args[0].toString().includes('/api/pricing')) {
                return origFetch.apply(this, args).then(res => {
                    res.clone().json().then(data => {
                        setCapturedProxyData(data);
                        console.log("AI Pricing: 成功捕获 pricing 数据");
                    }).catch(() => {});
                    return res;
                });
            }
            return origFetch.apply(this, args);
        };

        // 拦截 XHR
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
            this._url = url;
            return origOpen.apply(this, arguments);
        };
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function() {
            if (this._url && this._url.includes('/api/pricing')) {
                this.addEventListener('load', function() {
                    try {
                        const data = JSON.parse(this.responseText);
                        setCapturedProxyData(data);
                        console.log("AI Pricing: 成功通过 XHR 捕获 pricing 数据");
                    } catch(e) {}
                });
            }
            return origSend.apply(this, arguments);
        };
    }

    function setCapturedProxyData(data) {
        if (!data || !Array.isArray(data.data) || !data.data.length) return false;
        state.capturedProxyData = data;
        state.capturedProxySource = "api";
        checkVisibility();
        const input = getModalElement('proxyDataJson');
        if (input && document.activeElement !== input) input.value = JSON.stringify(data, null, 2);
        return true;
    }

    function fetchProxyData() {
        if (proxyDataPromise) return proxyDataPromise;
        const url = isJijiModelListPage()
            ? new URL("/api/v1/model-plaza", window.location.origin).href
            : new URL("/api/pricing", window.location.origin).href;
        proxyDataPromise = requestJson(url)
            .then(data => {
                const normalized = isJijiModelListPage() ? normalizeProxyData(data) : data;
                if (!setCapturedProxyData(normalized)) throw new Error("pricing API 返回空数据");
                return normalized;
            })
            .finally(() => { proxyDataPromise = null; });
        return proxyDataPromise;
    }

    // === 启动 ===
    function start() {
        try {
            initUI();
        } catch (e) {
            console.error("AI Pricing: 界面初始化失败", e);
            return;
        }
        try {
            setupInterception();
        } catch (e) {
            console.warn("AI Pricing: 接口拦截不可用，继续使用页面模型卡片", e);
        }
        setupDomPricingCapture();
        loadOfficialData()
            .then(() => {
                console.log("AI Pricing: 官方数据预加载完成");
            })
            .catch(e => console.warn("AI Pricing: 官方数据加载失败，请检查 @connect 权限", e));
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }

})();
