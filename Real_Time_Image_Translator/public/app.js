const els = {
  fileInput: document.getElementById("fileInput"),
  imageUrlInput: document.getElementById("imageUrlInput"),
  loadUrlBtn: document.getElementById("loadUrlBtn"),
  sourceImage: document.getElementById("sourceImage"),
  overlayLayer: document.getElementById("overlayLayer"),
  overlayToggle: document.getElementById("overlayToggle"),
  showOriginalToggle: document.getElementById("showOriginalToggle"),
  autoRefreshToggle: document.getElementById("autoRefreshToggle"),
  sourceLang: document.getElementById("sourceLang"),
  targetLang: document.getElementById("targetLang"),
  providerSelect: document.getElementById("providerSelect"),
  cloudProviderControls: document.getElementById("cloudProviderControls"),
  geminiKeyInput: document.getElementById("geminiKeyInput"),
  connectGeminiBtn: document.getElementById("connectGeminiBtn"),
  disconnectProviderBtn: document.getElementById("disconnectProviderBtn"),
  providerStatus: document.getElementById("providerStatus"),
  contextWindow: document.getElementById("contextWindow"),
  glossaryInput: document.getElementById("glossaryInput"),
  minConfidence: document.getElementById("minConfidence"),
  readingOrder: document.getElementById("readingOrder"),
  voiceInput: document.getElementById("voiceInput"),
  speedInput: document.getElementById("speedInput"),
  autoPlayToggle: document.getElementById("autoPlayToggle"),
  loginForm: document.getElementById("loginForm"),
  passwordInput: document.getElementById("passwordInput"),
  documentInput: document.getElementById("documentInput"),
  translateDocumentBtn: document.getElementById("translateDocumentBtn"),
  exportTxtBtn: document.getElementById("exportTxtBtn"),
  exportXlsxBtn: document.getElementById("exportXlsxBtn"),
  exportDocxBtn: document.getElementById("exportDocxBtn"),
  exportImageTxtBtn: document.getElementById("exportImageTxtBtn"),
  exportImageXlsxBtn: document.getElementById("exportImageXlsxBtn"),
  exportImageDocxBtn: document.getElementById("exportImageDocxBtn"),
  translateBtn: document.getElementById("translateBtn"),
  playBtn: document.getElementById("playBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  stopBtn: document.getElementById("stopBtn"),
  nextBtn: document.getElementById("nextBtn"),
  statusText: document.getElementById("statusText"),
  regionEditor: document.getElementById("regionEditor")
};

let translatedRegions = [];
let audioQueue = [];
let currentAudio = null;
let queueIndex = 0;
let translationRun = 0;
let translationInFlight = false;
let translationController = null;
let imageObjectUrl = null;

const resultCache = createLruCache(8);
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TEXTS = 60;
const MAX_DOCUMENT_TEXT = 100_000;
const MAX_DOCUMENT_CELLS = 5_000;
const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024;
let documentState = null;
let documentController = null;

const languageCodes = Object.keys(LANGUAGES).filter((code) => code !== "zh-TW");
const languageOptions = (select, includeAuto) => {
  if (includeAuto) {
    select.append(new Option("Auto-detect (seven languages only)", "auto"));
  }
  languageCodes.forEach((code) => select.append(new Option(LANGUAGES[code].label, code)));
};
languageOptions(els.sourceLang, true);
languageOptions(els.targetLang, false);
els.sourceLang.value = "auto";
els.targetLang.value = "en";
const imageObserver = new MutationObserver(() => {
  if (els.autoRefreshToggle.checked && els.sourceImage.src) {
    setTimeout(() => {
      if (!translationInFlight) {
        translateImage().catch((error) => setStatus(error.message, true));
      }
    }, 0);
  }
});

const loadImage = (src, size) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const error = validateImageInfo({ size, width: image.naturalWidth, height: image.naturalHeight });
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve();
    };
    image.onerror = () => reject(new Error("Image could not be loaded."));
    image.src = src;
  });

const cancelTranslation = () => {
  translationRun += 1;
  translationController?.abort();
  translationController = null;
  translationInFlight = false;
};

const setImageSource = async (src, size) => {
  cancelTranslation();
  await loadImage(src, size);
  els.sourceImage.src = src;
};

