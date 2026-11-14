import { runWithConcurrency } from "./concurrency.js";
import { normalizePricingPayload } from "./normalizers.js";

export const LINUX_DO_GRAPHQL_ENDPOINT = "/admin/graphql";
export const LINUX_DO_PREFLIGHT_ENDPOINT = "/admin/system/price-version";
export const LINUX_DO_DETAIL_CONCURRENCY = 4;

export const MARKETPLACE_MODELS_QUERY = `query MarketplaceModels {
  marketplaceModels {
    modelID
    displayModel { modelID name developer group type visibility }
  }
}`;

export const MARKETPLACE_MODEL_QUERY = `query MarketplaceModel($modelID: String!, $window: String!) {
  marketplaceModel(modelID: $modelID, window: $window) {
    modelID
    displayModel { modelID name developer group type visibility }
    providers {
      channel {
        id name type status visibility enabled public
        channelModelPrices {
          modelID
          price {
            items {
              itemCode
              multiplier
              pricing { usagePerUnit }
            }
          }
        }
      }
    }
  }
}`;

function responseData(payload) {
  return payload?.data && typeof payload.data === "object" ? payload.data : {};
}

function graphqlErrors(payload) {
  return Array.isArray(payload?.errors) ? payload.errors : [];
}

function safeDiagnosticModelId(value) {
  const modelID = String(value || "unknown").replace(/[\r\n\t]+/g, " ").trim();
  return modelID
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/(?:token|access_token|refresh_token|api[_-]?key)[=:]\s*[^\s,;]+/gi, "credential=[redacted]")
    .slice(0, 120) || "unknown";
}

function errorText(error) {
  const message = String(error?.message || error || "请求失败").replace(/[\r\n\t]+/g, " ").trim();
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/(?:token|access_token|refresh_token|api[_-]?key)[=:]\s*[^\s,;]+/gi, "credential=[redacted]")
    .slice(0, 160) || "请求失败";
}

function modelId(model) {
  return String(model?.modelID || model?.modelId || model?.id || model?.displayModel?.modelID || "").trim();
}

function displayModel(model) {
  const display = model?.displayModel && typeof model.displayModel === "object" ? model.displayModel : model;
  return {
    modelID: modelId(display) || modelId(model),
    name: String(display?.name || display?.displayName || model?.name || "").trim(),
    developer: String(display?.developer || "").trim(),
    group: String(display?.group || "").trim(),
    type: String(display?.type || "").trim(),
    visibility: String(display?.visibility || "").trim()
  };
}

function channelModelPrices(channel) {
  return (Array.isArray(channel?.channelModelPrices) ? channel.channelModelPrices : []).map(entry => ({
    modelID: String(entry?.modelID || entry?.modelId || entry?.model?.modelID || "").trim(),
    price: {
      items: (Array.isArray(entry?.price?.items) ? entry.price.items : []).map(item => ({
        itemCode: String(item?.itemCode || item?.code || item?.name || "").trim(),
        multiplier: item?.multiplier,
        pricing: { usagePerUnit: item?.pricing?.usagePerUnit }
      }))
    }
  }));
}

function channelForNormalizer(channel) {
  if (!channel || typeof channel !== "object") return null;
  return {
    id: String(channel.id || channel.channelID || "").trim(),
    name: String(channel.name || channel.displayName || channel.id || "").trim(),
    type: String(channel.type || "").trim(),
    status: String(channel.status || "").trim(),
    visibility: String(channel.visibility || "").trim(),
    ...(Object.prototype.hasOwnProperty.call(channel, "enabled") ? { enabled: channel.enabled } : {}),
    ...(Object.prototype.hasOwnProperty.call(channel, "public") ? { public: channel.public } : {}),
    channelModelPrices: channelModelPrices(channel)
  };
}

function detailForNormalizer(model, payload) {
  const detail = payload?.marketplaceModel || payload?.data?.marketplaceModel;
  if (!detail || typeof detail !== "object" || Array.isArray(detail) || !Array.isArray(detail.providers)) return null;
  const detailID = modelId(detail);
  if (!detailID || detailID !== model.modelID) return null;
  return {
    modelID: detailID,
    displayModel: displayModel(detail),
    providers: (Array.isArray(detail.providers) ? detail.providers : []).map(provider => {
      const channel = channelForNormalizer(provider?.channel || provider);
      return channel ? { channel } : null;
    }).filter(Boolean)
  };
}

export function buildGraphqlRequest(query, variables, operationName) {
  return { query, variables: variables || {}, operationName };
}

async function readPageResponse(response) {
  if (response?.body !== undefined) return response.body;
  if (typeof response?.json === "function") return response.json();
  return null;
}

function markSessionFailure(error) {
  error.code = "PAGE_SESSION_FAILURE";
  return error;
}

