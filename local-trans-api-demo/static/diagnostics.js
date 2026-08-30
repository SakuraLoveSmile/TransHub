const CANONICAL_KEYS = [
  "duration",
  "language",
  "mock",
  "model",
  "processing_time",
  "profile",
  "realtime_factor",
  "segments",
  "speed",
  "success",
  "text",
];

const MOCK = {
  transcribeText: "こんばんは。今日はよろしくお願いします。",
  translateText: "晚上好。今天请多关照。",
  translateModel: "chickenrice-v2",
  srtBlock: "1\n00:00:00,800 --> 00:00:03,400\nこんばんは。",
  catalog: ["chickenrice-v2", "whisper-ja-1.5b"],
};

const SRT_LINE = /\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/g;

// One schema for both engines: transcription carries language, translation
// carries source/target language. Nothing else may appear.
function expectedKeys(withLanguage) {
  const rest = CANONICAL_KEYS.filter((key) => key !== "language");
  return (
    withLanguage
      ? [...rest, "language"]
      : [...rest, "source_language", "target_language"]
  )
    .sort()
    .join();
}

const els = {
  engineLine: document.getElementById("engine-line"),
  envState: document.getElementById("env-state"),
  env: document.getElementById("env"),
  models: document.getElementById("models"),
  endpoint: document.getElementById("endpoint"),
  refreshEnv: document.getElementById("refresh-env"),
  setupHint: document.getElementById("setup-hint"),
  file: document.getElementById("file"),
  model: document.getElementById("model"),
  language: document.getElementById("language"),
  device: document.getElementById("device"),
  timeout: document.getElementById("timeout"),
  run: document.getElementById("run"),
  stop: document.getElementById("stop"),
  copy: document.getElementById("copy-summary"),
  banner: document.getElementById("banner"),
  checks: document.getElementById("checks"),
  count: document.getElementById("count"),
  summary: document.getElementById("summary"),
};

let abortController = null;
let rows = {};
let activeSuite = null;
let lastSummary = null;
let env = null;
let modelRows = {};
let progressTimer = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sortedKeys(object) {
  return Object.keys(object || {}).sort();
}

function normalize(text) {
  return (text || "").replace(/\s+/g, "");
}

function mediaStem(path) {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const last = parts[parts.length - 1] || "";
  return last.replace(/\.[^.]+$/, "") || "untitled";
}

function pass(detail) {
  return { ok: true, detail: detail || "" };
}

function fail(detail, stop) {
  return { ok: false, detail, stop: Boolean(stop) };
}

function skip(detail) {
  return { ok: false, skip: true, detail };
}

function describe(response) {
  const body = (response.text || "").replace(/\s+/g, " ").slice(0, 140);
  return `${response.status} ${body}`;
}

async function request(method, path, body, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  if (abortController) {
    abortController.signal.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }

  const init = { method, headers: {}, signal: controller.signal };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const started = performance.now();
  try {
    const response = await fetch(path, init);
    const text = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      parsed = null;
    }
    return {
      status: response.status,
      body: parsed,
      text,
      seconds: (performance.now() - started) / 1000,
    };
  } catch (error) {
    const cancelled = abortController && abortController.signal.aborted;
    return {
      status: cancelled ? -1 : 0,
      body: null,
      text: timedOut
        ? `timed out after ${Math.round(timeoutMs / 1000)}s`
        : cancelled
          ? "cancelled"
          : `request error: ${error.message}`,
      seconds: (performance.now() - started) / 1000,
    };
  } finally {
    clearTimeout(timer);
  }
}

function timelineOk(payload) {
  const segments = payload.segments || [];
  if (!segments.length) return false;
  return segments.every(
    (segment, index) =>
      segment.end > segment.start &&
      segment.start >= 0 &&
      (index === 0 || segment.start >= segments[index - 1].start)
  );
}

function metricsOk(payload) {
  const { duration, processing_time: processing } = payload;
  if (!(processing > 0) || !(duration > 0)) return false;
  return (
    Math.abs(payload.realtime_factor - round(processing / duration, 4)) < 1e-3 &&
    Math.abs(payload.speed - round(duration / processing, 2)) < 1
  );
}

