const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createApp } = require("../server");

const request = (server, path, body) =>
  new Promise((resolve, reject) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const req = http.request({
      port: server.address().port,
      path,
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end(payload);
  });

test("health and translation work with a LibreTranslate-style response", async (t) => {
  const originalFetch = global.fetch;
  process.env.TRANSLATION_URL = "http://translation.test/translate";
  process.env.TRANSLATION_PROVIDER = "libretranslate";
  global.fetch = async () => new Response(JSON.stringify({ translatedText: "hola" }), { status: 200 });
  const server = createApp().listen(0);
  t.after(() => {
    server.close();
    global.fetch = originalFetch;
  });

  assert.equal((await request(server, "/api/health")).status, 200);
  const result = await request(server, "/api/translate", { texts: ["hello"], source: "en", target: "es" });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { translated: ["hola"] });
});

test("rejects oversized translation input before contacting upstream", async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("should not be called");
  };
  const server = createApp().listen(0);
  t.after(() => {
    server.close();
    global.fetch = originalFetch;
  });

  const result = await request(server, "/api/translate", { texts: ["x".repeat(2_001)] });
  assert.equal(result.status, 400);
});

test("returns a generic timeout error for translation failures", async (t) => {
  const originalFetch = global.fetch;
  process.env.TRANSLATION_URL = "http://translation.test/translate";
  global.fetch = async () => {
    throw new Error("private upstream detail");
  };
  const server = createApp().listen(0);
  t.after(() => {
    server.close();
    global.fetch = originalFetch;
  });

  const result = await request(server, "/api/translate", { texts: ["hello"] });
  assert.equal(result.status, 504);
  assert.doesNotMatch(result.body.toString(), /private upstream detail/);
});

test("rejects invalid TTS values", async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  process.env.KOKORO_TTS_URL = "http://tts.test";

  const result = await request(server, "/api/tts", { text: "hello", voice: "bad voice", speed: 9 });
  assert.equal(result.status, 400);
});

test("rejects an oversized TTS response", async (t) => {
  const originalFetch = global.fetch;
  process.env.KOKORO_TTS_URL = "http://tts.test";
  global.fetch = async () => new Response(new Uint8Array(8 * 1024 * 1024 + 1), { status: 200, headers: { "content-type": "audio/mpeg" } });
  const server = createApp().listen(0);
  t.after(() => {
    server.close();
    global.fetch = originalFetch;
  });

  const result = await request(server, "/api/tts", { text: "hello" });
  assert.equal(result.status, 504);
});

test("caps concurrent translation requests", async (t) => {
  const originalFetch = global.fetch;
  process.env.TRANSLATION_URL = "http://translation.test/translate";
  global.fetch = async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return new Response(JSON.stringify({ translatedText: "hola" }), { status: 200 });
  };
  const server = createApp().listen(0);
  t.after(() => {
    server.close();
    global.fetch = originalFetch;
  });

  const results = await Promise.all(Array.from({ length: 5 }, () => request(server, "/api/translate", { texts: ["hello"] })));
  assert.equal(results.filter((result) => result.status === 429).length, 1);
});
