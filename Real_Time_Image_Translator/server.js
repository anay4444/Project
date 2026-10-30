const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.static("public"));

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

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/translate", async (req, res) => {
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GOOGLE_TRANSLATE_API_KEY is not configured." });
  }

  const { texts, target = "en", source } = req.body || {};
  if (!Array.isArray(texts) || texts.length === 0) {
    return res.status(400).json({ error: "texts must be a non-empty array." });
  }

  try {
    const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: texts,
        target,
        ...(source ? { source } : {})
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: payload?.error?.message || "Translation failed." });
    }

    const translated = payload?.data?.translations?.map((item) => item.translatedText || "") || [];
    return res.json({ translated });
  } catch (error) {
    return res.status(500).json({ error: "Translation request failed.", details: error.message });
  }
});

app.post("/api/tts", async (req, res) => {
  const kokoroUrl = process.env.KOKORO_TTS_URL;
  if (!kokoroUrl) {
    return res.status(500).json({ error: "KOKORO_TTS_URL is not configured." });
  }

  const { text, voice = "af_heart", speed = 1 } = req.body || {};
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "text is required." });
  }

  try {
    const upstream = await fetch(kokoroUrl, {
      method: "POST",
      headers: buildKokoroHeaders(),
      body: JSON.stringify({ text, voice, speed })
    });

    if (!upstream.ok) {
      const message = await upstream.text();
      return res.status(upstream.status).json({ error: "Kokoro TTS request failed.", details: message.slice(0, 800) });
    }

    const contentType = upstream.headers.get("content-type") || "audio/mpeg";
    const audioBuffer = Buffer.from(await upstream.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(audioBuffer.byteLength));
    return res.send(audioBuffer);
  } catch (error) {
    return res.status(500).json({ error: "TTS request failed.", details: error.message });
  }
});

app.get("*", (_req, res) => {
  res.sendFile("index.html", { root: "public" });
});

app.listen(port, () => {
  console.log(`Real-time image translator server listening at http://localhost:${port}`);
});