const CHECKS = {
  health: {
    label: "GET /api/health",
    run: async (ctx) => {
      const response = await request("GET", "/api/health", undefined, ctx.timeoutMs);
      if (response.status === 0 || response.status === -1) {
        return fail(`${response.text} — is run.bat up?`, true);
      }
      return response.status === 200 && response.body && response.body.status === "ok"
        ? pass("200 ok")
        : fail(describe(response), true);
    },
  },

  idle: {
    label: "engine idle before the run",
    run: async (ctx) => {
      const response = await request("GET", "/api/status", undefined, ctx.timeoutMs);
      ctx.status = response.body || {};
      if (ctx.status.status === "running") {
        return fail(
          "engine is busy: another tab or an abandoned request still holds the only " +
            "inference slot. Wait for it to finish or restart the server.",
          true
        );
      }
      return pass(`device ${ctx.status.device || "-"}`);
    },
  },

  engine: {
    label: "GET /api/status reports the expected engine",
    run: async (ctx) => {
      const response = await request("GET", "/api/status", undefined, ctx.timeoutMs);
      const status = response.body || {};
      ctx.status = status;
      ctx.summary.engine = status.engine;
      ctx.summary.device = status.device;
      const problems = [];
      if (status.engine !== ctx.expectEngine) problems.push(`engine ${status.engine}`);
      if (status.mock !== ctx.expectMock) problems.push(`mock ${status.mock}`);
      return problems.length ? fail(problems.join("; "), true) : pass(`${status.engine} · ${status.device}`);
    },
  },

  device: {
    label: "device matches expectation",
    run: async (ctx) => {
      const device = ctx.status.device;
      if (ctx.expectDevice) {
        return device === ctx.expectDevice
          ? pass(device)
          : fail(
              `got ${device}, expected ${ctx.expectDevice}. Set [faster_whisper] ` +
                `device = "${ctx.expectDevice}" in the config and restart run.bat.`
            );
      }
      return device === "cpu" || device === "cuda"
        ? pass(device)
        : fail(`unexpected device ${device}`);
    },
  },

  catalog: {
    label: "GET /api/models",
    run: async (ctx) => {
      const response = await request("GET", "/api/models", undefined, ctx.timeoutMs);
      if (response.status !== 200) return fail(describe(response), true);
      const models = response.body.models || [];
      if (ctx.suite === "mock") {
        const ids = models.map((model) => model.id).sort();
        if (ids.join() !== MOCK.catalog.join()) return fail(`ids ${ids.join()}`);
        if (!models.every((model) => model.installed && model.mock)) {
          return fail("mock models must report installed=true and mock=true");
        }
        return pass(ids.join(", "));
      }
      const target = models.find((model) => model.id === ctx.model);
      if (!target) return fail(`model ${ctx.model} is not in the catalog`, true);
      ctx.summary.installed = target.installed;
      if (!target.installed) {
        return fail(
          `${ctx.model} installed=false — run scripts/download_models.py --model ${ctx.model}`,
          true
        );
      }
      return pass(`${ctx.model} installed`);
    },
  },

  load: {
    label: "POST /api/models/load",
    run: async (ctx) => {
      const started = performance.now();
      const response = await request(
        "POST",
        "/api/models/load",
        { model: ctx.model },
        ctx.timeoutMs
      );
      const seconds = (performance.now() - started) / 1000;
      ctx.summary.load_seconds = Number(seconds.toFixed(2));
      if (response.status !== 200) {
        return fail(`${describe(response)} (${seconds.toFixed(2)}s)`, true);
      }
      const loaded = response.body.loaded_model;
      return loaded === ctx.model
        ? pass(`${loaded} in ${seconds.toFixed(2)}s`)
        : fail(`loaded_model ${loaded}`);
    },
  },

  loadedFlag: {
    label: "loaded flag follows the model",
    run: async (ctx) => {
      const response = await request("GET", "/api/models", undefined, ctx.timeoutMs);
      const loaded = (response.body.models || []).filter((model) => model.loaded).map((m) => m.id);
      return loaded.length === 1 && loaded[0] === ctx.model
        ? pass(loaded[0])
        : fail(`loaded ${JSON.stringify(loaded)}`);
    },
  },

  unload: {
    label: "POST /api/models/unload",
    run: async (ctx) => {
      const response = await request("POST", "/api/models/unload", undefined, ctx.timeoutMs);
      if (response.status !== 200) return fail(describe(response));
      return response.body.success === true && response.body.loaded_model === null
        ? pass("loaded_model null")
        : fail(describe(response));
    },
  },

  transcribe: {
    label: "POST /api/transcribe",
    run: async (ctx) => {
      ctx.progress("inference running…");
      const response = await request("POST", "/api/transcribe", { path: ctx.file }, ctx.timeoutMs);
      if (response.status !== 200) return fail(describe(response), true);
      const payload = response.body;
      ctx.artifacts.push({ stem: mediaStem(ctx.file), tag: "transcribe", payload });

      const problems = [];
      if (payload.success !== true) problems.push("success");
      if (payload.mock !== ctx.expectMock) problems.push(`mock ${payload.mock}`);
      if (payload.model !== ctx.model) problems.push(`model ${payload.model}`);
      if (sortedKeys(payload).join() !== expectedKeys(true)) {
        problems.push(`schema ${sortedKeys(payload).join()}`);
      }
      if (!timelineOk(payload)) problems.push("timeline");

      ctx.summary.duration = payload.duration;
      ctx.summary.processing_time = payload.processing_time;
      ctx.summary.speed = payload.speed;
      ctx.summary.segments = payload.segments.length;
      ctx.summary.first_text = payload.segments.length ? payload.segments[0].text : "";

      if (ctx.suite === "mock") {
        if (payload.text !== MOCK.transcribeText) problems.push("text");
        if (payload.language !== "ja") problems.push(`language ${payload.language}`);
        if (payload.segments.length !== 2) problems.push(`segments ${payload.segments.length}`);
      } else {
        if (payload.language !== ctx.language) problems.push(`language ${payload.language}`);
        if (normalize(payload.text) !== normalize(payload.segments.map((s) => s.text).join(""))) {
          problems.push("text != concat(segments)");
        }
        if (!(payload.duration > 0)) problems.push("duration");
        if (!metricsOk(payload)) {
          problems.push(`metrics rtf=${payload.realtime_factor} speed=${payload.speed}`);
        }
      }

      return problems.length
        ? fail(problems.join("; "), true)
        : pass(`${payload.segments.length} segments · ${response.seconds.toFixed(2)}s`);
    },
  },

  translate: {
    label: "POST /api/translate-audio (mock)",
    run: async (ctx) => {
      ctx.progress("inference running…");
      const response = await request(
        "POST",
        "/api/translate-audio",
        { path: ctx.file },
        ctx.timeoutMs
      );
      if (response.status !== 200) return fail(describe(response), true);
      const payload = response.body;
      ctx.artifacts.push({ stem: mediaStem(ctx.file), tag: "zh", payload });

      const keys = sortedKeys(payload);
      const problems = [];
      if (payload.model !== MOCK.translateModel) problems.push(`model ${payload.model}`);
      if (payload.text !== MOCK.translateText) problems.push("text");
      if (payload.source_language !== "ja") problems.push(`source ${payload.source_language}`);
      if (payload.target_language !== "zh-CN") problems.push(`target ${payload.target_language}`);
      if ("language" in payload) problems.push("language must be absent");
      if (keys.join() !== expectedKeys(false)) {
        problems.push(`schema ${keys.join()}`);
      }
      return problems.length ? fail(problems.join("; ")) : pass(`${payload.segments.length} segments`);
    },
  },

  outputJson: {
    label: "output JSON written (GET /api/output)",
    run: async (ctx) => {
      const names = [];
      for (const artifact of ctx.artifacts) {
        const name = `${artifact.stem}.${artifact.tag}.json`;
        const response = await request("GET", `/api/output/${name}`, undefined, ctx.timeoutMs);
        if (response.status !== 200) return fail(`${name}: ${describe(response)}`);
        const stored = response.body;
        if (stored.profile !== artifact.payload.profile) {
          return fail(`${name}: profile ${stored.profile}`);
        }
        if ((stored.segments || []).length !== artifact.payload.segments.length) {
          return fail(`${name}: segments ${(stored.segments || []).length}`);
        }
        names.push(name);
      }
      return pass(names.join(", "));
    },
  },

  outputSrt: {
    label: "output SRT written with standard timestamps",
    run: async (ctx) => {
      const names = [];
      for (const artifact of ctx.artifacts) {
        const name = `${artifact.stem}.${artifact.tag}.srt`;
        const response = await request("GET", `/api/output/${name}`, undefined, ctx.timeoutMs);
        if (response.status !== 200) return fail(`${name}: ${describe(response)}`);
        const blocks = (response.text.match(SRT_LINE) || []).length;
        if (blocks !== artifact.payload.segments.length) {
          return fail(`${name}: ${blocks} blocks for ${artifact.payload.segments.length} segments`);
        }
        if (ctx.suite === "mock" && artifact.tag === "transcribe") {
          if (!response.text.includes(MOCK.srtBlock)) return fail(`${name}: spec block missing`);
        }
        names.push(`${name} (${blocks})`);
      }
      return pass(names.join(", "));
    },
  },

  mirrors: {
    label: "output JSON mirrors the response",
    run: async (ctx) => {
      for (const artifact of ctx.artifacts) {
        const name = `${artifact.stem}.${artifact.tag}.json`;
        const response = await request("GET", `/api/output/${name}`, undefined, ctx.timeoutMs);
        if (response.status !== 200) return fail(`${name}: ${describe(response)}`);
        if (response.body.text !== artifact.payload.text) return fail(`${name}: text differs`);
      }
      return pass(`${ctx.artifacts.length} artifact(s)`);
    },
  },

  emptyPath: {
    label: "empty path rejected with 422",
    run: async (ctx) => {
      const response = await request("POST", "/api/transcribe", { path: "" }, ctx.timeoutMs);
      return response.status === 422 ? pass("422") : fail(describe(response));
    },
  },

  missingFile: {
    label: "missing file rejected with 422 (real)",
    run: async (ctx) => {
      const separator = ctx.file.includes("\\") ? "\\" : "/";
      const parent = ctx.file.split(/[\\/]+/).slice(0, -1).join(separator);
      const response = await request(
        "POST",
        "/api/transcribe",
        { path: `${parent}${separator}definitely-missing.flac` },
        ctx.timeoutMs
      );
      return response.status === 422 ? pass("422") : fail(describe(response));
    },
  },

  unsupportedType: {
    label: "unsupported type rejected with 400 (real)",
    run: async (ctx) => {
      const response = await request(
        "POST",
        "/api/transcribe",
        { path: "config.toml" },
        ctx.timeoutMs
      );
      return response.status === 400 ? pass("400") : fail(describe(response));
    },
  },

  busy: {
    label: "concurrent request gets 409",
    run: async (ctx) => {
      ctx.progress("holding the engine with a real request…");
      const first = request("POST", "/api/transcribe", { path: ctx.file }, ctx.timeoutMs);
      await sleep(300);
      const second = await request("POST", "/api/transcribe", { path: ctx.file }, ctx.timeoutMs);
      const settled = await first;

      if (second.status === 409) {
        const bodyOk = second.body && second.body.detail === "Inference engine is busy";
        if (!bodyOk) return fail(`409 but body ${second.text.slice(0, 80)}`);
        return settled.status === 200
          ? pass("409 while busy · first still 200")
          : fail(`first request ended ${describe(settled)}`);
      }
      if (second.status === 0 || second.status === -1) return fail(`second request ${second.text}`);
      return skip(
        `INCONCLUSIVE: second got ${second.status} because inference finished in under ` +
          `0.3s — re-run with longer audio (minutes, not seconds).`
      );
    },
  },

  pages: {
    label: "UI and docs served",
    run: async (ctx) => {
      const wanted = [
        ["/", "local trans api demo"],
        ["/docs", "swagger"],
        ["/app.js", "pollstatus"],
        ["/diagnostics.html", "acceptance runner"],
      ];
      for (const [path, needle] of wanted) {
        const response = await request("GET", path, undefined, ctx.timeoutMs);
        if (response.status !== 200) return fail(`${path} ${describe(response)}`);
        if (!response.text.toLowerCase().includes(needle)) {
          return fail(`${path} does not contain "${needle}"`);
        }
      }
      return pass(wanted.map(([path]) => path).join(" "));
    },
  },
};

