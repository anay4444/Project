const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildGeminiPrompt,
  isValidGeminiKey,
  parseGeminiResponse
} = require("../translation-providers");

test("validates Gemini keys without storing or exposing them", () => {
  assert.equal(isValidGeminiKey("AIza" + "a".repeat(36)), true);
  assert.equal(isValidGeminiKey("short"), false);
  assert.equal(isValidGeminiKey("bad key" + "a".repeat(30)), false);
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
      { id: "0", text: "Wait!" },
      { id: "1", text: "Here." }
    ] }) }] } }]
  };
  assert.deepEqual(parseGeminiResponse(payload, ["0", "1"]), [
    { id: "0", text: "Wait!" },
    { id: "1", text: "Here." }
  ]);
  assert.throws(() => parseGeminiResponse(payload, ["0"]), /invalid_response/);
});
