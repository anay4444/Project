const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildGeminiPrompt,
  isValidGeminiKey,
  isValidGeminiModel,
  parseGeminiResponse
} = require("../translation-providers");

test("validates Gemini keys without storing or exposing them", () => {
  assert.equal(isValidGeminiKey("AIza" + "a".repeat(36)), true);
  assert.equal(isValidGeminiKey("short"), false);
  assert.equal(isValidGeminiKey("bad key" + "a".repeat(30)), false);
  assert.equal(isValidGeminiModel("gemini-2.5-flash-lite"), true);
  assert.equal(isValidGeminiModel("bad model name"), false);
});

test("builds bounded contextual prompts with glossary instructions", () => {
  const prompt = buildGeminiPrompt({
    source: "ja",
    target: "en",
    glossary: "先輩: senpai",
    contextWindow: 1,
    segments: [{ id: "0", text: "先輩、待って!" }, { id: "1", text: "ここです。" }]
  });
  assert.match(prompt, /先輩: senpai/);
  assert.match(prompt, /Segment 0/);
  assert.match(prompt, /exactly one result/);
});

test("accepts only complete, uniquely mapped structured results", () => {
  const payload = {
    candidates: [{ content: { parts: [{ text: JSON.stringify({ translations: [
      { id: "1", text: "Here." },
      { id: "0", text: "Wait!" }
    ] }) }] } }]
  };
  assert.deepEqual(parseGeminiResponse(payload, ["0", "1"]), [
    { id: "0", text: "Wait!" },
    { id: "1", text: "Here." }
  ]);
  for (const translations of [
    [{ id: "0", text: "Wait!" }, { id: "0", text: "Again!" }],
    [{ id: "0", text: "Wait!" }],
    [{ id: "0", text: "Wait!" }, { id: "unknown", text: "?" }],
    [{ id: "0", text: 42 }, { id: "1", text: "Here." }],
    [{ id: "0", text: "x".repeat(2_001) }, { id: "1", text: "Here." }]
  ]) {
    assert.throws(() => parseGeminiResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify({ translations }) }] } }] }, ["0", "1"]), /invalid_response/);
  }
});
