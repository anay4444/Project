const GEMINI_PROVIDER = "gemini";
const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash-lite";
const GEMINI_KEY = /^[A-Za-z0-9._-]{20,512}$/;
const GEMINI_MODEL = /^[a-z0-9][a-z0-9._-]{1,79}$/;
const MAX_GEMINI_RESULT_TEXT = 2_000;

const isValidGeminiKey = (value) => typeof value === "string" && GEMINI_KEY.test(value);
const isValidGeminiModel = (value) => typeof value === "string" && GEMINI_MODEL.test(value);

const buildGeminiPrompt = ({ segments, source, target, glossary, contextWindow }) => {
  const rows = segments.map((segment, index) => {
    const start = Math.max(0, index - contextWindow);
    const end = Math.min(segments.length, index + contextWindow + 1);
    const context = segments.slice(start, end).map((item) => `${item.id}: ${item.text}`).join("\n");
    return `Segment ${segment.id}:\n${segment.text}\nNearby context:\n${context}`;
  }).join("\n\n");
  return [
    "Translate every segment without summarizing, omitting, merging, or reordering them.",
    `Source language: ${source === "auto" ? "auto-detect, limited to English, Spanish, Italian, Hindi, Japanese, Korean, or Simplified Chinese" : source}.`,
    `Target language: ${target}.`,
    "Preserve names, punctuation, tone, formality, honorifics, and speaker ambiguity where the source does not resolve it.",
    glossary ? `Preferred glossary terms:\n${glossary}` : "No glossary was provided.",
    "Return JSON only in the form {\"translations\":[{\"id\":\"...\",\"text\":\"...\"}]} with exactly one result for every segment ID.",
    rows
  ].join("\n\n");
};

const parseGeminiResponse = (payload, ids) => {
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text) {
    throw new Error("invalid_response");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("invalid_response");
  }
  if (!Array.isArray(parsed.translations) || parsed.translations.length !== ids.length || ids.length > 60) {
    throw new Error("invalid_response");
  }
  const seen = new Set();
  const translations = parsed.translations.map((item) => {
    if (!item || typeof item.id !== "string" || item.id.length > 80 || !ids.includes(item.id) || seen.has(item.id) || typeof item.text !== "string" || item.text.length > MAX_GEMINI_RESULT_TEXT) {
      throw new Error("invalid_response");
    }
    seen.add(item.id);
    return { id: item.id, text: item.text };
  });
  if (seen.size !== ids.length) {
    throw new Error("invalid_response");
  }
  return ids.map((id) => translations.find((item) => item.id === id));
};

module.exports = {
  GEMINI_PROVIDER,
  GEMINI_DEFAULT_MODEL,
  isValidGeminiKey,
  isValidGeminiModel,
  buildGeminiPrompt,
  parseGeminiResponse
};
