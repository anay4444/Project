const els = {
  fileInput: document.getElementById("fileInput"),
  imageUrlInput: document.getElementById("imageUrlInput"),
  loadUrlBtn: document.getElementById("loadUrlBtn"),
  sourceImage: document.getElementById("sourceImage"),
  overlayLayer: document.getElementById("overlayLayer"),
  overlayToggle: document.getElementById("overlayToggle"),
  autoRefreshToggle: document.getElementById("autoRefreshToggle"),
  sourceLang: document.getElementById("sourceLang"),
  targetLang: document.getElementById("targetLang"),
  minConfidence: document.getElementById("minConfidence"),
  readingOrder: document.getElementById("readingOrder"),
  voiceInput: document.getElementById("voiceInput"),
  speedInput: document.getElementById("speedInput"),
  autoPlayToggle: document.getElementById("autoPlayToggle"),
  translateBtn: document.getElementById("translateBtn"),
  playBtn: document.getElementById("playBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  stopBtn: document.getElementById("stopBtn"),
  nextBtn: document.getElementById("nextBtn"),
  statusText: document.getElementById("statusText")
};

let translatedRegions = [];
let audioQueue = [];
let currentAudio = null;
let queueIndex = 0;

const resultCache = new Map();
const imageObserver = new MutationObserver(() => {
  if (els.autoRefreshToggle.checked && els.sourceImage.src) {
    translateImage().catch((error) => setStatus(error.message, true));
  }
});

imageObserver.observe(els.sourceImage, { attributes: true, attributeFilter: ["src"] });

const setStatus = (message, isError = false) => {
  els.statusText.textContent = `Status: ${message}`;
  els.statusText.style.color = isError ? "#ff8888" : "#f1f1f1";
};

const htmlDecode = (input) => {
  const parser = new DOMParser();
  return parser.parseFromString(input, "text/html").documentElement.textContent || "";
};

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

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
    box.textContent = region.translatedText;

    els.overlayLayer.appendChild(box);
  }
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

const performTranslation = async (texts, source, target) => {
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      texts,
      source: source === "auto" ? undefined : source,
      target
    })
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
    logger: () => {}
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

  const cacheKey = getImageCacheKey();
  if (resultCache.has(cacheKey)) {
    translatedRegions = resultCache.get(cacheKey);
    renderOverlay(translatedRegions);
    audioQueue = buildAudioQueue(translatedRegions);
    setStatus(`Loaded ${translatedRegions.length} region(s) from cache.`);
    if (els.autoPlayToggle.checked) {
      queueIndex = 0;
      playQueueFromCurrent().catch((error) => setStatus(error.message, true));
    }
    return;
  }

  try {
    const minConfidence = Number(els.minConfidence.value) || 0;
    const sourceLanguage = els.sourceLang.value.trim() || "auto";
    const targetLanguage = els.targetLang.value.trim() || "en";

    const words = await performOcr();
    const regions = normalizeWordsToRegions(words, minConfidence);
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
      targetLanguage
    );

    translatedRegions = orderedRegions.map((region, index) => ({
      ...region,
      translatedText: translatedTexts[index] || region.sourceText
    }));

    resultCache.set(cacheKey, translatedRegions);
    renderOverlay(translatedRegions);
    audioQueue = buildAudioQueue(translatedRegions);

    setStatus(`Done. Rendered ${translatedRegions.length} translated region(s).`);

    if (els.autoPlayToggle.checked) {
      queueIndex = 0;
      playQueueFromCurrent().catch((error) => setStatus(error.message, true));
    }
  } catch (error) {
    setStatus(error.message || "Failed to translate image.", true);
  }
};

els.fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  stopAudio();
  queueIndex = 0;

  try {
    const dataUrl = await readAsDataUrl(file);
    els.sourceImage.src = dataUrl;
    setStatus("Image loaded.");
  } catch {
    setStatus("Failed to read selected image.", true);
  }
});

els.loadUrlBtn.addEventListener("click", () => {
  const url = els.imageUrlInput.value.trim();
  if (!url) {
    setStatus("Provide a valid image URL.", true);
    return;
  }

  stopAudio();
  queueIndex = 0;

  els.sourceImage.src = url;
  setStatus("Image URL loaded.");
});

els.overlayToggle.addEventListener("change", () => {
  renderOverlay(translatedRegions);
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

setStatus("Ready. Load an image and click Translate now.");
