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
  minConfidence: document.getElementById("minConfidence"),
  readingOrder: document.getElementById("readingOrder"),
  voiceInput: document.getElementById("voiceInput"),
  speedInput: document.getElementById("speedInput"),
  autoPlayToggle: document.getElementById("autoPlayToggle"),
  loginForm: document.getElementById("loginForm"),
  passwordInput: document.getElementById("passwordInput"),
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
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      texts,
      source: source === "auto" ? undefined : source,
      target
    }),
    signal
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Translation failed.");
  }

  return Array.isArray(payload.translated) ? payload.translated.map((text) => htmlDecode(text)) : [];
};

const performOcr = async () => {
  setStatus("Running OCR...");
  const result = await window.Tesseract.recognize(els.sourceImage, "jpn+eng", {
    logger: () => {},
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/tesseract-core.wasm.js",
    langPath: "https://tessdata.projectnaptha.com/4.0.0"
  });
  return result?.data?.words || [];
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