function isSessionFailure(error) {
  return error?.code === "PAGE_SESSION_FAILURE" || /未找到 Linux.do 登录凭据|页面会话已失效|当前 Chrome 配置文件登录 Linux.do/i.test(String(error?.message || error));
}

async function requestGraphql(pageFetch, station, requestStrategy, query, variables, operationName) {
  if (typeof pageFetch !== "function") throw markSessionFailure(new Error("请先在当前 Chrome 配置文件登录 Linux.do 后重试"));
  const url = new URL(LINUX_DO_GRAPHQL_ENDPOINT, station.baseUrl).toString();
  let response;
  try {
    response = await pageFetch({
      url,
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(buildGraphqlRequest(query, variables, operationName)),
      credentials: "same-origin",
      pageAuth: requestStrategy.pageAuth
    });
  } catch (error) {
    if (isSessionFailure(error)) throw markSessionFailure(error);
    throw error;
  }
  if (!response || response.ok === false || Number(response.status) >= 400) {
    if ([401, 403].includes(Number(response?.status))) throw markSessionFailure(new Error(requestStrategy.pageAuth?.sessionFailureMessage || "页面会话已失效，请在当前 Chrome 配置文件重新登录后重试"));
    throw new Error(`Linux.do Marketplace 请求失败（${response?.status || "无响应"}）`);
  }
  const payload = await readPageResponse(response);
  const errors = graphqlErrors(payload);
  if (errors.length) throw new Error(`Linux.do Marketplace GraphQL 查询失败：${errorText(errors[0]?.message || errors[0])}`);
  if (!payload || typeof payload !== "object") throw new Error("Linux.do Marketplace GraphQL 响应格式无效");
  return { payload, status: Number(response.status) || 200 };
}

export async function collectLinuxDoMarketplace(station, { pageFetch, requestStrategy } = {}) {
  const catalogResponse = await requestGraphql(pageFetch, station, requestStrategy, MARKETPLACE_MODELS_QUERY, {}, "MarketplaceModels");
  const catalog = responseData(catalogResponse.payload).marketplaceModels;
  if (!Array.isArray(catalog) || !catalog.length) throw new Error("Linux.do Marketplace 模型目录为空或格式无效");

  const models = [];
  const seen = new Set();
  for (const item of catalog) {
    const id = modelId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ ...displayModel(item), modelID: id });
  }
  if (!models.length) throw new Error("Linux.do Marketplace 模型目录没有可用模型");

  const detailResults = await runWithConcurrency(models, LINUX_DO_DETAIL_CONCURRENCY, async model => {
    try {
      const result = await requestGraphql(pageFetch, station, requestStrategy, MARKETPLACE_MODEL_QUERY, { modelID: model.modelID, window: "LAST_7D" }, "MarketplaceModel");
      const detail = detailForNormalizer(model, result.payload);
      if (!detail) return { model, error: "详情响应缺少 marketplaceModel" };
      return { model, detail };
    } catch (error) {
      if (isSessionFailure(error)) throw markSessionFailure(error);
      return { model, error: errorText(error) };
    }
  });

  const details = [];
  const failedModels = [];
  for (const result of detailResults) {
    if (result?.status === "rejected" && isSessionFailure(result.reason)) throw markSessionFailure(result.reason);
    if (result?.status !== "fulfilled" || !result.value || result.value.error) {
      const value = result?.status === "fulfilled" ? result.value : null;
      failedModels.push({ modelID: value?.model?.modelID || "unknown", reason: errorText(result?.reason || value?.error || "详情查询失败") });
      continue;
    }
    details.push(result.value.detail);
  }
  const diagnostics = failedModels.length ? {
    incomplete: true,
    failedModels: failedModels.map(item => item.modelID),
    failedModelCount: failedModels.length,
    failedModelReasons: failedModels.map(item => `${safeDiagnosticModelId(item.modelID)}: ${item.reason}`)
  } : {};
  if (!details.length) {
    return {
      normalized: {
        data: [],
        group_ratio: {},
        sourceFormat: "linux-do-marketplace",
        error: `Linux.do Marketplace 全部模型详情查询失败（${failedModels.length} 个）`,
        ...diagnostics
      },
      url: new URL(LINUX_DO_GRAPHQL_ENDPOINT, station.baseUrl).toString(),
      status: catalogResponse.status
    };
  }

  const normalized = normalizePricingPayload({ data: { marketplaceModels: models, marketplaceDetails: details }, sourceFormat: "linux-do-marketplace" }, "linux-do-marketplace", { modelListCurrency: "CREDITS" });
  if (failedModels.length) Object.assign(normalized, diagnostics);
  if (!normalized.data.length && !normalized.error) normalized.error = "Linux.do Marketplace 没有有效价格";
  return { normalized, url: new URL(LINUX_DO_GRAPHQL_ENDPOINT, station.baseUrl).toString(), status: catalogResponse.status };
}
