# Real-Time Image Translator (Same Page)

This app translates text from an image in real time and draws translated text on top of the original image **without replacing or editing the image itself**.

It is designed for reading comics, manga, or any foreign-language image content in the same tab/page.

## Features

- OCR text detection from uploaded image or image URL (Tesseract.js)
- Configurable translation through a local LibreTranslate-compatible server
- Optional, explicit Gemini cloud translation using a user-provided API key
- Seven-language controls: English, Spanish, Italian, Hindi, Japanese, Korean, and Simplified Chinese
- Browser-side `.txt`, `.xlsx`, and `.docx` import and translated-copy export
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
  - Proxies a LibreTranslate-compatible, Google Translation v2, or opt-in Gemini endpoint
  - Proxies Kokoro TTS requests
  - Keeps configured and session provider keys out of frontend responses and logs

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
   - Leave `TRANSLATION_PROVIDER=libretranslate` for the free/local default. `GEMINI_MODEL` defaults to `gemini-2.5-flash-lite`, a current Gemini text-model choice intended for low-cost/free-tier use where Google makes it available; it only selects the model used after a user explicitly connects Gemini in the browser. Confirm current model availability, region, quota, and billing requirements in Google's documentation before deployment.
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
- Supported languages: English (`en`), Spanish (`es`), Italian (`it`), Hindi (`hi`), Japanese (`ja`), Korean (`ko`), and Chinese (`zh`, Simplified Chinese)
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
- Cloud translation is never selected silently. Choose **Gemini cloud** and connect with your own Gemini API key to opt in. The key is sent over the app connection, stored only in the Node process memory for that session, is never written to local storage, source, analytics, or logs, and is cleared on disconnect or process restart. Use HTTPS and an access password when deployed.
- The Gemini API key is not a ChatGPT password, cookie, or session token. Do not paste any of those into this app. ChatGPT subscriptions and API billing are separate; this app does not share or automate a ChatGPT consumer session.
- Gemini account quotas, free-tier eligibility, regional availability, retention/data-use terms, and possible charges are controlled by Google and can change. The app reports quota exhaustion and does not fall back to a paid or cloud route automatically.
- Translation and TTS have separate rate limits, bounded request sizes, upstream timeouts, response-size limits, and generic upstream errors.
- The browser groups OCR words into lines before translation, preserves selected LTR/RTL reading order, and exposes editable OCR and translation text.
- Translation requests can include nearby segment context and an editable glossary. Gemini responses are required to contain exactly one structured result per segment, so malformed or incomplete responses are rejected without changing the original file/image results.
- Context improves consistency but cannot guarantee the correct joke, idiom, sarcasm, omitted subject, cultural reference, name, or honorific. Review important translations, preferably with a fluent speaker.
- Translation has both per-upstream-call and overall request deadlines. Invalid or oversized upstream responses return a bounded 502 response; timeouts return 504.
- TTS follows the same distinction: invalid, non-success, or oversized upstream responses return 502; actual upstream timeouts return 504.
- Browser uploads are limited to 15 MB, 10,000 pixels per dimension, and 40 million pixels. The result cache is an eight-entry LRU and stale OCR/translation work is cancelled or ignored.
- Document uploads are limited to 15 MB, 100,000 extracted characters, 5,000 eligible XLSX text cells, and 80 MB decompressed ZIP content. Only `.txt`, `.xlsx`, and `.docx` are accepted; macro-enabled and legacy formats are rejected. Numbers, formulas, blank cells, and original files are not overwritten.
- Rate limits and concurrency counters are in-memory and per Node process. For multiple replicas, use a shared rate-limit store and enforce limits at the reverse proxy. Do not enable Express's `trust proxy` unless it is configured for the exact trusted proxy hops; otherwise client IPs must not be taken from forwarded headers.

## Recommended free architecture and trade-offs

The default setup keeps OCR in the browser and sends only grouped text to a self-hosted LibreTranslate-compatible service. This avoids sending images to a third party and avoids per-request API charges, but it requires a machine with enough RAM/CPU (language models commonly need hundreds of MB to multiple GB) and quality varies by language pair. Argos Translate is a good fully local alternative, usually lighter for selected offline language pairs but with narrower coverage and less fluent output. LibreTranslate is simpler to expose as a local HTTP service and can support more pairs when its models are installed. These engines are statistical/neural model packages, not general reasoning systems: idioms, names, manga panel context, honorifics, and ambiguous pronouns may remain wrong and should be corrected in the editor.

### Cloud provider comparison

