/* 断线状态验收：页面加载完成后杀掉后端进程，观察离线提示。 */
const { chromium } = require("playwright-core");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8977";
const OUT = process.env.OUT_DIR || "/tmp/transhub-acceptance";
const PORT = new URL(BASE).port;
const CHROME =
  process.env.CHROME_PATH ||
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("text=已连接", { timeout: 10000 });
  console.log("在线状态确认");

  const pid = execSync(`lsof -nP -tiTCP:${PORT} -sTCP:LISTEN`).toString().trim();
  console.log(`停止后端 PID=${pid}`);
  execSync(`kill ${pid}`);

  await page.waitForSelector("text=服务离线", { timeout: 45000 });
  await page.waitForSelector("text=任务列表刷新失败", { timeout: 45000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, "offline_state.png"), fullPage: true });
  console.log(`状态条: ${(await page.locator(".status-bar").innerText()).replace(/\n/g, " | ")}`);
  const alerts = await page.locator('[role="alert"]').allInnerTexts();
  console.log(`告警: ${alerts.join(" || ")}`);

  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