const SUITES = {
  mock: [
    "health",
    "idle",
    "engine",
    "catalog",
    "load",
    "loadedFlag",
    "unload",
    "transcribe",
    "translate",
    "outputJson",
    "outputSrt",
    "mirrors",
    "emptyPath",
    "busy",
    "pages",
  ],
  real: [
    "health",
    "idle",
    "engine",
    "device",
    "catalog",
    "load",
    "transcribe",
    "outputJson",
    "outputSrt",
    "mirrors",
    "emptyPath",
    "missingFile",
    "unsupportedType",
    "busy",
    "pages",
  ],
};

function selectedSuite() {
  return document.querySelector('input[name="suite"]:checked').value;
}

function buildChecklist(suite) {
  activeSuite = suite;
  els.checks.textContent = "";
  rows = {};
  for (const id of SUITES[suite]) {
    const details = document.createElement("details");
    details.className = "check";

    const summary = document.createElement("summary");
    const dot = document.createElement("span");
    dot.className = "dot";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = CHECKS[id].label;
    const state = document.createElement("span");
    state.className = "state";
    state.textContent = "pending";
    summary.append(dot, name, state);

    const detail = document.createElement("pre");
    detail.className = "detail";

    details.append(summary, detail);
    els.checks.append(details);
    rows[id] = { details, dot, state, detail };
  }
  updateCount(suite);
}