const loadRemoteImage = async (url) => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    mode: "cors"
  });
  if (!response.ok) {
    throw new Error("Remote image could not be downloaded.");
  }
  const blob = await validateImageInfo.readResponseBlobWithLimit(response);
  const objectUrl = URL.createObjectURL(blob);
  try {
    await loadImage(objectUrl, blob.size);
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
  return { objectUrl, size: blob.size };
};

imageObserver.observe(els.sourceImage, { attributes: true, attributeFilter: ["src"] });

const setStatus = (message, isError = false) => {
  els.statusText.textContent = `Status: ${message}`;
  els.statusText.style.color = isError ? "#ff8888" : "#f1f1f1";
};

const checkSession = async () => {
  const response = await fetch("/api/session");
  const payload = await response.json();
  els.loginForm.hidden = !payload.required || payload.authenticated;
  if (payload.required && !payload.authenticated) {
    setStatus("Sign in to use translation and read-aloud.");
  }
};

const htmlDecode = (input) => {
  const parser = new DOMParser();
  return parser.parseFromString(input, "text/html").documentElement.textContent || "";
};

const toSafeImageUrl = (value) => {
  try {
    const parsed = new URL(value);
    const allowedProtocols = new Set(["http:", "https:"]);
    if (!allowedProtocols.has(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const getImageCacheKey = () => {
  const src = els.sourceImage.currentSrc || els.sourceImage.src || "";
  const minConfidence = Number(els.minConfidence.value) || 0;
  const source = els.sourceLang.value.trim() || "auto";
  const target = els.targetLang.value.trim() || "en";
  const order = els.readingOrder.value;
  return `${src}::${minConfidence}::${source}::${target}::${order}`;
};

const sortByReadingOrder = (regions, order) => {
  const sorted = [...regions].sort((a, b) => {
    const yDiff = a.bbox.y0 - b.bbox.y0;
    if (Math.abs(yDiff) > 12) {
      return yDiff;
    }

    if (order === "rtl") {
      return b.bbox.x0 - a.bbox.x0;
    }

    return a.bbox.x0 - b.bbox.x0;
  });

  return sorted;
};

const renderOverlay = (regions) => {
  els.overlayLayer.innerHTML = "";

  if (!els.overlayToggle.checked) {
    return;
  }

  for (const region of regions) {
    const box = document.createElement("div");
    box.className = `overlay-box${region.confidence < 70 ? " low-confidence" : ""}`;

    const width = Math.max(24, region.bbox.x1 - region.bbox.x0);
    const height = Math.max(18, region.bbox.y1 - region.bbox.y0);
    const fontSize = Math.max(10, Math.min(24, Math.floor(height * 0.35)));

    box.style.left = `${region.bbox.x0}px`;
    box.style.top = `${region.bbox.y0}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
    box.style.fontSize = `${fontSize}px`;
    box.textContent = region.translatedText || region.sourceText;

    els.overlayLayer.appendChild(box);
  }
};

const renderRegionEditor = (regions) => {
  els.regionEditor.innerHTML = "";
  regions.forEach((region, index) => {
    const item = document.createElement("details");
    item.className = "region-editor-item";
    item.open = true;
    const summary = document.createElement("summary");
    summary.textContent = `Region ${index + 1}`;
    item.appendChild(summary);
    for (const [field, labelText] of [["sourceText", "Original OCR"], ["translatedText", "Translation"]]) {
      const label = document.createElement("label");
      label.textContent = labelText;
      const textarea = document.createElement("textarea");
      textarea.dataset.region = String(index);
      textarea.dataset.field = field;
      textarea.value = region[field];
      label.appendChild(textarea);
      item.appendChild(label);
    }
    els.regionEditor.appendChild(item);
  });
};

const normalizeWordsToRegions = (words, minConfidence) =>
  words
    .filter((word) => {
      const text = String(word.text || "").trim();
      return text && (word.confidence || 0) >= minConfidence;
    })
    .map((word) => ({
      sourceText: String(word.text || "").trim(),
      confidence: Number(word.confidence || 0),
      bbox: {
        x0: Number(word.bbox?.x0 || 0),
        y0: Number(word.bbox?.y0 || 0),
        x1: Number(word.bbox?.x1 || 0),
        y1: Number(word.bbox?.y1 || 0)
      },
      translatedText: ""
    }));

const groupWordsIntoLines = (words, order) => {
  const lines = [];
  for (const word of [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)) {
    const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
    const line = lines.find((candidate) => {
      const overlap = Math.min(candidate.y1, word.bbox.y1) - Math.max(candidate.y0, word.bbox.y0);
      return overlap > 0 && Math.abs(candidate.centerY - centerY) < Math.max(12, (word.bbox.y1 - word.bbox.y0) * 0.8);
    });
    if (line) {
      line.words.push(word);
      line.y0 = Math.min(line.y0, word.bbox.y0);
      line.y1 = Math.max(line.y1, word.bbox.y1);
      line.centerY = (line.y0 + line.y1) / 2;
    } else {
      lines.push({ words: [word], y0: word.bbox.y0, y1: word.bbox.y1, centerY });
    }
  }
  return lines.map((line) => {
    const ordered = line.words.sort((a, b) => order === "rtl" ? b.bbox.x0 - a.bbox.x0 : a.bbox.x0 - b.bbox.x0);
    return {
      sourceText: ordered.map((word) => word.sourceText).join(" "),
      confidence: Math.min(...ordered.map((word) => word.confidence)),
      bbox: {
        x0: Math.min(...ordered.map((word) => word.bbox.x0)),
        y0: Math.min(...ordered.map((word) => word.bbox.y0)),
        x1: Math.max(...ordered.map((word) => word.bbox.x1)),
        y1: Math.max(...ordered.map((word) => word.bbox.y1))
      },
      translatedText: ""
    };
  });
};

const performTranslation = async (texts, source, target, signal) => {
  const provider = els.providerSelect.value;
  const contextWindow = Math.max(0, Math.min(5, Number(els.contextWindow.value) || 0));
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      texts,
      segments: texts.map((text, index) => ({ id: String(index), text })),
      source: source === "auto" ? undefined : source,
      target,
      provider,
      contextWindow,
      glossary: els.glossaryInput.value.slice(0, 5_000)
    }),
    signal
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Translation failed.");
  }

  return Array.isArray(payload.translated) ? payload.translated.map((text) => htmlDecode(text)) : [];
};

const refreshProviderStatus = async () => {
  const response = await fetch("/api/provider");
  if (!response.ok) return;
  const payload = await response.json();
  els.providerSelect.value = payload.provider || "local";
  els.cloudProviderControls.hidden = els.providerSelect.value !== "gemini";
  els.providerStatus.textContent = payload.connected
    ? `Connected to Gemini (${payload.model}). Quota and billing are controlled by your account.`
    : "Not connected.";
};

const connectGemini = async () => {
  const apiKey = els.geminiKeyInput.value.trim();
  if (!apiKey) {
    setStatus("Enter a Gemini API key to connect.", true);
    return;
  }
  const response = await fetch("/api/provider/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "gemini", apiKey })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Gemini connection failed.");
  els.geminiKeyInput.value = "";
  els.providerSelect.value = "gemini";
  await refreshProviderStatus();
  setStatus("Gemini connected for this server session.");
};

const disconnectProvider = async () => {
  const response = await fetch("/api/provider/disconnect", { method: "POST" });
  if (!response.ok) throw new Error("Could not disconnect the cloud provider.");
  els.providerSelect.value = "local";
  await refreshProviderStatus();
  setStatus("Returned to local translation.");
};

const performOcr = async () => {
  setStatus("Running OCR...");
  const result = await window.Tesseract.recognize(els.sourceImage, getOcrLanguage(els.sourceLang.value), {
    logger: () => {},
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/tesseract-core.wasm.js",
    langPath: "https://tessdata.projectnaptha.com/4.0.0"
  });
  return result?.data?.words || [];
};

const translateTexts = async (texts, signal) => {
  if (texts.length > MAX_TEXTS) {
    const output = [];
    for (let index = 0; index < texts.length; index += MAX_TEXTS) {
      output.push(...await performTranslation(texts.slice(index, index + MAX_TEXTS), els.sourceLang.value, els.targetLang.value, signal));
    }
    return output;
  }
  return performTranslation(texts, els.sourceLang.value, els.targetLang.value, signal);
};

const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

const xmlEscape = (value) => String(value).replace(/[<>&'"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" }[char]));
const makeDocx = async (paragraphs) => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((text) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
};

const updateDocumentButtons = (imported, translated = false) => {
  els.translateDocumentBtn.disabled = !imported;
  [els.exportTxtBtn, els.exportXlsxBtn, els.exportDocxBtn].forEach((button) => {
    button.disabled = !translated;
  });
};

const updateImageExportButtons = (enabled) => {
  [els.exportImageTxtBtn, els.exportImageXlsxBtn, els.exportImageDocxBtn].forEach((button) => {
    button.disabled = !enabled;
  });
};

const archiveWithinLimit = async (arrayBuffer) => {
  const zip = await JSZip.loadAsync(arrayBuffer);
  let total = 0;
  for (const entry of Object.values(zip.files)) {
    total += entry._data?.uncompressedSize || 0;
    if (total > MAX_ARCHIVE_BYTES) {
      throw new Error("Document expands beyond the safety limit.");
    }
  }
};

const extractDocxParagraphs = (xml) => {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("The DOCX document is malformed.");
  return [...doc.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "p")].map((paragraph) =>
    [...paragraph.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "t")]
      .map((text) => text.textContent)
      .join("")
  );
};

const importTextDocument = async (file) => {
  if (file.size > MAX_FILE_BYTES) throw new Error("Document must be 15 MB or smaller.");
  if (file.name.toLowerCase().endsWith(".txt")) {
    const text = await file.text();
    if (text.length > MAX_DOCUMENT_TEXT) throw new Error("Document text is too long.");
    return { kind: "txt", name: file.name, paragraphs: text.split(/\r?\n/), original: text };
  }
  const buffer = await file.arrayBuffer();
  await archiveWithinLimit(buffer);
  if (file.name.toLowerCase().endsWith(".xlsx")) {
    const workbook = XLSX.read(buffer, { type: "array", cellFormula: true });
    const cells = [];
    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      Object.keys(sheet).filter((key) => !key.startsWith("!")).forEach((address) => {
        const cell = sheet[address];
        if (cell && typeof cell.v === "string" && !cell.f && cell.v.trim()) cells.push({ sheetName, address, text: cell.v });
      });
    });
    if (cells.length > MAX_DOCUMENT_CELLS) throw new Error("Workbook has too many text cells.");
    return { kind: "xlsx", name: file.name, workbook, cells };
  }
  if (file.name.toLowerCase().endsWith(".docx")) {
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")?.async("text");
    if (!xml) throw new Error("The DOCX document is missing its main document.");
    const paragraphs = extractDocxParagraphs(xml);
    if (paragraphs.join("\n").length > MAX_DOCUMENT_TEXT) throw new Error("Document text is too long.");
    return { kind: "docx", name: file.name, paragraphs, original: paragraphs.join("\n") };
  }
  throw new Error("Only .txt, .xlsx, and .docx files are supported.");
};

const documentText = () => {
  if (!documentState) return [];
  if (documentState.kind === "xlsx") return documentState.cells.map((cell) => cell.text);
  return documentState.paragraphs;
};

const translateDocument = async () => {
  if (!documentState) return;
  documentController?.abort();
  documentController = new AbortController();
  try {
    const texts = documentText();
    const translated = await translateTexts(texts, documentController.signal);
    if (translated.length !== texts.length) throw new Error("Translation service returned incomplete results.");
    if (documentState.kind === "xlsx") {
      documentState.cells.forEach((cell, index) => {
        documentState.workbook.Sheets[cell.sheetName][cell.address].v = translated[index];
        documentState.workbook.Sheets[cell.sheetName][cell.address].t = "s";
      });
      documentState.translatedCells = translated;
    } else {
      documentState.translatedParagraphs = translated;
    }
    updateDocumentButtons(true, true);
    setStatus("Document translated. The original file remains unchanged.");
  } catch (error) {
    if (error.name !== "AbortError") setStatus(error.message || "Document translation failed.", true);
  } finally {
    documentController = null;
  }
};

const exportDocument = async (kind) => {
  if (!documentState?.translatedParagraphs && documentState?.kind !== "xlsx") {
    setStatus("Translate the document before exporting.", true);
    return;
  }
  const base = documentState.name.replace(/\.[^.]+$/, "");
  if (kind === "txt") {
    const text = documentState.kind === "xlsx"
      ? documentState.cells.map((cell, index) => `[${cell.sheetName}!${cell.address}]\n${cell.text}\n${documentState.translatedCells?.[index] || ""}`).join("\n")
      : documentState.translatedParagraphs.join("\n");
    downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `${base}.translated.txt`);
  } else if (kind === "xlsx") {
    if (documentState.kind !== "xlsx") {
      const sheet = XLSX.utils.aoa_to_sheet(documentState.translatedParagraphs.map((text) => [text]));
      downloadBlob(new Blob([XLSX.write({ SheetNames: ["Translation"], Sheets: { Translation: sheet } }, { type: "array", bookType: "xlsx" })]), `${base}.translated.xlsx`);
    } else {
      downloadBlob(new Blob([XLSX.write(documentState.workbook, { type: "array", bookType: "xlsx" })]), `${base}.translated.xlsx`);
    }
  } else {
    const paragraphs = documentState.kind === "xlsx" ? documentState.cells.map((cell) => `${cell.sheetName}!${cell.address}: ${cell.text}`) : documentState.translatedParagraphs;
    downloadBlob(await makeDocx(paragraphs), `${base}.translated.docx`);
  }
};

const imageExportRows = () => translatedRegions.map((region, index) => ({
  order: index + 1,
  source: region.sourceText,
  translation: region.translatedText,
  confidence: region.confidence
}));

const exportImage = async (kind) => {
  if (!translatedRegions.length) {
    setStatus("Translate an image before exporting.", true);
    return;
  }
  const rows = imageExportRows();
  const header = `Source language: ${els.sourceLang.value}\nTarget language: ${els.targetLang.value}\n\n`;
  if (kind === "txt") {
    downloadBlob(new Blob([header + rows.map((row) => `${row.order}. ${row.source}\n${row.translation}`).join("\n\n")], { type: "text/plain;charset=utf-8" }), "image-translation.txt");
  } else if (kind === "xlsx") {
    const sheet = XLSX.utils.json_to_sheet(rows);
    downloadBlob(new Blob([XLSX.write({ SheetNames: ["Image Translation"], Sheets: { "Image Translation": sheet } }, { type: "array", bookType: "xlsx" })]), "image-translation.xlsx");
  } else {
    const paragraphs = [header, ...rows.map((row) => `${row.order}. ${row.source}\n${row.translation}`)];
    downloadBlob(await makeDocx(paragraphs), "image-translation.docx");
  }
};

const buildAudioQueue = (regions) =>
  regions
    .map((item) => item.translatedText.trim())
    .filter(Boolean)
    .slice(0, 120);

const requestTtsAudio = async (text) => {
  const voice = els.voiceInput.value.trim() || "af_heart";
  const speed = Number(els.speedInput.value) || 1;

  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice, speed })
  });

  if (!response.ok) {
    let details = "";
    try {
      const payload = await response.json();
      details = payload.error || "";
    } catch {
      details = await response.text();
    }
    throw new Error(details || "TTS request failed.");
  }

  const audioBlob = await response.blob();
  return URL.createObjectURL(audioBlob);
};

const stopAudio = () => {
  if (currentAudio) {
    currentAudio.pause();
    URL.revokeObjectURL(currentAudio.src);
    currentAudio = null;
  }
};

const playQueueFromCurrent = async () => {
  if (!audioQueue.length) {
    setStatus("Nothing to play.", true);
    return;
  }

  if (queueIndex >= audioQueue.length) {
    queueIndex = 0;
  }

  const text = audioQueue[queueIndex];
  setStatus(`Speaking ${queueIndex + 1}/${audioQueue.length}...`);

  try {
    const audioUrl = await requestTtsAudio(text);
    stopAudio();
    currentAudio = new Audio(audioUrl);
    currentAudio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
      queueIndex += 1;
      if (queueIndex < audioQueue.length) {
        playQueueFromCurrent().catch((error) => setStatus(error.message, true));
      } else {
        setStatus("Read-aloud complete.");
      }
    };
    await currentAudio.play();
  } catch (error) {
    setStatus(`Audio failed: ${error.message}`, true);
  }
};

const translateImage = async () => {
  if (!els.sourceImage.src) {
    setStatus("Load an image first.", true);
    return;
  }
  if (translationInFlight) {
    setStatus("A translation is already running.");
    return;
  }
  translationInFlight = true;

  const cacheKey = getImageCacheKey();
  if (resultCache.has(cacheKey)) {
    translatedRegions = resultCache.get(cacheKey);
    renderOverlay(translatedRegions);
    renderRegionEditor(translatedRegions);
    updateImageExportButtons(translatedRegions.length > 0);
    audioQueue = buildAudioQueue(translatedRegions);
    setStatus(`Loaded ${translatedRegions.length} region(s) from cache.`);
    if (els.autoPlayToggle.checked) {
      queueIndex = 0;
      playQueueFromCurrent().catch((error) => setStatus(error.message, true));
    }
    translationInFlight = false;
    return;
  }

  const run = ++translationRun;
  const controller = new AbortController();
  translationController = controller;
  try {
    const minConfidence = Number(els.minConfidence.value) || 0;
    const sourceLanguage = els.sourceLang.value.trim() || "auto";
    const targetLanguage = els.targetLang.value.trim() || "en";

    const words = await performOcr();
    if (run !== translationRun) {
      return;
    }
    const regions = groupWordsIntoLines(normalizeWordsToRegions(words, minConfidence), els.readingOrder.value);
    if (!regions.length) {
      translatedRegions = [];
      renderOverlay(translatedRegions);
      updateImageExportButtons(false);
      audioQueue = [];
      setStatus("No readable text found.", true);
      return;
    }

    const orderedRegions = sortByReadingOrder(regions, els.readingOrder.value);
    setStatus(`Translating ${orderedRegions.length} text region(s)...`);
    const translatedTexts = await performTranslation(
      orderedRegions.map((region) => region.sourceText),
      sourceLanguage,
      targetLanguage,
      controller.signal
    );
    if (run !== translationRun) {
      return;
    }

    translatedRegions = orderedRegions.map((region, index) => ({
      ...region,
      translatedText: translatedTexts[index] || region.sourceText
    }));

    resultCache.set(cacheKey, translatedRegions);
    renderOverlay(translatedRegions);
    renderRegionEditor(translatedRegions);
    updateImageExportButtons(translatedRegions.length > 0);
    audioQueue = buildAudioQueue(translatedRegions);

    setStatus(`Done. Rendered ${translatedRegions.length} translated region(s).`);

    if (els.autoPlayToggle.checked) {
      queueIndex = 0;
      playQueueFromCurrent().catch((error) => setStatus(error.message, true));
    }
  } catch (error) {
    if (run !== translationRun) {
      return;
    }
    setStatus(error.message || "Failed to translate image.", true);
  } finally {
    if (translationController === controller) {
      translationInFlight = false;
      translationController = null;
    }
  }
};

els.regionEditor.addEventListener("input", (event) => {
  const field = event.target.dataset.field;
  const index = Number(event.target.dataset.region);
  if (!field || !Number.isInteger(index) || !translatedRegions[index]) {
    return;
  }
  translatedRegions[index][field] = event.target.value;
  if (field === "sourceText") {
    resultCache.clear();
    updateImageExportButtons(false);
  }
  renderOverlay(translatedRegions);
  audioQueue = buildAudioQueue(translatedRegions);
});

els.fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  stopAudio();
  queueIndex = 0;

  let nextObjectUrl = null;
  try {
    cancelTranslation();
    if (file.size > 15 * 1024 * 1024) {
      throw new Error("Image must be 15 MB or smaller.");
    }
    nextObjectUrl = URL.createObjectURL(file);
    await loadImage(nextObjectUrl, file.size);
    if (imageObjectUrl) {
      URL.revokeObjectURL(imageObjectUrl);
    }
    imageObjectUrl = nextObjectUrl;
    resultCache.clear();
    updateImageExportButtons(false);
    await setImageSource(nextObjectUrl, file.size);
    setStatus("Image loaded.");
  } catch (error) {
    if (nextObjectUrl) {
      URL.revokeObjectURL(nextObjectUrl);
    }
    setStatus(error.message || "Failed to read selected image.", true);
  }
});

els.loadUrlBtn.addEventListener("click", async () => {
  const safeUrl = toSafeImageUrl(els.imageUrlInput.value.trim());
  if (!safeUrl) {
    setStatus("Provide a valid http/https image URL.", true);
    return;
  }

  stopAudio();
  queueIndex = 0;
  cancelTranslation();
  let nextObjectUrl = null;
  try {
    const remoteImage = await loadRemoteImage(safeUrl);
    nextObjectUrl = remoteImage.objectUrl;
    const { size } = remoteImage;
    if (imageObjectUrl) {
      URL.revokeObjectURL(imageObjectUrl);
    }
    imageObjectUrl = nextObjectUrl;
    resultCache.clear();
    await setImageSource(nextObjectUrl, size);
    setStatus("Image URL loaded.");
  } catch (error) {
    if (nextObjectUrl) {
      URL.revokeObjectURL(nextObjectUrl);
    }
    setStatus(error.message || "Image could not be loaded.", true);
  }
});

els.overlayToggle.addEventListener("change", () => {
  renderOverlay(translatedRegions);
});

els.showOriginalToggle.addEventListener("change", () => {
  els.regionEditor.hidden = !els.showOriginalToggle.checked;
});

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: els.passwordInput.value })
    });

    await refreshProviderStatus();
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Sign-in failed.");
    }
    els.passwordInput.value = "";
    els.loginForm.hidden = true;
    setStatus("Signed in.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

els.providerSelect.addEventListener("change", () => {
  els.cloudProviderControls.hidden = els.providerSelect.value !== "gemini";
  if (els.providerSelect.value === "gemini") {
    setStatus("Connect Gemini before translating. Cloud mode is opt-in and may incur account charges.");
  }
});
els.connectGeminiBtn.addEventListener("click", () => connectGemini().catch((error) => setStatus(error.message, true)));
els.disconnectProviderBtn.addEventListener("click", () => disconnectProvider().catch((error) => setStatus(error.message, true)));
els.documentInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    documentController?.abort();
    documentState = await importTextDocument(file);
    updateDocumentButtons(true, false);
    setStatus(`Loaded ${file.name}. Translate it before exporting.`);
  } catch (error) {
    documentState = null;
    updateDocumentButtons(false, false);
    setStatus(error.message || "Document import failed.", true);
  }
});
els.translateDocumentBtn.addEventListener("click", () => translateDocument());
els.exportTxtBtn.addEventListener("click", () => exportDocument("txt"));
els.exportXlsxBtn.addEventListener("click", () => exportDocument("xlsx"));
els.exportDocxBtn.addEventListener("click", () => exportDocument("docx"));
els.exportImageTxtBtn.addEventListener("click", () => exportImage("txt"));
els.exportImageXlsxBtn.addEventListener("click", () => exportImage("xlsx"));
els.exportImageDocxBtn.addEventListener("click", () => exportImage("docx"));

refreshProviderStatus().catch(() => {});

els.translateBtn.addEventListener("click", () => {
  translateImage().catch((error) => setStatus(error.message, true));
});

els.playBtn.addEventListener("click", () => {
  queueIndex = 0;
  playQueueFromCurrent().catch((error) => setStatus(error.message, true));
});

els.pauseBtn.addEventListener("click", () => {
  if (currentAudio) {
    currentAudio.pause();
    setStatus("Audio paused.");
  }
});

els.stopBtn.addEventListener("click", () => {
  stopAudio();
  queueIndex = 0;
  setStatus("Audio stopped.");
});

els.nextBtn.addEventListener("click", () => {
  stopAudio();
  queueIndex = Math.min(queueIndex + 1, Math.max(audioQueue.length - 1, 0));
  playQueueFromCurrent().catch((error) => setStatus(error.message, true));
});

document.addEventListener("keydown", (event) => {
  if (!event.ctrlKey || !event.shiftKey) {
    return;
  }

  if (event.key.toLowerCase() === "t") {
    els.overlayToggle.checked = !els.overlayToggle.checked;
    renderOverlay(translatedRegions);
  }

  if (event.key.toLowerCase() === "r") {
    translateImage().catch((error) => setStatus(error.message, true));
  }

  if (event.key.toLowerCase() === "p") {
    if (currentAudio && !currentAudio.paused) {
      currentAudio.pause();
      setStatus("Audio paused.");
    } else if (currentAudio && currentAudio.paused) {
      currentAudio.play().catch((error) => setStatus(error.message, true));
    } else {
      playQueueFromCurrent().catch((error) => setStatus(error.message, true));
    }
  }
});

checkSession().catch(() => setStatus("Unable to check authentication status.", true));
setStatus("Ready. Load an image and click Translate now.");
