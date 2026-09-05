/* 断线场景：页面加载完成后杀掉后端，验证 ServiceStatus 出现「服务离线」 */
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");
const { chromium } = require(path.join(
  "/Users/sakurasep/.npm/_npx/0b9ff77863cb6e9f/node_modules",
  "playwright-core",
));

const BASE = "http://127.0.0.1:8978";
const SHOT_DIR = "/Users/sakurasep/Documents/Code/Project/TransHub-dark-workbench-impl-20260906/.acceptance/shots";
const CHROME = path.join(
  os.homedir(),
  "Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const beforeOffline = await page.textContent(".status-bar");
  console.log("phase before kill:", beforeOffline.trim().slice(0, 60));

  // 杀掉后端 PID
  try {
    const pid = execSync("lsof -nP -tiTCP:8978 -sTCP:LISTEN").toString().trim();
    if (pid) execSync(`kill ${pid}`);
    console.log("killed backend pid:", pid);
  } catch (e) {
    console.error("kill failed:", e.message);
  }

  // ServiceStatus 5s 轮询内应出现“服务离线”
  let offline = false;
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(500);
    const text = await page.textContent(".status-bar");
    if (text.includes("服务离线")) { offline = true; break; }
  }
  await page.screenshot({ path: path.join(SHOT_DIR, "offline.png"), fullPage: true });
  console.log(offline ? "PASS  offline indicator appears" : "FAIL  offline indicator did not appear");
  await browser.close();
  process.exit(offline ? 0 : 1);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });