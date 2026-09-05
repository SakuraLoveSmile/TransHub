// TransHub 验收：CDP 真实视口布局探测 + Mock 全流程（选文件→提交→结果→下载）。
// 用法: node scripts/cdp-acceptance.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = path.resolve("acceptance-shots");
const PORT = 9333;
fs.mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  `--remote-debugging-port=${PORT}`,
  "--user-data-dir=/tmp/transhub-cdp-profile",
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWS() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(300);
  }
  throw new Error("CDP not ready");
}

let msgId = 0;
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    ws.onopen = () =>
      resolve({
        ws,
        call(method, params = {}) {
          const id = ++msgId;
          return new Promise((res, rej) => {
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        onEvent: (fn) => {
          ws.onmessage = (ev) => {
            const data = JSON.parse(ev.data);
            if (data.id && pending.has(data.id)) {
              const p = pending.get(data.id);
              pending.delete(data.id);
              if (data.error) p.rej(new Error(data.error.message));
              else p.res(data.result);
            } else if (data.method) {
              fn(data.method, data.params);
            }
          };
        },
      });
    ws.onerror = reject;
  });
}

const cdp = await connect(await getWS());
const { ws, call, onEvent } = cdp;
onEvent(() => {});

async function setViewport(w, h) {
  await call("Emulation.setDeviceMetricsOverride", {
    width: w, height: h, deviceScaleFactor: 1, mobile: false,
  });
}

async function navigate(url) {
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.navigate", { url });
  await sleep(2500);
}

async function evalJs(expr) {
  const r = await call("Runtime.evaluate", {
    expression: expr, returnByValue: true, awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
}

async function screenshot(name) {
  const shot = await call("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.data, "base64"));
  console.log("shot", name);
}

async function probe(width, height, name) {
  await setViewport(width, height);
  await navigate("http://localhost:5173/");
  const metrics = await evalJs(`(() => {
    const doc = document.documentElement;
    const panels = [...document.querySelectorAll('.panel')].map((p) => {
      const r = p.getBoundingClientRect();
      return { cls: p.className, x: Math.round(r.x), w: Math.round(r.width) };
    });
    const status = document.querySelector('.status-strip');
    const ws = document.querySelector('.workspace');
    return JSON.stringify({
      scrollWidth: doc.scrollWidth,
      innerWidth: window.innerWidth,
      cramped: doc.scrollWidth > window.innerWidth,
      workspaceCols: ws ? getComputedStyle(ws).gridTemplateColumns : null,
      statusRect: status ? {
        x: Math.round(status.getBoundingClientRect().x),
        w: Math.round(status.getBoundingClientRect().width),
      } : null,
      panels,
    });
  })()`);
  console.log(name, metrics);
  await screenshot(name);
  return metrics;
}

await probe(1440, 960, "cdp-desktop-1440");
await probe(1024, 900, "cdp-tablet-1024");
await probe(768, 1000, "cdp-tablet-768");
await probe(390, 844, "cdp-mobile-390");

// ---------- Mock 全流程 ----------
await setViewport(1280, 900);
await navigate("http://localhost:5173/");

// 选择 sample 文件（通过 DOM.setFileInputFiles 真实设置）
const filePath = path.resolve("local-trans-api-demo/samples/1.flac");
const input = await call("Runtime.evaluate", {
  expression: `document.querySelector('#media')`,
});
const nodeId = (await call("DOM.enable") && await call("DOM.getDocument")) && null;
// 使用 DOM.querySelector 获取 nodeId
await call("DOM.enable");
const doc = await call("DOM.getDocument", { depth: -1 });
const found = await call("DOM.querySelector", {
  nodeId: doc.root.nodeId,
  selector: "#media",
});
await call("DOM.setFileInputFiles", {
  files: [filePath],
  nodeId: found.nodeId,
});
await sleep(800);
const picked = await evalJs(`(() => {
  const t = document.querySelector('.file-picker');
  return t ? t.innerText.replace(/\\n/g, ' | ') : 'no-picker';
})()`);
console.log("picked:", picked);

// 切换为日语转录（默认已是 transcribe），点击生成字幕
await evalJs(`(() => {
  const btn = document.querySelector('form button[type="submit"], .button-primary');
  if (btn) btn.click();
})()`);
console.log("submit clicked");

// 等待轮询（Mock 推理约 1-2s，轮询 2s/5s）
for (let i = 0; i < 20; i++) {
  await sleep(1500);
  const state = await evalJs(`(() => {
    const cards = document.querySelectorAll('.task-card');
    const last = cards[0];
    return last ? last.innerText.replace(/\\n/g, ' | ').slice(0, 160) : 'no-cards';
  })()`);
  console.log(`poll ${i}:`, state);
  if (/已受理|已完成|下载 SRT/.test(state)) break;
}

// 展开全文 + 复制文本 + 下载链接
const detail = await evalJs(`(() => {
  const card = document.querySelector('.task-card');
  return card ? card.innerText : 'none';
})()`);
console.log("card detail:", detail.replace(/\n/g, " | ").slice(0, 400));
await screenshot("mock-flow-result");

ws.close();
chrome.kill();
console.log("done");
