// DOM 契约的运行时一侧。
//
// 静态那边（scripts/check-html-ids.mjs）能算出「脚本里哪些 id 是被字面量引用的」，
// 但算不到运行时 DOM 实际长什么样：页面版本旧了、结构被别的脚本改过、渲染漏了分支，
// 静态分析都看不见。所以同一份清单要再交给浏览器核一次。
//
// 核的策略是「一次列全再停」，不是「崩在第一个」。缺一个和缺八个，对用户是同一件事，
// 对修的人却是八条信息。

export function assertDomContract(page, ids) {
  const missing = ids.filter((id) => !document.getElementById(id));
  if (!missing.length) return;
  const message = `${page} 缺少 ${missing.length} 个必需节点：${missing.map((id) => `#${id}`).join("、")}`;
  showFailure(message);
  throw new Error(message);
}

function showFailure(message) {
  if (typeof document === "undefined" || !document.body) return;
  if (document.getElementById("dom-contract-failure")) return;
  const box = document.createElement("pre");
  box.id = "dom-contract-failure";
  box.textContent = [
    "DOM 契约断裂",
    "",
    message,
    "",
    "页面脚本已停止。修好 HTML 或引用处之后重新加载扩展。",
  ].join("\n");
  box.style.cssText = [
    "position:fixed",
    "inset:12px 12px auto 12px",
    "z-index:2147483647",
    "margin:0",
    "padding:14px 16px",
    "border-radius:10px",
    "background:#7f1d1d",
    "color:#fff",
    "font:12px/1.6 ui-monospace,Consolas,monospace",
    "white-space:pre-wrap",
    "box-shadow:0 8px 32px rgba(0,0,0,.35)",
  ].join(";");
  document.body.prepend(box);
}

// 把 $() 换成严格版。
//
// 只对「清单里列出的纯 #id 选择器」较真：清单外的查询（后代选择器、class、属性），
// 以及动态拼接出来的 id，本来就可能为空，它们的可选性是真实的，不该被一刀切成抛错。
// 这样既能抓住契约内节点丢失，又不会让一堆按需渲染的区域突然崩掉。
export function makeQuery(page, ids) {
  const required = new Set(ids);
  return function query(selector) {
    const node = document.querySelector(selector);
    if (node) return node;
    const pure = /^#([A-Za-z0-9_-]+)$/.exec(String(selector));
    if (pure && required.has(pure[1])) {
      throw new Error(`${page} 必需的节点 ${selector} 不存在，DOM 契约断裂`);
    }
    return node;
  };
}
