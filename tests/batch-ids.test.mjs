import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../map.js", import.meta.url), "utf8");
const pick = (re) => { const m = src.match(re); assert.ok(m, `map.js 找不到 ${re}`); return m[0]; };
const expandBatchIds = new Function(
  pick(/const BATCH_RANGE_MAX = \d+;/) + "\n" +
  pick(/function expandBatchIds\(raw\) \{[\s\S]*?\n\}/) + "\nreturn expandBatchIds;"
)();

test("~ 連續編號展開並保留前導 0", () => {
  assert.deepEqual(expandBatchIds("0602515~0602518"), ["0602515", "0602516", "0602517", "0602518"]);
});

test("全形～、前後空白、後段只寫尾數都能用", () => {
  assert.deepEqual(expandBatchIds("0602598 ～ 0602601"), ["0602598", "0602599", "0602600", "0602601"]);
  assert.deepEqual(expandBatchIds("0602515~17"), ["0602515", "0602516", "0602517"]);
  assert.deepEqual(expandBatchIds("A01~A03"), ["A01", "A02", "A03"]);
  assert.throws(() => expandBatchIds("A01~B03"), /看不懂/);
});

test("跟一般編號混用、重複的只留一筆", () => {
  assert.deepEqual(expandBatchIds("0499512\n0602515~0602516, 0602516、0617312"),
    ["0499512", "0602515", "0602516", "0617312"]);
});

test("看不懂或範圍不合理要明確報錯，不能默默略過", () => {
  assert.throws(() => expandBatchIds("0602520~0602515"), /後面比前面小/);
  assert.throws(() => expandBatchIds("abc~def"), /看不懂/);
  assert.throws(() => expandBatchIds("0600000~0609999"), /最多/);
});

test("批次加入有用 expandBatchIds，提示文字有寫 ~ 用法", () => {
  assert.match(pick(/async function doBatchAdd\(\) \{[\s\S]*?\n\}/), /expandBatchIds\(raw\)/);
  assert.match(readFileSync(new URL("../index.html", import.meta.url), "utf8"), /連續編號用 ~/);
});
