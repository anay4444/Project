const express = require("express");
const dotenv = require("dotenv");
const rateLimit = require("express-rate-limit");
const crypto = require("node:crypto");
const { LANGUAGES, isAllowedLanguage, getProviderLanguage } = require("./language-config");
const {
  GEMINI_PROVIDER,
  GEMINI_DEFAULT_MODEL,
  isValidGeminiKey,
  isValidGeminiModel,
  buildGeminiPrompt,
  parseGeminiResponse
} = require("./translation-providers");

dotenv.config();

const MAX_TEXTS = 60;
const MAX_TEXT_LENGTH = 2_000;
const MAX_TOTAL_TEXT_LENGTH = 30_000;
const MAX_TTS_TEXT_LENGTH = 4_000;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_TRANSLATION_DURATION_MS = 30_000;
const MAX_TRANSLATION_CALL_MS = 15_000;
const VOICE_NAME = /^[a-zA-Z0-9_.-]{1,80}$/;
const TRANSLATION_PROVIDERS = new Set(["libretranslate", "google", GEMINI_PROVIDER]);
const sessions = new Map();

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
  const password = process.env.TRANSLATOR_ACCESS_PASSWORD;
  if (!password) {
    return true;
  }
  const token = req.cookies?.translator_session;
  const session = typeof token === "string" ? sessions.get(token) : null;
  return Boolean(session && session.expiresAt > Date.now());
};

const requireAuthorization = (req, res, next) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "Authentication required." });
  }
  return next();
};

const createSession = () => {
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(token, { expiresAt: Date.now() + 8 * 60 * 60 * 1000, cloud: null });
  return token;
};

const expireSessions = () => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
    }
  }
};

const getSession = (req) => {
  const token = req.cookies?.translator_session;
  const session = typeof token === "string" ? sessions.get(token) : null;
  return session && session.expiresAt > Date.now() ? session : null;
};

