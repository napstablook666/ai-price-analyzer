import test from "node:test";
import assert from "node:assert/strict";
import { siteIconMarkup, siteLogoUrl } from "../src/shared/site-icon.js";

// node 里没有 chrome.runtime.getURL，EXTENSION_BASE 会退成空串，
// 所以这里断言的是相对路径。扩展页面里的绝对前缀另算，不在这个模块的判断范围内。
test("有图标的站点给相对路径，没有的给空串", () => {
  assert.equal(siteLogoUrl("aiapi"), "icons/sites/aiapi.svg");
  assert.equal(siteLogoUrl("no-such-site"), "");
  assert.equal(siteLogoUrl(""), "");
});

test("有图标出 img，尺寸和懒加载都带上", () => {
  const markup = siteIconMarkup("aiapi", "AIAPI", { size: 18 });
  assert.match(markup, /<img class="site-logo"/);
  assert.match(markup, /src="icons\/sites\/aiapi\.svg"/);
  assert.match(markup, /width="18"/);
  assert.match(markup, /loading="lazy"/);
});

test("没图标退回站点首字母", () => {
  const markup = siteIconMarkup("no-such-site", "kimi");
  assert.match(markup, /class="site-logo is-neutral"/);
  assert.match(markup, />K</);
});

test("title 和首字母都要转义", () => {
  assert.match(siteIconMarkup("aiapi", "x", { label: 'a"b' }), /title="a&quot;b"/);
  assert.match(siteIconMarkup("no-such-site", "<b>"), /&lt;/);
});