function updateCount(suite) {
  const states = Object.values(rows).map((row) => row.state.textContent);
  const passed = states.filter((text) => text === "pass").length;
  const failed = states.filter((text) => text === "fail").length;
  const skipped = states.filter((text) => text === "skip").length;
  els.count.textContent =
    `${passed}/${SUITES[suite].length} passed` +
    (failed ? ` · ${failed} failed` : "") +
    (skipped ? ` · ${skipped} inconclusive` : "");
}

function setRow(id, state, detail) {
  const row = rows[id];
  if (!row) return;
  row.state.textContent = state;
  row.dot.className = `dot ${state}`;
  if (detail !== undefined) {
    row.detail.textContent = detail;
    row.details.open = state === "fail";
  }
  if (activeSuite) updateCount(activeSuite);
}

function renderSummary(summary) {
  lastSummary = summary;
  els.summary.textContent = "";
  for (const [key, value] of Object.entries(summary)) {
    const item = document.createElement("div");
    item.className = "metric";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = key;
    const cell = document.createElement("span");
    cell.className = "value";
    cell.textContent = String(value);
    item.append(label, cell);
    els.summary.append(item);
  }
  els.copy.disabled = false;
}

function showBanner(message) {
  els.banner.textContent = message;
  els.banner.hidden = !message;
}

