import assert from "node:assert/strict";
import test from "node:test";
import {
  modelCreationTime,
  sortDiscoveredModels,
} from "../../src/model/model-catalog-sort";

test("normalizes OpenAI timestamps and Anthropic creation dates without inventing dates", () => {
  assert.equal(
    modelCreationTime({ created: 1727740800 }),
    Date.parse("2024-10-01T00:00:00Z"),
  );
  assert.equal(
    modelCreationTime({ created_at: "2026-09-21T00:00:00Z" }),
    Date.parse("2026-09-21T00:00:00Z"),
  );
  for (const value of [
    {},
    { created: 0 },
    { created: -1 },
    { created: Infinity },
    { created: "2026" },
    { created_at: "bad" },
  ]) {
    assert.equal(modelCreationTime(value), undefined);
  }
});

test("orders dated models newest first, then undated versions naturally descending, without mutating input", () => {
  const input = [
    { id: "gpt-4", name: "", createdAt: 1 },
    { id: "gpt-100", name: "" },
    { id: "gpt-10", name: "" },
    { id: "gpt-5", name: "", createdAt: 3 },
    { id: "gpt-6", name: "", createdAt: 2 },
    { id: "gpt-6-luna", name: "" },
  ];
  assert.deepEqual(
    sortDiscoveredModels(input).map((model) => model.id),
    ["gpt-5", "gpt-6", "gpt-4", "gpt-100", "gpt-10", "gpt-6-luna"],
  );
  assert.equal(input[0].id, "gpt-4");
});

test("equal catalog dates use descending natural versions and retain unknown model families", () => {
  assert.deepEqual(
    sortDiscoveredModels([
      { id: "gpt-5.6", name: "", createdAt: 1 },
      { id: "gpt-6.1-sol", name: "", createdAt: 1 },
      { id: "gpt-6-astra", name: "", createdAt: 1 },
      { id: "custom-2", name: "" },
      { id: "custom-10", name: "" },
    ]).map((model) => model.id),
    ["gpt-6.1-sol", "gpt-6-astra", "gpt-5.6", "custom-10", "custom-2"],
  );
});