const setSessionCookie = (res, token) => {
  res.setHeader("Set-Cookie", `translator_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
};

class UpstreamError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

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

const fetchWithTimeout = (url, options, timeoutMs, deadlineSignal) =>
  fetch(url, {
    ...options,
    signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), deadlineSignal])
  });

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
    res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob: https:; script-src 'self'; worker-src 'self' blob:; style-src 'self'; connect-src 'self' https://tessdata.projectnaptha.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });
  app.use((req, _res, next) => {
    expireSessions();
    req.cookies = {};
    const cookie = req.get("cookie") || "";
    for (const part of cookie.split(";")) {
      const [name, ...value] = part.trim().split("=");
      if (name) {
        try {
          req.cookies[name] = decodeURIComponent(value.join("="));
        } catch {
          req.cookies[name] = "";
        }
      }
    }
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  app.use(express.static("public", { extensions: ["html"] }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.get("/api/session", (req, res) => {
    res.json({ authenticated: isAuthorized(req), required: Boolean(process.env.TRANSLATOR_ACCESS_PASSWORD) });
  });

  app.post("/api/login", createLimiter(10), (req, res) => {
    const password = process.env.TRANSLATOR_ACCESS_PASSWORD;
    if (!password) {
      return res.status(404).json({ error: "Authentication is not enabled." });
    }
    const supplied = typeof req.body?.password === "string" ? Buffer.from(req.body.password) : Buffer.alloc(0);
    const expected = Buffer.from(password);
    const valid = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials." });
    }
    const token = createSession();
    setSessionCookie(res, token);
    return res.json({ authenticated: true });
  });

  app.post("/api/logout", requireAuthorization, (req, res) => {
    const token = req.cookies?.translator_session;
    if (token) {
      sessions.delete(token);
    }
    res.setHeader("Set-Cookie", "translator_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    return res.json({ authenticated: false });
  });

  app.get("/api/provider", requireAuthorization, (req, res) => {
    const session = getSession(req);
    const cloud = session?.cloud;
    return res.json({
      provider: cloud?.provider || "local",
      connected: Boolean(cloud?.apiKey),
      model: cloud?.model || GEMINI_DEFAULT_MODEL,
      quota: "Provider quota and billing are controlled by your Gemini account."
    });
  });

  app.post("/api/provider/connect", requireAuthorization, createLimiter(6), (req, res) => {
    const provider = req.body?.provider;
    const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
    if (provider !== GEMINI_PROVIDER || !isValidGeminiKey(apiKey)) {
      return res.status(400).json({ error: "Provide a valid Gemini API key." });
    }
    let token = req.cookies?.translator_session;
    let session = getSession(req);
    if (!session) {
      token = createSession();
      session = sessions.get(token);
      setSessionCookie(res, token);
    }
    const model = process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL;
    if (!isValidGeminiModel(model)) {
      return res.status(503).json({ error: "Gemini model configuration is invalid." });
    }
    session.cloud = { provider: GEMINI_PROVIDER, apiKey, model };
    return res.json({ provider: GEMINI_PROVIDER, connected: true, model: session.cloud.model });
  });

  app.post("/api/provider/disconnect", requireAuthorization, (req, res) => {
    const session = getSession(req);
    if (session) session.cloud = null;
    return res.json({ provider: "local", connected: false });
  });

  app.post("/api/translate", requireAuthorization, createLimiter(30), createConcurrencyLimit(4), async (req, res) => {
    const { texts, segments, target = "en", source = "auto", provider = "local", glossary = "", contextWindow = 2 } = req.body || {};
    const totalLength = Array.isArray(texts) ? texts.reduce((sum, text) => sum + (typeof text === "string" ? text.length : 0), 0) : 0;
    if (!Array.isArray(texts) || texts.length === 0 || texts.length > MAX_TEXTS || texts.some((text) => typeof text !== "string" || !text.trim() || text.length > MAX_TEXT_LENGTH) || totalLength > MAX_TOTAL_TEXT_LENGTH) {
      return res.status(400).json({ error: "texts must contain up to 60 non-empty strings within the size limits." });
    }
    if (!isAllowedLanguage(target) || !isAllowedLanguage(source, true)) {
      return res.status(400).json({ error: "Invalid source or target language code." });
    }
    if (!["local", GEMINI_PROVIDER].includes(provider) || !Number.isInteger(contextWindow) || contextWindow < 0 || contextWindow > 5 || typeof glossary !== "string" || glossary.length > 5_000) {
      return res.status(400).json({ error: "Invalid provider, glossary, or context settings." });
    }
    if (segments !== undefined && (!Array.isArray(segments) || segments.length !== texts.length || segments.some((segment, index) => !segment || String(segment.id) !== String(index) || typeof segment.text !== "string" || segment.text !== texts[index]))) {
      return res.status(400).json({ error: "Segments must match the submitted text items." });
    }
    const providerTarget = getProviderLanguage(target);
    const providerSource = source === "auto" ? null : getProviderLanguage(source);

    const selectedProvider = provider === GEMINI_PROVIDER ? GEMINI_PROVIDER : process.env.TRANSLATION_PROVIDER || "libretranslate";
    const translationUrl = process.env.TRANSLATION_URL;
    const apiKey = process.env.TRANSLATION_API_KEY;
    const cloudSession = getSession(req)?.cloud;
    const geminiKey = cloudSession?.provider === GEMINI_PROVIDER ? cloudSession.apiKey : null;
    if (!TRANSLATION_PROVIDERS.has(selectedProvider) || (selectedProvider !== GEMINI_PROVIDER && !translationUrl) || (selectedProvider === "google" && !apiKey) || (provider === GEMINI_PROVIDER && !geminiKey)) {
      return res.status(503).json({ error: "Translation service is not configured." });
    }

    const deadlineMs = Number(process.env.TRANSLATION_DEADLINE_MS || MAX_TRANSLATION_DURATION_MS);
    const deadlineSignal = AbortSignal.timeout(Math.max(1_000, Math.min(deadlineMs, MAX_TRANSLATION_DURATION_MS)));
    try {
      const requestTranslation = async (q) => {
        const body = selectedProvider === "google"
          ? { q, target: providerTarget, ...(providerSource ? { source: providerSource } : {}) }
          : { q, target: providerTarget, ...(providerSource ? { source: providerSource } : {}), ...(apiKey ? { api_key: apiKey } : {}) };
        const upstreamUrl = new URL(translationUrl);
        if (selectedProvider === "google") {
          upstreamUrl.searchParams.set("key", apiKey);
        }
        const response = await fetchWithTimeout(upstreamUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }, MAX_TRANSLATION_CALL_MS, deadlineSignal);
        if (!response.ok) {
          if (response.status === 429) throw new UpstreamError(429, "translation_quota_exceeded");
          if (response.status === 400 || response.status === 404) throw new UpstreamError(502, "translation_model_unavailable");
          if (response.status === 401 || response.status === 403) throw new UpstreamError(502, "translation_credentials_rejected");
          throw new UpstreamError(502, "translation_upstream_error");
        }
        let payload;
        try {
          payload = JSON.parse((await readResponseWithLimit(response, 512 * 1024)).toString("utf8"));
        } catch {
          throw new UpstreamError(502, "translation_invalid_response");
        }
        return selectedProvider === "google"
          ? payload?.data?.translations?.map((item) => item.translatedText || "")
          : payload?.translatedText
            ? [payload.translatedText]
            : payload?.translations?.map((item) => item.translatedText || item.text || "");
      };
      if (selectedProvider === GEMINI_PROVIDER) {
        const session = getSession(req);
        const inputSegments = (segments || texts.map((text, index) => ({ id: String(index), text }))).map((segment) => ({ id: String(segment.id), text: segment.text }));
        const upstreamUrl = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(session.cloud.model)}:generateContent`);
        const response = await fetchWithTimeout(upstreamUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: buildGeminiPrompt({ segments: inputSegments, source, target, glossary, contextWindow }) }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
          })
        }, MAX_TRANSLATION_CALL_MS, deadlineSignal);
        if (!response.ok) {
          if (response.status === 429) throw new UpstreamError(429, "translation_quota_exceeded");
          if (response.status === 400 || response.status === 404) throw new UpstreamError(502, "translation_model_unavailable");
          if (response.status === 401 || response.status === 403) throw new UpstreamError(502, "translation_credentials_rejected");
          throw new UpstreamError(502, "translation_upstream_error");
        }
        let payload;
        try {
          payload = JSON.parse((await readResponseWithLimit(response, 512 * 1024)).toString("utf8"));
        } catch {
          throw new UpstreamError(502, "translation_invalid_response");
        }
        let mapped;
        try {
          mapped = parseGeminiResponse(payload, inputSegments.map((segment) => segment.id));
        } catch {
          throw new UpstreamError(502, "translation_invalid_response");
        }
        return res.json({ translated: inputSegments.map((segment) => mapped.find((item) => item.id === segment.id).text), provider: GEMINI_PROVIDER, model: session.cloud.model });
      }
      const batches = selectedProvider === "google" ? [texts] : texts.map((text) => [text]);
      const translated = [];
      for (let index = 0; index < batches.length; index += 4) {
        translated.push(...(await Promise.all(batches.slice(index, index + 4).map(requestTranslation))).flat());
      }
      if (!Array.isArray(translated) || translated.length !== texts.length) {
        return res.status(502).json({ error: "Translation service returned an invalid response." });
      }
      return res.json({ translated });
    } catch (error) {
      if (error instanceof UpstreamError) {
        const message = error.code === "translation_quota_exceeded"
          ? "Cloud translation quota exceeded or billing is not enabled."
          : error.code === "translation_credentials_rejected"
            ? "Gemini rejected the API key or project access."
            : error.code === "translation_model_unavailable"
              ? "The configured Gemini model is unavailable for this API key or region."
              : "Translation service returned an invalid response.";
        return res.status(error.status).json({ error: message });
      }
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        return res.status(504).json({ error: "Translation service timed out." });
      }
      return res.status(502).json({ error: "Translation service unavailable." });
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
      }, 20_000, AbortSignal.timeout(20_000));
      if (!upstream.ok) {
        return res.status(502).json({ error: "TTS service unavailable." });
      }
      let audioBuffer;
      try {
        audioBuffer = await readResponseWithLimit(upstream, MAX_AUDIO_BYTES);
      } catch (error) {
        if (error.message === "upstream_response_too_large") {
          return res.status(502).json({ error: "TTS service returned an oversized response." });
        }
        throw error;
      }
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "audio/mpeg");
      res.setHeader("Content-Length", String(audioBuffer.byteLength));
      return res.send(audioBuffer);
    } catch (error) {
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        return res.status(504).json({ error: "TTS service timed out." });
      }
      return res.status(502).json({ error: "TTS service returned an invalid response." });
    }
  });

  app.get("*", (_req, res) => res.sendFile("index.html", { root: "public" }));
  return app;
};

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "127.0.0.1";
  createApp().listen(port, host, () => console.log(`Real-time image translator server listening at http://${host}:${port}`));
}

module.exports = { createApp, readResponseWithLimit };
