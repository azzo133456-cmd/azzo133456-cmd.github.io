import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../map.js", import.meta.url), "utf8");
const pick = (re) => { const m = src.match(re); assert.ok(m, `map.js 找不到 ${re}`); return m[0]; };
const { visitWrongDistricts } = new Function(
  pick(/const VISIT_ALLOWED_DISTRICTS = \{[\s\S]*?\n\};/) + "\n" +
  pick(/const TAOYUAN_DISTRICTS = \[[\s\S]*?\];/) + "\n" +
  pick(/function visitDistricts\(label, note\) \{[\s\S]*?\n\}/) + "\n" +
  pick(/function visitWrongDistricts\(area, label, note\) \{[\s\S]*?\n\}/) +
  "\nreturn { visitWrongDistricts };"
)();

test("蘆竹只收蘆竹區、桃園區", () => {
  assert.deepEqual(visitWrongDistricts("luzhu", "桃園市蘆竹區南崁路1號", ""), []);
  assert.deepEqual(visitWrongDistricts("luzhu", "桃園市桃園區中正路", ""), []);
  assert.deepEqual(visitWrongDistricts("luzhu", "桃園市楊梅區中山路", ""), ["楊梅區"]);
  assert.deepEqual(visitWrongDistricts("lzpaiwai", "大園區中正東路", ""), ["大園區"]);
});

test("楊梅只收楊梅區、觀音區", () => {
  assert.deepEqual(visitWrongDistricts("yangmei", "觀音區廣福里", ""), []);
  assert.deepEqual(visitWrongDistricts("yangmei", "楊梅區梅高路", ""), []);
  assert.deepEqual(visitWrongDistricts("yangmei", "桃園市蘆竹區南崁路", ""), ["蘆竹區"]);
  assert.deepEqual(visitWrongDistricts("ympaiwai", "桃園區中正路", ""), ["桃園區"]);
});

test("地點沒寫區才看備註；地點有寫區就不看備註", () => {
  assert.deepEqual(visitWrongDistricts("yangmei", "中山路口", "地點在新屋區"), ["新屋區"]);
  assert.deepEqual(visitWrongDistricts("yangmei", "楊梅區中山路口", "副本：蘆竹區公所"), []);
});

test("判斷不出區、或沒有限制的模式就不擋", () => {
  assert.deepEqual(visitWrongDistricts("luzhu", "中興路/中興二街口", ""), []);
  assert.deepEqual(visitWrongDistricts("xinbei", "桃園市楊梅區", ""), []);
});

test("新增會勘時有檢查區域並跳確認", () => {
  const add = pick(/async function addVisit\(\) \{[\s\S]*?\n\}/);
  assert.match(add, /visitWrongDistricts\(mode, label, note\)/);
  assert.match(add, /confirm\(/);
});
