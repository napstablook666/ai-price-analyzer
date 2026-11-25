// 登录站保活排期：只算时间，不碰 chrome，方便直接测。
// 目标是让保活频率跟着「令牌哪天过期」走，而不是跟着「采集跑了几轮」走：
// 100 个登录站每天也就 100 次，且摊在一天里，不集中在一次采集里开 100 个标签页。
export const KEEPALIVE_DEFAULTS = Object.freeze({
  // 提前多久动手，给失败留一次重试的余量。
  marginMs: 10 * 60 * 1000,
  // 散列槽位粒度：同刻到期的站按站点 id 摊到不同槽，避免整点一起醒。
  slotMs: 5 * 60 * 1000,
  slotsPerDay: 288,
  // 再急也不早于 now+1min，免得 alarm 立刻回环。
  minDelayMs: 60 * 1000,
  // 再远也不晚于 now+23h：超过一天不碰，站点会话本身就可能被服务端回收。
  maxDelayMs: 23 * 60 * 60 * 1000,
  // 已经过期的站要尽快动手，但也不能全挤在同一分钟，散在 15 分钟内。
  expiredStaggerMs: 15 * 60 * 1000,
  backoffBaseMs: 15 * 60 * 1000,
  maxBackoffMs: 6 * 60 * 60 * 1000,
  // 连续失败到这个次数才认定「要重新登录」，在此之前只是状态未知。
  failureThreshold: 3
});

export const KEEPALIVE_ALARM_PREFIX = "auth-keepalive:";

export function keepaliveAlarmName(stationId) {
  return `${KEEPALIVE_ALARM_PREFIX}${String(stationId || "")}`;
}

// FNV-1a：同一站点永远落到同一槽，不同站点散开；不依赖 Math.random，重启后结果不变。
function hashStationId(stationId) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < stationId.length; index += 1) {
    hash ^= stationId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function keepaliveSlotOffset(stationId, config = KEEPALIVE_DEFAULTS) {
  const slots = Math.max(1, Number(config.slotsPerDay) || 1);
  return (hashStationId(String(stationId || "")) % slots) * (Number(config.slotMs) || 0);
}

function renewalKindOf(entry) {
  return String(entry?.renewalKind || entry?.kind || "");
}

// 入参是凭据仓的每站一条记录：{ stationId, expiresAt, renewFailures, renewalKind }。
// 出参是排好序的 [{ stationId, when, delayMs, attempt }]，只含有必要保活的站。
export function planKeepalive(entries, now = Date.now(), options = {}) {
  const config = { ...KEEPALIVE_DEFAULTS, ...options };
  const currentTime = Number(now);
  const plans = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const stationId = String(entry?.stationId || "");
    if (!stationId) continue;
    // 长效令牌由用户自己粘，没有过期概念，排期没有意义。
    if (renewalKindOf(entry) === "manual-token") continue;

    const attempt = Math.max(0, Math.floor(Number(entry?.renewFailures) || 0));
    let when;
    if (attempt > 0) {
      // 失败退避：15min 起翻倍，封顶 6h，别把打不通的站打成高频重试。
      when = currentTime + Math.min(config.maxBackoffMs, config.backoffBaseMs * 2 ** (attempt - 1));
    } else {
      const expiresAt = Number(entry?.expiresAt);
      const hasExpiry = Number.isFinite(expiresAt) && expiresAt > 0;
      const stagger = keepaliveSlotOffset(stationId, config);
      if (!hasExpiry) {
        // 没有过期时间的站没有「临期」可言，只能按最晚一拍叫醒，不参与散列。
        when = currentTime + config.maxDelayMs;
      } else if (expiresAt <= currentTime + config.minDelayMs) {
        // 已经到期的站不按整天散列，否则一个早过期的站能被推到几小时后才醒。
        when = currentTime + config.minDelayMs + (stagger % config.expiredStaggerMs);
      } else {
        // 散列只能落在「现在」到「临期前 margin」之间。直接加最省事，但槽位最大
        // 23h55m，令牌只活几小时的站会被推到过期之后，等于续了个死令牌，
        // 所以窗口更窄时按窗口取模。
        const window = Math.max(1, expiresAt - config.marginMs - (currentTime + config.minDelayMs));
        when = expiresAt - config.marginMs - (stagger % window);
      }
    }
    when = Math.min(Math.max(when, currentTime + config.minDelayMs), currentTime + config.maxDelayMs);
    plans.push({ stationId, when, delayMs: when - currentTime, attempt });
  }
  plans.sort((left, right) => left.when - right.when || left.stationId.localeCompare(right.stationId));
  return plans;
}