async function runChecks() {
  const suite = selectedSuite();
  const ids = SUITES[suite];
  buildChecklist(suite);
  showBanner("");
  els.run.disabled = true;
  els.stop.disabled = false;
  els.copy.disabled = true;
  abortController = new AbortController();

  const ctx = {
    suite,
    file: els.file.value,
    model: els.model.value.trim(),
    language: els.language.value.trim(),
    expectDevice: els.device.value,
    timeoutMs: Math.max(1, Number(els.timeout.value) || 60) * 1000,
    expectEngine: suite === "mock" ? "mock" : "faster-whisper",
    expectMock: suite === "mock",
    artifacts: [],
    summary: {},
    status: {},
    progress(message) {
      const running = ids.find((id) => rows[id].state.textContent === "running");
      if (running) setRow(running, "running", message);
    },
  };

  let stopped = false;
  for (const id of ids) {
    if (stopped || abortController.signal.aborted) {
      setRow(id, "skip", "not run");
      continue;
    }
    setRow(id, "running", "");
    rows[id].details.open = false;
    let result;
    try {
      result = await CHECKS[id].run(ctx);
    } catch (error) {
      result = fail(`runner error: ${error.message}`);
    }
    if (result.skip) {
      setRow(id, "skip", result.detail);
      continue;
    }
    setRow(id, result.ok ? "pass" : "fail", result.detail);
    if (!result.ok && result.stop) {
      stopped = true;
      showBanner(`${CHECKS[id].label} failed — the rest of the suite needs it.`);
    }
  }

  ctx.summary.engine = ctx.summary.engine || "-";
  renderSummary(ctx.summary);
  abortController = null;
  els.run.disabled = false;
  els.stop.disabled = true;
}

