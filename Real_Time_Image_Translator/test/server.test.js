const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createApp } = require("../server");

const serialTest = (name, fn) => test(name, { concurrency: false }, fn);

const request = (server, path, body, headers = {}) =>
  new Promise((resolve, reject) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const req = http.request({
      port: server.address().port,
      path,
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? headers : { ...headers, "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end(payload);
  });

serialTest("health and translation work with a LibreTranslate-style response", async (t) => {
  const originalFetch = global.fetch;
  process.env.TRANSLATION_URL = "http://translation.test/translate";
  process.env.TRANSLATION_PROVIDER = "libretranslate";
  const calls = [];
  global.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ translatedText: "hola" }), { status: 200 });
  };
  const server = createApp().listen(0);
  t.after(() => {
    server.close();
    global.fetch = originalFetch;
  });

  serialTest("rejects languages outside the allowlist", async (t) => {
    const server = createApp().listen(0);
    t.after(() => server.close());
    assert.equal((await request(server, "/api/translate", { texts: ["sample"], source: "fr", target: "en" })).status, 400);
    assert.equal((await request(server, "/api/translate", { texts: ["sample"], source: "en", target: "de" })).status, 400);
  });

  assert.equal((await request(server, "/api/health")).status, 200);
  const result = await request(server, "/api/translate", { texts: ["hello"], source: "en", target: "es" });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { translated: ["hola"] });
  for (const [source, target] of [["ja", "en"], ["ko", "zh"], ["zh", "hi"], ["it", "ja"], ["hi", "ko"], ["es", "it"]]) {
    assert.equal((await request(server, "/api/translate", { texts: ["sample"], source, target })).status, 200);
  }
  assert.deepEqual(calls.map((body) => [body.source, body.target]), [["en", "es"], ["ja", "en"], ["ko", "zh"], ["zh", "hi"], ["it", "ja"], ["hi", "ko"], ["es", "it"]]);
});

serialTest("rejects oversized translation input before contacting upstream", async (t) => {
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

serialTest("returns a generic upstream error without leaking details", async (t) => {
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
  assert.equal(result.status, 502);
  assert.doesNotMatch(result.body.toString(), /private upstream detail/);
});

serialTest("rejects invalid TTS values", async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  process.env.KOKORO_TTS_URL = "http://tts.test";

  const result = await request(server, "/api/tts", { text: "hello", voice: "bad voice", speed: 9 });
  assert.equal(result.status, 400);
});

serialTest("rejects an oversized TTS response", async (t) => {
  const originalFetch = global.fetch;
  process.env.KOKORO_TTS_URL = "http://tts.test";
  global.fetch = async () => new Response(new Uint8Array(8 * 1024 * 1024 + 1), { status: 200, headers: { "content-type": "audio/mpeg" } });
  const server = createApp().listen(0);
  t.after(() => {
    server.close();
    global.fetch = originalFetch;
  });

  const result = await request(server, "/api/tts", { text: "hello" });
  assert.equal(result.status, 502);
});

serialTest("caps concurrent translation requests", async (t) => {
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

serialTest("requires a session when deployment authentication is enabled", async (t) => {
  const previousPassword = process.env.TRANSLATOR_ACCESS_PASSWORD;
  process.env.TRANSLATOR_ACCESS_PASSWORD = "correct horse";
  process.env.TRANSLATION_URL = "http://translation.test/translate";
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ translatedText: "hola" }), { status: 200 });
  const server = createApp().listen(0);
  t.after(() => {
    server.close();
    global.fetch = originalFetch;
    if (previousPassword === undefined) delete process.env.TRANSLATOR_ACCESS_PASSWORD;
    else process.env.TRANSLATOR_ACCESS_PASSWORD = previousPassword;
  });

  assert.equal((await request(server, "/api/translate", { texts: ["hello"] })).status, 401);
  const login = await request(server, "/api/login", { password: "correct horse" });
  assert.equal(login.status, 200);
  const cookie = login.headers?.["set-cookie"]?.[0];
  assert.ok(cookie);
  const authorized = await request(server, "/api/translate", { texts: ["hello"] }, { cookie });
  assert.equal(authorized.status, 200);
});

serialTest("rejects unsupported providers and missing Google credentials", async (t) => {
  const originalFetch = global.fetch;
  const previousProvider = process.env.TRANSLATION_PROVIDER;
  const previousKey = process.env.TRANSLATION_API_KEY;
  process.env.TRANSLATION_PROVIDER = "unknown";
  process.env.TRANSLATION_URL = "http://translation.test/translate";
  const server = createApp().listen(0);
  t.after(() => {
    server.close();
    global.fetch = originalFetch;
    if (previousProvider === undefined) delete process.env.TRANSLATION_PROVIDER;
    else process.env.TRANSLATION_PROVIDER = previousProvider;
    if (previousKey === undefined) delete process.env.TRANSLATION_API_KEY;
    else process.env.TRANSLATION_API_KEY = previousKey;
  });

  assert.equal((await request(server, "/api/translate", { texts: ["hello"] })).status, 503);
  process.env.TRANSLATION_PROVIDER = "google";
  delete process.env.TRANSLATION_API_KEY;
  assert.equal((await request(server, "/api/translate", { texts: ["hello"] })).status, 503);
  process.env.TRANSLATION_API_KEY = "server-only-key";
  let calledUrl;
  global.fetch = async (url) => {
    calledUrl = String(url);
    return new Response(JSON.stringify({ data: { translations: [{ translatedText: "hola" }] } }), { status: 200 });
  };
  assert.equal((await request(server, "/api/translate", { texts: ["hello"] })).status, 200);
  assert.match(calledUrl, /[?&]key=server-only-key/);
});

serialTest("returns 502 for malformed or non-success upstream responses", async (t) => {
  const originalFetch = global.fetch;
  process.env.TRANSLATION_PROVIDER = "libretranslate";
  process.env.TRANSLATION_URL = "http://translation.test/translate";
  const server = createApp().listen(0);
  t.after(() => {
    server.close();
    global.fetch = originalFetch;
  });

  global.fetch = async () => new Response("not json", { status: 200 });
  assert.equal((await request(server, "/api/translate", { texts: ["hello"] })).status, 502);
  global.fetch = async () => new Response("upstream failure", { status: 500 });
  assert.equal((await request(server, "/api/translate", { texts: ["hello"] })).status, 502);
});

serialTest("returns 504 when the overall translation deadline aborts work", async (t) => {
  const originalFetch = global.fetch;
  const previousDeadline = process.env.TRANSLATION_DEADLINE_MS;
  process.env.TRANSLATION_PROVIDER = "libretranslate";
  process.env.TRANSLATION_URL = "http://translation.test/translate";
  process.env.TRANSLATION_DEADLINE_MS = "1000";
  global.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("deadline", "TimeoutError")), { once: true });
  });
  const server = createApp().listen(0);
  t.after(() => {
    server.close();
    global.fetch = originalFetch;
    if (previousDeadline === undefined) delete process.env.TRANSLATION_DEADLINE_MS;
    else process.env.TRANSLATION_DEADLINE_MS = previousDeadline;
  });

  const result = await request(server, "/api/translate", { texts: ["hello"] });
  assert.equal(result.status, 504);
});
