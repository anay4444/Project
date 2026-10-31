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
- Basic caching to avoid repeated OCR/translation for same image + settings

## Architecture

- **Frontend (`public/`)**
  - Loads image
  - Runs OCR in browser
  - Calls backend `/api/translate`
  - Renders overlay boxes on same image
  - Calls backend `/api/tts` for read aloud

- **Backend (`server.js`)**
  - Serves frontend
  - Proxies a LibreTranslate-compatible or Google translation endpoint
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
     - `TRANSLATOR_API_TOKEN`: optional bearer token for protecting translation and TTS endpoints when deployed beyond localhost.
5. Start server:
   ```bash
   npm start
   ```
6. Open:
   `http://localhost:3000`

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
- Some sites block cross-origin image loads; upload file if URL load fails.
- Low-confidence text is visually marked.
- If no text found or API fails, app keeps running and reports status.
- API key should stay on backend only (never in frontend code).
- Translation and TTS have separate rate limits, bounded request sizes, upstream timeouts, response-size limits, and generic upstream errors.
- The browser groups OCR words into lines before translation, preserves selected LTR/RTL reading order, and exposes editable OCR and translation text.

## Recommended free architecture and trade-offs

The default setup keeps OCR in the browser and sends only grouped text to a self-hosted LibreTranslate-compatible service. This avoids sending images to a third party and avoids per-request API charges, but it requires a machine with enough RAM/CPU (language models commonly need hundreds of MB to multiple GB) and quality varies by language pair. Argos Translate is a good fully local alternative, usually lighter for selected offline language pairs but with narrower coverage and less fluent output. LibreTranslate is simpler to expose as a local HTTP service and can support more pairs when its models are installed.

Google Cloud Translation can still be used by setting `TRANSLATION_PROVIDER=google`, `TRANSLATION_URL` to the Google endpoint, and the appropriate server-side credential, but it introduces billing, quota, and external data-flow/privacy considerations. No translation engine is unlimited or cost-free: self-hosting shifts cost to hardware, electricity, model storage, and maintenance. Keep the service bound to localhost for private use; if deployed, set `TRANSLATOR_API_TOKEN`, use HTTPS, and apply network-level access controls.

OCR remains local in the browser, which protects image pixels from the translation service but uses client CPU and memory. The pinned Tesseract.js CDN URL should be vendored or protected with Subresource Integrity before a high-assurance deployment.

## Optional improvements

- Better OCR model/language packs
- Region grouping (speech-bubble level instead of word level)
- Batch prefetching next pages
- Browser extension wrapper for direct in-page comics/image site integration