// 一次保活跑完后的仓状态补丁。成功清零退避；失败累加，够次数才转 needsLogin。
export function applyKeepaliveResult(entry, succeeded, now = Date.now(), options = {}) {
  const config = { ...KEEPALIVE_DEFAULTS, ...options };
  const attempt = Math.max(0, Math.floor(Number(entry?.renewFailures) || 0));
  if (succeeded) return { status: "ok", renewFailures: 0, lastRenewedAt: Number(now) };
  const nextAttempt = attempt + 1;
  return {
    status: nextAttempt >= config.failureThreshold ? "needsLogin" : "unknown",
    renewFailures: nextAttempt
  };
}
// alarm 数量有上限，超出的站按批合并。批号只是名字，名单要跟批号一起存：
// 排期每次重算次序都会变，靠批号回切当前排期会错位。
export function planKeepaliveSweeps(plans, options = {}) {
  const config = { ...KEEPALIVE_DEFAULTS, ...options };
  const limit = Math.max(0, Math.floor(Number(config.alarmLimit) || 0));
  const size = Math.max(1, Math.floor(Number(config.sweepSize) || 1));
  const overflow = (Array.isArray(plans) ? plans : []).slice(limit);
  const sweeps = [];
  for (let start = 0; start < overflow.length; start += size) {
    const batch = overflow.slice(start, start + size);
    sweeps.push({
      name: `${KEEPALIVE_ALARM_PREFIX}sweep:${start / size}`,
      when: Number(batch[0]?.when) || 0,
      stationIds: batch.map(plan => String(plan?.stationId || ""))
    });
  }
  return sweeps;
}

// 批次该叫醒哪几个站。名单是排期那一刻存下来的，优先用它：
// 排期随时重算，靠批号回切当前排期会把不该醒的站叫醒、把该醒的站推到尾巴丢掉。
// 名单丢了（重装、存储被清）才退回按当前排期算。
export function resolveSweepStationIds(roster, alarmName, plans, options = {}) {
  const config = { ...KEEPALIVE_DEFAULTS, ...options };
  const limit = Math.max(0, Math.floor(Number(config.alarmLimit) || 0));
  const size = Math.max(1, Math.floor(Number(config.sweepSize) || 1));
  const stored = roster?.[String(alarmName || "")];
  if (Array.isArray(stored) && stored.length) return stored.filter(id => typeof id === "string" && id);
  const index = Number(String(alarmName || "").slice(`${KEEPALIVE_ALARM_PREFIX}sweep:`.length));
  if (!Number.isInteger(index) || index < 0) return [];
  return (Array.isArray(plans) ? plans : [])
    .slice(limit + index * size, limit + (index + 1) * size)
    .map(plan => String(plan?.stationId || ""));
}

// 仓里这条能不能当「登录态还活着」。过期时间缺失不等于永不过期：
// 只有用户自己粘的长效令牌是那样，别的站缺过期时间只是「还没测出来」。
export function authConfirmedFromRenewal(renewal, kind, now = Date.now()) {
  if (!renewal || renewal.status !== "ok") return false;
  if (String(kind || "") === "manual-token") return true;
  const expiresAt = Number(renewal.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt > Number(now);
}