# Real-Time Image Translator (Same Page)

This app translates text from an image in real time and draws translated text on top of the original image **without replacing or editing the image itself**.

It is designed for reading comics, manga, or any foreign-language image content in the same tab/page.

## Features

- OCR text detection from uploaded image or image URL (Tesseract.js)
- Configurable translation through a local LibreTranslate-compatible server
- Overlay translation rendered in original text regions
- Floating controls (overlay, language, confidence, reading order, voice, speed)
- Hotkeys for quick use while reading
- Optional read-aloud pipeline through Kokoro TTS endpoint
- Bounded eight-entry LRU caching to avoid repeated OCR/translation for same image + settings

## Architecture

- **Frontend (`public/`)**
  - Loads image
  - Runs OCR in browser
  - Calls backend `/api/translate`
  - Renders overlay boxes on same image
  - Calls backend `/api/tts` for read aloud

- **Backend (`server.js`)**
  - Serves frontend
  - Proxies a LibreTranslate-compatible or Google Translation v2 endpoint
  - Proxies Kokoro TTS requests
  - Keeps API keys off frontend

## Setup

1. Open terminal in:
   `/home/runner/work/Project/Project/Real_Time_Image_Translator`
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create env file:
   ```bash
   cp .env.example .env
   ```
4. Edit `.env` for the recommended local configuration:
   - `TRANSLATION_PROVIDER=libretranslate`
   - `TRANSLATION_URL=http://127.0.0.1:5000/translate`
   - Install/run LibreTranslate locally and download only the language pairs you need.
   - Set `TRANSLATION_API_KEY` only when your translation server requires it.
   - `KOKORO_TTS_URL`: your Kokoro TTS HTTP endpoint URL
   - Optional auth headers:
     - `KOKORO_TTS_BEARER_TOKEN`
     - `KOKORO_TTS_EXTRA_HEADERS` (JSON string)
     - `TRANSLATOR_ACCESS_PASSWORD`: optional deployment password. The browser signs in through `/api/login` and receives an HttpOnly, SameSite session cookie; no shared secret is placed in frontend code.
5. Start server:
   ```bash
   npm start
   ```
6. Open:
   `http://localhost:3000`

The server binds to `127.0.0.1` by default, which is the intended private/local mode. Set `HOST` only when a carefully configured reverse proxy or private network should expose it. When `TRANSLATOR_ACCESS_PASSWORD` is set, the page displays a sign-in form and uses an HttpOnly session cookie; do not put that password or an API token in frontend configuration. Use HTTPS at the proxy in deployment.

## Hotkeys

- `Ctrl + Shift + T`: Toggle overlay
- `Ctrl + Shift + R`: Translate now
- `Ctrl + Shift + P`: Play/Pause read-aloud

## Config options

- Source language (`auto` by default)
- Target language (`en` default)
- Confidence threshold (0-100)
- Reading order: LTR or manga/comics-friendly RTL
- Voice + speed for TTS
- Auto-refresh translation when image changes
- Auto-play translated text

## Reliability & Limits

- OCR quality depends on image clarity/font/stylization.
- URL images are downloaded with a CORS-enabled browser request before display. The response is streamed and capped at 15 MB, then pixel dimensions are checked before OCR. Hosts that do not grant CORS cannot be safely size-checked by this browser app and are rejected; upload the image instead. The remote URL is still disclosed to its host.
- Low-confidence text is visually marked.
- If no text found or API fails, app keeps running and reports status.
- API key should stay on backend only (never in frontend code).
- Translation and TTS have separate rate limits, bounded request sizes, upstream timeouts, response-size limits, and generic upstream errors.
- The browser groups OCR words into lines before translation, preserves selected LTR/RTL reading order, and exposes editable OCR and translation text.
- Translation has both per-upstream-call and overall request deadlines. Invalid or oversized upstream responses return a bounded 502 response; timeouts return 504.
- TTS follows the same distinction: invalid, non-success, or oversized upstream responses return 502; actual upstream timeouts return 504.
- Browser uploads are limited to 15 MB, 10,000 pixels per dimension, and 40 million pixels. The result cache is an eight-entry LRU and stale OCR/translation work is cancelled or ignored.
- Rate limits and concurrency counters are in-memory and per Node process. For multiple replicas, use a shared rate-limit store and enforce limits at the reverse proxy. Do not enable Express's `trust proxy` unless it is configured for the exact trusted proxy hops; otherwise client IPs must not be taken from forwarded headers.

## Recommended free architecture and trade-offs

The default setup keeps OCR in the browser and sends only grouped text to a self-hosted LibreTranslate-compatible service. This avoids sending images to a third party and avoids per-request API charges, but it requires a machine with enough RAM/CPU (language models commonly need hundreds of MB to multiple GB) and quality varies by language pair. Argos Translate is a good fully local alternative, usually lighter for selected offline language pairs but with narrower coverage and less fluent output. LibreTranslate is simpler to expose as a local HTTP service and can support more pairs when its models are installed. These engines are statistical/neural model packages, not general reasoning systems: idioms, names, manga panel context, honorifics, and ambiguous pronouns may remain wrong and should be corrected in the editor.

Google Cloud Translation can still be used by setting `TRANSLATION_PROVIDER=google`, `TRANSLATION_URL=https://translation.googleapis.com/language/translate/v2`, and `TRANSLATION_API_KEY` on the server. The server appends the key to the upstream request and never sends it to the browser. This option introduces billing, quota, and external data-flow/privacy considerations and is not the default. No translation engine is unlimited or cost-free: self-hosting shifts cost to hardware, electricity, model storage, and maintenance. Keep the service bound to localhost for private use. If deployed, set `TRANSLATOR_ACCESS_PASSWORD`, use HTTPS, and put the app behind a reverse proxy with network access controls.

OCR remains local in the browser, which protects image pixels from the translation service but uses client CPU and memory. Tesseract's browser script, worker, and WASM core are served locally under `public/tesseract/`; language data is fetched only from the pinned `tessdata.projectnaptha.com` origin allowed by CSP. This keeps executable OCR assets local while avoiding a large repository copy of language models. Image URLs are loaded by the browser and may still reveal the URL to the image host; uploaded image pixels stay in the browser, while grouped OCR text is sent to the configured translation service.

Sessions are intentionally stored only in the Node process memory. They are cleared whenever the process restarts and are not shared across multiple app instances. For deployment, use one instance behind HTTPS and a reverse proxy, or replace the in-memory session map with a shared, authenticated session store before running multiple replicas. Do not expose the app directly to the public internet with the default in-memory setup.

## Optional improvements

- Better OCR model/language packs
- Region grouping (speech-bubble level instead of word level)
- Batch prefetching next pages
- Browser extension wrapper for direct in-page comics/image site integration