function copySummary() {
  if (!lastSummary) return;
  const text = JSON.stringify(lastSummary, null, 2);
  const done = () => {
    els.copy.textContent = "Copied";
    setTimeout(() => (els.copy.textContent = "Copy summary"), 1200);
  };
  navigator.clipboard.writeText(text).then(done, () => {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    done();
  });
}

function formatBytes(value) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** index;
  return `${scaled.toFixed(index === 0 || scaled >= 100 ? 0 : 2)} ${units[index]}`;
}

async function loadEnv() {
  const response = await request("GET", "/api/setup/env", undefined, 15000);
  if (response.status !== 200) {
    els.envState.textContent = `unreachable (${response.status || response.text})`;
    return;
  }
  env = response.body;
  els.envState.textContent =
    `${env.engine} · ${env.cuda_devices} GPU · ${formatBytes(env.disk_free_bytes)} free`;
  renderEnv();
  renderModels();
  warnIfModelMissing();
}

function envRow(label, value, tone) {
  const item = document.createElement("div");
  item.className = "metric";
  const name = document.createElement("span");
  name.className = "label";
  name.textContent = label;
  const cell = document.createElement("span");
  cell.className = `value ${tone || ""}`;
  cell.textContent = value;
  item.append(name, cell);
  return item;
}

function renderEnv() {
  els.env.textContent = "";
  const deps = env.ai_dependencies;
  const depsOk = deps.faster_whisper && deps.ctranslate2 && deps.huggingface_hub;
  els.env.append(
    envRow("config", env.config_path),
    envRow("engine / device", `${env.engine} · ${env.device} · ${env.compute_type}`),
    envRow(
      "AI deps",
      depsOk ? "installed" : `missing: ${Object.entries(deps).filter(([, on]) => !on).map(([name]) => name).join(", ")}`,
      depsOk ? "state-ok" : "state-error"
    ),
    envRow("CUDA devices", String(env.cuda_devices), env.cuda_devices ? "state-ok" : "state-idle"),
    envRow("HF endpoint", env.hf_endpoint),
    envRow("models dir", env.models_directory)
  );
  if (!depsOk) {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = `先在项目目录执行：${env.install_command}`;
    els.env.append(hint);
  }
}

function renderModels() {
  els.models.textContent = "";
  modelRows = {};
  for (const model of env.models) {
    const row = document.createElement("div");
    row.className = "modelrow";

    const title = document.createElement("div");
    title.className = "modeltitle";
    title.textContent = `${model.name} · ${model.id}`;

    const badge = document.createElement("span");
    badge.className = `badge ${model.installed ? "ok" : "warn"}`;
    badge.textContent = model.installed
      ? "installed"
      : `missing ${model.missing_files.join(", ")}`;

    const meta = document.createElement("div");
    meta.className = "modelmeta";
    meta.textContent = `${model.repo_id} · ${formatBytes(model.bytes_on_disk)} on disk`;

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = model.installed ? "Re-check" : "Download";
    button.addEventListener("click", () => startDownload(model.id));

    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("i");
    bar.append(fill);
    const progress = document.createElement("div");
    progress.className = "progress";
    progress.textContent = model.installed
      ? "ready"
      : model.bytes_on_disk
        ? `${formatBytes(model.bytes_on_disk)} already on disk — Download resumes`
        : "not downloaded";

    row.append(title, badge, meta, bar, progress, button);
    els.models.append(row);
    modelRows[model.id] = { badge, fill, progress, button };
  }
}

