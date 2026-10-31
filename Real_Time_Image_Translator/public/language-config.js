const LANGUAGES = Object.freeze({
  en: { label: "English", provider: "en", ocr: "eng" },
  es: { label: "Spanish", provider: "es", ocr: "spa" },
  it: { label: "Italian", provider: "it", ocr: "ita" },
  hi: { label: "Hindi", provider: "hi", ocr: "hin" },
  ja: { label: "Japanese", provider: "ja", ocr: "jpn" },
  ko: { label: "Korean", provider: "ko", ocr: "kor" },
  zh: { label: "Chinese (Simplified)", provider: "zh", ocr: "chi_sim" },
  "zh-TW": { label: "Chinese (Traditional OCR)", provider: "zh", ocr: "chi_tra" }
});
const SUPPORTED_LANGUAGE_CODES = Object.freeze(["en", "es", "it", "hi", "ja", "ko", "zh"]);

const isAllowedLanguage = (value, allowAuto = false) =>
  (allowAuto && value === "auto") || SUPPORTED_LANGUAGE_CODES.includes(value);

const getOcrLanguage = (value) => {
  if (value === "auto") {
    return Object.values(LANGUAGES).filter((item) => item.ocr !== "chi_tra").map((item) => item.ocr).join("+");
  }
  return LANGUAGES[value]?.ocr || null;
};

const getProviderLanguage = (value) => LANGUAGES[value]?.provider || null;
