const express = require("express");
const dotenv = require("dotenv");
const rateLimit = require("express-rate-limit");

dotenv.config();

const MAX_TEXTS = 60;
const MAX_TEXT_LENGTH = 2_000;
const MAX_TOTAL_TEXT_LENGTH = 30_000;
const MAX_TTS_TEXT_LENGTH = 4_000;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const LANGUAGE_CODE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const VOICE_NAME = /^[a-zA-Z0-9_.-]{1,80}$/;

const createLimiter = (limit) =>
  rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false
  });

const createConcurrencyLimit = (limit) => {
  let active = 0;
  return (req, res, next) => {
    if (active >= limit) {
      return res.status(429).json({ error: "Too many concurrent requests." });
    }
    active += 1;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        active -= 1;
      }
    };
    res.on("finish", release);
    res.on("close", release);
    return next();
  };
};

const isAuthorized = (req) => {
  const expected = process.env.TRANSLATOR_API_TOKEN;
  if (!expected) {
    return true;
  }
  return req.get("authorization") === `Bearer ${expected}`;
};

const requireAuthorization = (req, res, next) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "Authentication required." });
  }
  return next();
};

const validateLanguage = (value, allowAuto = false) => {
  if (allowAuto && value === "auto") {
    return true;
  }
  return typeof value === "string" && LANGUAGE_CODE.test(value);
};

const readResponseWithLimit = async (response, maxBytes) => {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("upstream_response_too_large");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new Error("upstream_response_too_large");
    }
    return buffer;
  }

  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("upstream_response_too_large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
};

const fetchWithTimeout = (url, options, timeoutMs) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });

const buildKokoroHeaders = () => {
  const headers = { "Content-Type": "application/json" };

  if (process.env.KOKORO_TTS_BEARER_TOKEN) {
    headers.Authorization = "Bearer " + process.env.KOKORO_TTS_BEARER_TOKEN;
  }

  if (process.env.KOKORO_TTS_EXTRA_HEADERS) {
    try {
      const parsed = JSON.parse(process.env.KOKORO_TTS_EXTRA_HEADERS);
      Object.assign(headers, parsed);
    } catch {
      // Ignore invalid JSON to keep service available.
    }
  }

  return headers;
};

const createApp = () => {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob: https:; script-src 'self' https://cdn.jsdelivr.net; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  app.use(express.static("public", { extensions: ["html"] }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.post("/api/translate", requireAuthorization, createLimiter(30), createConcurrencyLimit(4), async (req, res) => {
    const { texts, target = "en", source = "auto" } = req.body || {};
    const totalLength = Array.isArray(texts) ? texts.reduce((sum, text) => sum + (typeof text === "string" ? text.length : 0), 0) : 0;
    if (!Array.isArray(texts) || texts.length === 0 || texts.length > MAX_TEXTS || texts.some((text) => typeof text !== "string" || !text.trim() || text.length > MAX_TEXT_LENGTH) || totalLength > MAX_TOTAL_TEXT_LENGTH) {
      return res.status(400).json({ error: "texts must contain up to 60 non-empty strings within the size limits." });
    }
    if (!validateLanguage(target) || !validateLanguage(source, true)) {
      return res.status(400).json({ error: "Invalid source or target language code." });
    }

    const provider = process.env.TRANSLATION_PROVIDER || "libretranslate";
    const translationUrl = process.env.TRANSLATION_URL;
    const apiKey = process.env.TRANSLATION_API_KEY;
    if (!translationUrl) {
      return res.status(503).json({ error: "Translation service is not configured." });
    }

    try {
      const requestTranslation = async (q) => {
        const body = provider === "google"
          ? { q, target, ...(source !== "auto" ? { source } : {}) }
          : { q, target, ...(source !== "auto" ? { source } : {}), ...(apiKey ? { api_key: apiKey } : {}) };
        const response = await fetchWithTimeout(translationUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }, 15_000);
        const payload = JSON.parse((await readResponseWithLimit(response, 512 * 1024)).toString("utf8"));
        if (!response.ok) {
          throw new Error("translation_upstream_error");
        }
        return provider === "google"
          ? payload?.data?.translations?.map((item) => item.translatedText || "")
          : payload?.translatedText
            ? [payload.translatedText]
            : payload?.translations?.map((item) => item.translatedText || item.text || "");
      };
      const batches = provider === "google" ? [texts] : texts.map((text) => [text]);
      const translated = [];
      for (let index = 0; index < batches.length; index += 4) {
        translated.push(...(await Promise.all(batches.slice(index, index + 4).map(requestTranslation))).flat());
      }
      if (!Array.isArray(translated) || translated.length !== texts.length) {
        return res.status(502).json({ error: "Translation service returned an invalid response." });
      }
      return res.json({ translated });
    } catch {
      return res.status(504).json({ error: "Translation service timed out or returned an invalid response." });
    }
  });

  app.post("/api/tts", requireAuthorization, createLimiter(12), createConcurrencyLimit(2), async (req, res) => {
    const kokoroUrl = process.env.KOKORO_TTS_URL;
    if (!kokoroUrl) {
      return res.status(503).json({ error: "TTS service is not configured." });
    }
    const { text, voice = "af_heart", speed = 1 } = req.body || {};
    if (typeof text !== "string" || !text.trim() || text.length > MAX_TTS_TEXT_LENGTH || !VOICE_NAME.test(voice) || !Number.isFinite(speed) || speed < 0.5 || speed > 2) {
      return res.status(400).json({ error: "Invalid text, voice, or speed." });
    }

    try {
      const upstream = await fetchWithTimeout(kokoroUrl, {
        method: "POST",
        headers: buildKokoroHeaders(),
        body: JSON.stringify({ text, voice, speed })
      }, 20_000);
      if (!upstream.ok) {
        return res.status(502).json({ error: "TTS service unavailable." });
      }
      const audioBuffer = await readResponseWithLimit(upstream, MAX_AUDIO_BYTES);
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "audio/mpeg");
      res.setHeader("Content-Length", String(audioBuffer.byteLength));
      return res.send(audioBuffer);
    } catch {
      return res.status(504).json({ error: "TTS service timed out or returned an invalid response." });
    }
  });

  app.get("*", (_req, res) => res.sendFile("index.html", { root: "public" }));
  return app;
};

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, () => console.log(`Real-time image translator server listening at http://localhost:${port}`));
}

module.exports = { createApp, readResponseWithLimit };
