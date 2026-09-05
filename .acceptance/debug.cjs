const { chromium } = require("playwright-core");

const EXECUTABLE =
  "/Users/sakurasep/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = "http://localhost:5173";

(async () => {
  const browser = await chromium.launch({ executablePath: EXECUTABLE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", (m) => console.log("[console]", m.type(), m.text().slice(0, 300)));
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 500)));
  page.on("requestfailed", (r) => console.log("[reqfail]", r.url(), r.failure()?.errorText));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  console.log("=== 初始页面文本 ===");
  console.log((await page.locator("body").innerText()).replace(/\n{2,}/g, "\n").slice(0, 1200));

  const input = page.locator('input[type="file"]');
  await input.setInputFiles({ name: "debug.wav", mimeType: "audio/wav", buffer: Buffer.alloc(1024, 1) });
  await page.getByRole("button", { name: "生成字幕" }).click();
  await page.waitForTimeout(8000);

  console.log("\n=== 提交 8 秒后 ===");
  console.log((await page.locator("body").innerText()).replace(/\n{2,}/g, "\n").slice(0, 1600));

  await page.waitForTimeout(8000);
  console.log("\n=== 再等 8 秒后 ===");
  console.log((await page.locator("body").innerText()).replace(/\n{2,}/g, "\n").slice(0, 1600));

  await browser.close();
})();
