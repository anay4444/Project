const test = require("node:test");
const assert = require("node:assert/strict");
const { LANGUAGES, SUPPORTED_LANGUAGE_CODES, isAllowedLanguage, getOcrLanguage, getProviderLanguage } = require("../language-config");

test("supports exactly the requested seven UI languages", () => {
  assert.deepEqual(SUPPORTED_LANGUAGE_CODES.slice().sort(), ["en", "es", "hi", "it", "ja", "ko", "zh"]);
  ["en", "es", "hi", "it", "ja", "ko", "zh"].forEach((code) => assert.equal(isAllowedLanguage(code), true));
  ["fr", "de", "pt", "", "EN", "zh-Hans"].forEach((code) => assert.equal(isAllowedLanguage(code), false));
  assert.equal(isAllowedLanguage("auto", true), true);
  assert.equal(isAllowedLanguage("auto"), false);
});

test("maps OCR and provider codes for every supported language", () => {
  const expected = { en: ["eng", "en"], es: ["spa", "es"], hi: ["hin", "hi"], it: ["ita", "it"], ja: ["jpn", "ja"], ko: ["kor", "ko"], zh: ["chi_sim", "zh"] };
  Object.entries(expected).forEach(([code, [ocr, provider]]) => {
    assert.equal(getOcrLanguage(code), ocr);
    assert.equal(getProviderLanguage(code), provider);
  });
  assert.match(getOcrLanguage("auto"), /eng/);
});