| Option | Account/setup | Context and language behavior | Cost/data trade-off |
|---|---|---|---|
| Local LibreTranslate-compatible service | Install models locally; no cloud account | Seven UI languages only when the selected model pairs are installed; useful line/paragraph batching but limited idiom and dialogue reasoning | No provider charge, but CPU/RAM/storage/electricity and maintenance are real costs. OCR text stays on the local setup. |
| Gemini API key (implemented, opt-in) | Create a Gemini API key in Google AI Studio or an eligible Google Cloud project; paste it only into the session connect control | Prompted contextual translation with structured segment IDs and glossary; the default `gemini-2.5-flash-lite` is selected for low latency/cost, but support and quality depend on the model and language pair | Free quotas, billing, regional availability, and data-use terms vary. Extracted text, context, and glossary are sent to Google; image pixels and full archives are not. |
| Google Cloud Translation API (existing server route) | Configure a project, credentials, quota, and billing; set server environment variables | Translation-focused and predictable, but less suitable for cross-segment tone/honorific context | Usage is quota/billing controlled and text leaves the local service. It remains server-configured, not a browser credential flow. |
| ChatGPT subscription / consumer sign-in | Not an eligible integration for this app | A ChatGPT subscription does not grant general API access, and this app does not automate ChatGPT websites or private endpoints | No supported subscription-sharing path is assumed. Use an official API product and its separate billing/account terms instead. |

Official references: [Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key), [Gemini billing and quotas](https://ai.google.dev/gemini-api/docs/billing), [Gemini data use](https://ai.google.dev/gemini-api/docs/data-use), [OpenAI API access](https://help.openai.com/en/articles/7102672-how-can-i-access-the-openai-api), and [Google Cloud Translation pricing](https://cloud.google.com/translate/pricing). Provider policies and limits can change; consult the current documentation before connecting an account. This project does not claim that any cloud free tier is permanent or unlimited.

Google Cloud Translation can still be used by setting `TRANSLATION_PROVIDER=google`, `TRANSLATION_URL=https://translation.googleapis.com/language/translate/v2`, and `TRANSLATION_API_KEY` on the server. The server appends the key to the upstream request and never sends it to the browser. This option introduces billing, quota, and external data-flow/privacy considerations and is not the default. No translation engine is unlimited or cost-free: self-hosting shifts cost to hardware, electricity, model storage, and maintenance. Keep the service bound to localhost for private use. If deployed, set `TRANSLATOR_ACCESS_PASSWORD`, use HTTPS, and put the app behind a reverse proxy with network access controls.

OCR remains local in the browser, which protects image pixels from the translation service but uses client CPU and memory. Tesseract's browser script, worker, and WASM core are served locally under `public/tesseract/`; language data is fetched only from the pinned `tessdata.projectnaptha.com` origin allowed by CSP. This keeps executable OCR assets local while avoiding a large repository copy of language models. Image URLs are loaded by the browser and may still reveal the URL to the image host; uploaded image pixels stay in the browser, while grouped OCR text is sent to the configured translation service.

Document parsing and export happen in the browser using the app's bounded XLSX XML reader/writer and JSZip. DOCX text is extracted directly from the document XML; only extracted text cells or paragraphs are sent to the configured translation service. XLSX worksheet names, positions, formulas, numbers, and blank cells represented in the workbook XML are preserved. Complex XLSX styles, charts, external links, and unsupported workbook features are not reconstructed; DOCX paragraph order is preserved but complex styles, headers/footers, tracked changes, embedded objects, and table formatting are simplified. Macros and external links are never executed.

The previously vendored SheetJS `xlsx@0.18.5` parser was removed because current dependency advisories cover prototype pollution and ReDoS and the npm package has no patched release. The replacement intentionally supports only the bounded workbook subset needed by this app and is covered by malformed-workbook, worksheet-limit, formula, number, blank-cell, and round-trip tests. Keep the archive, worksheet, cell, and text limits in place.

Chinese UI selection uses Simplified Chinese (`zh`/`chi_sim`). Traditional Chinese OCR (`chi_tra`) is available in the internal mapping for future use, but is not exposed as a separate UI language. Translation quality and model-pair availability depend on the locally installed LibreTranslate-compatible models; the app reports provider failures rather than silently changing language or sending the original document elsewhere.

Sessions are intentionally stored only in the Node process memory. They are cleared whenever the process restarts and are not shared across multiple app instances. For deployment, use one instance behind HTTPS and a reverse proxy, or replace the in-memory session map with a shared, authenticated session store before running multiple replicas. Do not expose the app directly to the public internet with the default in-memory setup.

## Optional improvements

- Better OCR model/language packs
- Region grouping (speech-bubble level instead of word level)
- Batch prefetching next pages
- Browser extension wrapper for direct in-page comics/image site integration
