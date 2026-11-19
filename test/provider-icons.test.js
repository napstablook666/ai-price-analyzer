import test from "node:test";
import assert from "node:assert/strict";
import { providerIconMarkup, providerLogoFor, providerLogoSlug } from "../src/shared/provider-icons.js";

test("同一家供应商的不同写法归到同一个 slug", () => {
  assert.equal(providerLogoSlug("z-ai"), "zai");
  assert.equal(providerLogoSlug("ZAI-Org"), "zai");
  assert.equal(providerLogoSlug("~deepseek"), "deepseek");
  assert.equal(providerLogoSlug("meta-llama"), "meta");
  assert.equal(providerLogoSlug("  Google  "), "google");
});

test("别名表没收录的写法退到模型名提示", () => {
  assert.equal(providerLogoSlug("gpt-4o"), "openai");
  assert.equal(providerLogoSlug("claude-3-5-sonnet"), "anthropic");
  assert.equal(providerLogoSlug("qwen-max"), "qwen");
});

test("认不出来就返回空串，不要瞎猜一个品牌", () => {
  assert.equal(providerLogoSlug(""), "");
  assert.equal(providerLogoSlug("   "), "");
  assert.equal(providerLogoSlug("某个没听过的东西"), "");
});

test("候选值里第一个真能对上图标的胜出", () => {
  assert.equal(providerLogoFor(["", "claude"]), "anthropic");
  assert.equal(providerLogoFor(["nope-provider", "openai"]), "openai");
  assert.equal(providerLogoFor(["nope-provider"]), "");
});

test("没有品牌图形时落成首字母块", () => {
  const markup = providerIconMarkup(["nope-provider"]);
  assert.match(markup, /class="model-logo is-neutral"/);
  assert.match(markup, />NO</);
});

test("有图形就内联 SVG，尺寸跟传参走", () => {
  const markup = providerIconMarkup(["openai"], { size: 20 });
  assert.match(markup, /<svg viewBox=/);
  assert.match(markup, /width="20" height="20"/);
  assert.match(markup, /--brand:#10A37F/);
});

test("品牌没有主题色时不写 style", () => {
  assert.equal(/style="--brand/.test(providerIconMarkup(["zai"])), false);
});

test("title 里的引号和尖括号要转义", () => {
  assert.match(providerIconMarkup(["openai"], { label: 'a"b<c' }), /title="a&quot;b&lt;c"/);
});
