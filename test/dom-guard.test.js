import test from "node:test";
import assert from "node:assert/strict";
import { assertDomContract, makeQuery } from "../src/core/dom-guard.js";

// dom-guard 平时跑在浏览器里，这里给一个最小 document 替身：
// 只实现它实际用到的那几个成员，多一个都不加，免得测试替身反过来把实现养肥。
function withDom(presentIds, run) {
  const present = new Set(presentIds);
  const created = [];
  globalThis.document = {
    body: { prepend: (node) => created.push(node) },
    getElementById: (id) => (present.has(id) ? { id } : null),
    querySelector: (selector) => {
      const pure = /^#([A-Za-z0-9_-]+)$/.exec(selector);
      return pure && present.has(pure[1]) ? { id: pure[1] } : null;
    },
    createElement: () => ({ id: "", textContent: "", style: {} }),
  };
  try {
    return run(created);
  } finally {
    delete globalThis.document;
  }
}

test("契约齐全时直接放过", () => {
  withDom(["a", "b"], (created) => {
    assert.doesNotThrow(() => assertDomContract("p.html", ["a", "b"]));
    assert.equal(created.length, 0);
  });
});

test("缺节点时一次列全再抛，不是崩在第一个", () => {
  withDom(["a"], (created) => {
    assert.throws(
      () => assertDomContract("p.html", ["a", "b", "c"]),
      (error) => {
        assert.match(error.message, /p\.html 缺少 2 个必需节点/);
        assert.match(error.message, /#b/);
        assert.match(error.message, /#c/);
        return true;
      }
    );
    assert.equal(created.length, 1);
    assert.match(created[0].textContent, /DOM 契约断裂/);
    assert.match(created[0].textContent, /#b、#c|#b.*#c/);
  });
});

test("$ 只对清单内的纯 id 选择器较真", () => {
  withDom(["a"], () => {
    const $ = makeQuery("p.html", ["a", "missing-later"]);
    assert.deepEqual($("#a"), { id: "a" });
    // 清单外的查询本来就可能为空，保持返回 null，不抛
    assert.equal($("#nobody"), null);
    assert.equal($("#a .inner"), null);
    assert.equal($(".anything"), null);
    // 清单内但已经不在 DOM 里，这才是契约断裂
    assert.throws(() => $("#missing-later"), /p\.html 必需的节点 #missing-later 不存在/);
  });
});

test("非字符串选择器不会让严格版 $ 抛错", () => {
  withDom(["a"], () => {
    const $ = makeQuery("p.html", ["a"]);
    assert.equal($(undefined), null);
    assert.equal($(null), null);
  });
});
