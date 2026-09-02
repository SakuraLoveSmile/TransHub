const API = {
  status: "/api/status",
  upload: "/api/upload",
  transcribe: "/api/transcribe",
  translate: "/api/translate-audio",
};

const TAG_BY_MODE = {
  transcribe: "transcribe",
  translate: "zh",
};

const els = {
  engine: document.getElementById("engine"),
  status: document.getElementById("status"),
  loadedModel: document.getElementById("loaded-model"),
  path: document.getElementById("media-path"),
  file: document.getElementById("media-file"),
  run: document.getElementById("run"),
  resultModel: document.getElementById("result-model"),
  resultDuration: document.getElementById("result-duration"),
  resultProcessing: document.getElementById("result-processing"),
  resultSpeed: document.getElementById("result-speed"),
  segments: document.getElementById("segments"),
  error: document.getElementById("error"),
  copy: document.getElementById("copy"),
  download: document.getElementById("download"),
};

let jobRunning = false;
let lastOutcome = null;
let currentResult = null;
let currentMode = "transcribe";
let currentSourceName = "untitled";

function pad(value, width) {
  return String(value).padStart(width, "0");
}

function formatClock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  return `${pad(Math.floor(total / 60), 2)}:${pad(total % 60, 2)}`;
}

function formatStamp(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor(ms / 60000) % 60;
  const secs = Math.floor(ms / 1000) % 60;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)},${pad(ms % 1000, 3)}`;
}

function formatInlineStamp(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const minutes = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(3);
  return `${pad(minutes, 2)}:${secs.padStart(6, "0")}`;
}

function setStatus(text, tone) {
  els.status.textContent = text;
  els.status.className = `value state-${tone}`;
}

function outcome(text, tone) {
  lastOutcome = { text, tone };
  setStatus(text, tone);
}

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
}

function clearError() {
  els.error.textContent = "";
  els.error.hidden = true;
}

function selectedMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

async function pollStatus() {
  let snapshot;
  try {
    const response = await fetch(API.status);
    snapshot = await response.json();
  } catch (error) {
    els.engine.textContent = "-";
    setStatus("Unavailable", "error");
    return;
  }

  els.engine.textContent = snapshot.mock ? "Mock" : snapshot.engine;
  els.loadedModel.textContent = snapshot.loaded_model || "None";

  if (jobRunning) {
    setStatus(snapshot.loaded_model ? "Processing" : "Loading Model", "running");
    return;
  }
  if (snapshot.status === "running") {
    setStatus("Busy", "running");
    return;
  }
  if (lastOutcome) {
    setStatus(lastOutcome.text, lastOutcome.tone);
    return;
  }
  setStatus("Ready", "idle");
}

function renderResult(result) {
  currentResult = result;
  els.resultModel.textContent = result.model;
  els.resultDuration.textContent = formatClock(result.duration);
  els.resultProcessing.textContent = `${result.processing_time.toFixed(1)} s`;
  els.resultSpeed.textContent = `${result.speed.toFixed(2)}x`;

  els.segments.textContent = "";
  for (const segment of result.segments) {
    const item = document.createElement("div");
    item.className = "segment";

    const time = document.createElement("span");
    time.className = "time";
    time.textContent = `${formatInlineStamp(segment.start)} → ${formatInlineStamp(segment.end)}`;

    const text = document.createElement("span");
    text.textContent = segment.text;

    item.append(time, text);
    els.segments.append(item);
  }

  els.copy.disabled = false;
  els.download.disabled = false;
}

function clearResult() {
  currentResult = null;
  els.resultModel.textContent = "-";
  els.resultDuration.textContent = "-";
  els.resultProcessing.textContent = "-";
  els.resultSpeed.textContent = "-";
  els.segments.textContent = "";
  els.copy.disabled = true;
  els.download.disabled = true;
}

function detailText(payload, status) {
  const detail = payload && payload.detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg).filter(Boolean).join("; ");
  }
  return detail || `Request failed (${status})`;
}

function mediaStem(path) {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const last = parts[parts.length - 1] || "";
  return last.replace(/\.[^.]+$/, "") || "untitled";
}

function buildSrt(result) {
  return (
    result.segments
      .map(
        (segment, index) =>
          `${index + 1}\n${formatStamp(segment.start)} --> ${formatStamp(segment.end)}\n${segment.text}`
      )
      .join("\n\n") + "\n"
  );
}

async function run() {
  const mode = selectedMode();
  const file = els.file.files && els.file.files[0];
  const path = els.path.value.trim();

  if (!file && !path) {
    showError("Choose a local file, or fill in the server path in Advanced.");
    outcome("Error", "error");
    return;
  }

  clearError();
  clearResult();
  lastOutcome = null;
  els.run.disabled = true;
  els.run.textContent = "Processing...";
  currentMode = mode;
  currentSourceName = file ? file.name : path;

  jobRunning = true;
  pollStatus();

  try {
    let mediaPath;
    if (file) {
      const uploaded = await uploadFile(file);
      if (uploaded === null) return;
      mediaPath = uploaded;
    } else {
      mediaPath = path;
    }

    const response = await fetch(
      mode === "translate" ? API.translate : API.transcribe,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: mediaPath }),
      }
    );
    const payload = await response.json();
    if (!response.ok) {
      if (response.status === 409) {
        showError("Engine is busy, try again.");
        outcome("Busy", "running");
      } else {
        showError(detailText(payload, response.status));
        outcome("Error", "error");
      }
      return;
    }
    renderResult(payload);
    outcome("Success", "ok");
  } catch (error) {
    showError(`Cannot reach the API: ${error.message}`);
    outcome("Error", "error");
  } finally {
    jobRunning = false;
    els.run.disabled = false;
    els.run.textContent = "Run";
  }
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  let payload;
  try {
    const response = await fetch(API.upload, {
      method: "POST",
      body: formData,
    });
    payload = await response.json();
    if (response.ok) return payload.path;
    if (response.status === 409) {
      showError("Engine is busy, try again.");
      outcome("Busy", "running");
    } else {
      showError(detailText(payload, response.status));
      outcome("Error", "error");
    }
  } catch (error) {
    showError(`Cannot reach the API: ${error.message}`);
    outcome("Error", "error");
  }
  return null;
}

function copyFallback(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    area.remove();
  }
  return copied;
}

async function copyText() {
  if (!currentResult) return;
  const text = currentResult.segments.map((segment) => segment.text).join("\n");
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch (error) {
    copied = copyFallback(text);
  }
  if (!copied) {
    showError("Clipboard unavailable, copy the text from the segment list.");
    return;
  }
  els.copy.textContent = "Copied";
  setTimeout(() => (els.copy.textContent = "Copy Text"), 1200);
}

function downloadSrt() {
  if (!currentResult) return;
  const blob = new Blob([buildSrt(currentResult)], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${mediaStem(currentSourceName)}.${TAG_BY_MODE[currentMode]}.srt`;
  link.click();
  URL.revokeObjectURL(url);
}

els.run.addEventListener("click", run);
els.copy.addEventListener("click", copyText);
els.download.addEventListener("click", downloadSrt);
els.path.addEventListener("keydown", (event) => {
  if (event.key === "Enter") run();
});

pollStatus();
setInterval(pollStatus, 2000);
