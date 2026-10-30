# Real-Time Image Translator (Same Page)

This app translates text from an image in real time and draws translated text on top of the original image **without replacing or editing the image itself**.

It is designed for reading comics, manga, or any foreign-language image content in the same tab/page.

## Features

- OCR text detection from uploaded image or image URL (Tesseract.js)
- Google Cloud Translation via backend proxy endpoint
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
  - Proxies Google Translate API requests
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
4. Edit `.env`:
   - `GOOGLE_TRANSLATE_API_KEY`: your Google Cloud Translate key
   - `KOKORO_TTS_URL`: your Kokoro TTS HTTP endpoint URL
   - Optional auth headers:
     - `KOKORO_TTS_BEARER_TOKEN`
     - `KOKORO_TTS_EXTRA_HEADERS` (JSON string)
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

## Optional improvements

- Better OCR model/language packs
- Region grouping (speech-bubble level instead of word level)
- Batch prefetching next pages
- Browser extension wrapper for direct in-page comics/image site integration
