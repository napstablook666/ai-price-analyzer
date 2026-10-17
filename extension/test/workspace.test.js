import assert from "node:assert/strict";
import test from "node:test";
import { enqueueWorkspaceOperation, parseWorkspaceState } from "../src/shared/workspace.js";

const state = { version: 1, stations: [] };

test("parses wrapped workspace state", () => {
  const parsed = parseWorkspaceState({ format: "ai-price-analyzer-workspace", version: 1, state });
  assert.equal(parsed, state);
});

test("accepts an existing portable JSON export", () => {
  assert.equal(parseWorkspaceState(state), state);
});

test("rejects malformed workspace data", () => {
  assert.throws(() => parseWorkspaceState({ version: 1 }), /工作区数据格式不正确/);
});


test("rejects malformed station records before import", () => {
  assert.throws(() => parseWorkspaceState({ version: 1, stations: [{}] }), /导入站点格式不正确/);
});

test("serializes workspace operations", async () => {
  const order = [];
  const first = enqueueWorkspaceOperation(async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
    order.push("first");
  });
  const second = enqueueWorkspaceOperation(async () => order.push("second"));
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first", "second"]);
});