async function startDownload(modelId) {
  const body = { model: modelId, endpoint: els.endpoint.value.trim() };
  const response = await request("POST", "/api/setup/download", body, 20000);
  if (response.status !== 200) {
    showBanner(`下载未启动：${response.status} ${(response.text || "").slice(0, 160)}`);
    return;
  }
  showBanner("");
  for (const row of Object.values(modelRows)) row.button.disabled = true;
  if (!progressTimer) progressTimer = setInterval(pollProgress, 1000);
  pollProgress();
}

async function pollProgress() {
  const response = await request("GET", "/api/setup/download", undefined, 15000);
  const job = response.body || {};
  const row = modelRows[job.model_id];
  if (row && job.state === "running") {
    const ratio = job.total_bytes ? job.downloaded_bytes / job.total_bytes : 0;
    row.fill.style.width = `${Math.min(100, ratio * 100).toFixed(1)}%`;
    row.progress.textContent =
      `${formatBytes(job.downloaded_bytes)} / ${job.total_bytes ? formatBytes(job.total_bytes) : "?"}` +
      ` · ${formatBytes(job.bytes_per_second)}/s · ${job.seconds}s`;
  }
  if (job.state === "done" || job.state === "failed") {
    clearInterval(progressTimer);
    progressTimer = null;
    if (row) {
      row.progress.textContent = job.state === "done" ? "done" : job.error;
      if (job.state === "failed") showBanner(job.error);
    }
    await loadEnv();
  }
}

function warnIfModelMissing() {
  if (selectedSuite() !== "real" || !env) {
    els.setupHint.textContent = "";
    return;
  }
  const target = env.models.find((model) => model.id === els.model.value.trim());
  els.setupHint.textContent = !target
    ? `模型 ${els.model.value} 不在目录里，验收页会按 catalog 断言失败。`
    : target.installed
      ? `${target.id} 已就绪，可以直接跑 Phase 2 套件。`
      : `${target.id} 还没下载：点上面的 Download，或先跑 Phase 0 套件。`;
}

async function pollEngineLine() {
  const response = await request("GET", "/api/status", undefined, 5000);
  if (response.status !== 200) {
    els.engineLine.textContent = "Engine: unreachable";
    return;
  }
  const status = response.body;
  els.engineLine.textContent =
    `Engine: ${status.engine} · device: ${status.device} · ` +
    `loaded: ${status.loaded_model || "None"} · ${status.status}`;
}

function applySuiteDefaults() {
  const suite = selectedSuite();
  if (suite === "mock") {
    els.file.value = "D:\\ASMR\\test.flac";
    els.model.value = "whisper-ja-1.5b";
    els.language.value = "ja";
    els.timeout.value = "60";
  } else {
    els.file.value = "D:\\ASMR\\test.flac";
    els.model.value = "whisper-ja-1.5b";
    els.language.value = "ja";
    els.timeout.value = "900";
  }
  buildChecklist(suite);
  warnIfModelMissing();
}

async function resumeProgress() {
  const response = await request("GET", "/api/setup/download", undefined, 15000);
  if (response.status === 200 && response.body.state === "running") {
    for (const row of Object.values(modelRows)) row.button.disabled = true;
    progressTimer = setInterval(pollProgress, 1000);
    pollProgress();
  }
}

document.querySelectorAll('input[name="suite"]').forEach((input) => {
  input.addEventListener("change", applySuiteDefaults);
});
els.run.addEventListener("click", runChecks);
els.stop.addEventListener("click", () => {
  if (abortController) abortController.abort();
  showBanner("Stopped: the browser gave up, but the server keeps the engine busy until the in-flight inference finishes.");
});
els.copy.addEventListener("click", copySummary);
els.refreshEnv.addEventListener("click", loadEnv);
els.model.addEventListener("change", warnIfModelMissing);

applySuiteDefaults();
pollEngineLine();
setInterval(pollEngineLine, 2000);
loadEnv().then(resumeProgress);
