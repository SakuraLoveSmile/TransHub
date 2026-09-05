/* TransHub 深色工具台浏览器验收脚本（playwright-core + 本机 Chrome for Testing）。 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8977";
const OUT = process.env.OUT_DIR || "/tmp/transhub-acceptance";
const SAMPLE = process.env.SAMPLE_FILE;
const CHROME =
  process.env.CHROME_PATH ||
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const results = [];
function log(line) {
  results.push(line);
  console.log(line);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });

  // ---- 1. 四档宽度：横向溢出检查 + 截图 ----
  const viewports = [
    { name: "1440", width: 1440, height: 900 },
    { name: "1024", width: 1024, height: 768 },
    { name: "768", width: 768, height: 1024 },
    { name: "390", width: 390, height: 844 },
  ];
  for (const vp of viewports) {
    const page = await browser.newPage({
      viewport: { width: vp.width, height: vp.height },
    });
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForSelector("text=已连接", { timeout: 10000 });
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    log(`viewport ${vp.name}: 横向溢出 ${overflow}px`);
    await page.screenshot({ path: path.join(OUT, `v${vp.name}_home.png`), fullPage: true });
    await page.close();
  }

  // ---- 2. 主流程（1440px）----
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("text=已连接", { timeout: 10000 });

  const asset = await page.evaluate(
    () =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((n) => n.includes("/assets/index-")) || "(none)",
  );
  log(`加载的 JS 资源: ${asset}`);
  log(`状态条: ${(await page.locator(".status-bar").innerText()).replace(/\n/g, " | ")}`);
  log(`空状态可见: ${(await page.locator("text=暂无任务").count()) > 0}`);

  // 键盘可达性：从 body 开始 Tab，记录前若干个焦点元素
  const focusTrail = [];
  await page.evaluate(() => document.body.focus());
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Tab");
    const desc = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return "(none)";
      const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24);
      const value = el.getAttribute && el.getAttribute("value");
      return `${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ""}${value ? `=${value}` : ""} "${text}"`;
    });
    focusTrail.push(desc);
  }
  log(`Tab 顺序: ${focusTrail.join(" -> ")}`);

  // 键盘选择处理方式：焦点移到单选框后用方向键切换
  await page.locator('input[type="radio"][value="translate"]').focus();
  await page.keyboard.press(" ");
  const translateChecked = await page.locator('input[type="radio"][value="translate"]').isChecked();
  log(`键盘选中翻译模式: ${translateChecked}`);

  // 选择文件并提交
  await page.setInputFiles('.file-picker input[type="file"]', SAMPLE);
  await page.waitForSelector(".file-picker .file-name");
  log(`已选文件: ${await page.locator(".file-picker .file-name").innerText()}`);
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=已受理，任务编号", { timeout: 15000 });
  await page.screenshot({ path: path.join(OUT, "flow_accepted.png"), fullPage: true });
  log("提交受理: 已展示任务编号");

  // 等待完成
  await page.waitForSelector(".badge-status-succeeded", { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "flow_succeeded.png"), fullPage: true });
  log("任务完成: 状态徽标=已完成");
  log(`Mock 标记: ${(await page.locator(".badge-mock").count()) > 0}`);

  // 展开全文 + 复制
  const expandBtn = page.locator("button", { hasText: "展开全文" });
  if ((await expandBtn.count()) > 0) {
    await expandBtn.first().click();
    log("展开全文: 已点击");
  } else {
    log("展开全文: 文本较短无需展开");
  }
  await page.click("button:has-text('复制文本')");
  await page.waitForSelector(".copy-status", { timeout: 8000 });
  log(`复制反馈: ${await page.locator(".copy-status").first().innerText()}`);

  // 下载 SRT / LRC
  for (const fmt of ["SRT", "LRC"]) {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 10000 }),
      page.click(`a:has-text('下载 ${fmt}')`),
    ]);
    const name = download.suggestedFilename();
    await download.saveAs(path.join(OUT, name));
    log(`下载 ${fmt}: ${name}`);
  }
  await page.screenshot({ path: path.join(OUT, "flow_final.png"), fullPage: true });

  // ---- 3. 断线状态：停掉后端后观察离线提示 ----
  log("（接下来由外部停止后端后执行断线截图）");
  fs.writeFileSync(path.join(OUT, "results.txt"), results.join("\n") + "\n");

  // 轮询等待健康检查失败（最多 30s），截图后退出
  try {
    await page.waitForSelector("text=服务离线", { timeout: 45000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT, "offline_state.png"), fullPage: true });
    const offlineText = (await page.locator(".status-bar").innerText()).replace(/\n/g, " | ");
    const alertText = await page.locator('[role="alert"]').first().innerText().catch(() => "");
    log(`断线状态: ${offlineText}`);
    log(`断线告警: ${alertText}`);
  } catch {
    log("断线状态: 未在 45s 内出现（后端可能仍在运行）");
  }

  fs.writeFileSync(path.join(OUT, "results.txt"), results.join("\n") + "\n");
  await context.close();
  await browser.close();
})().catch((error) => {
  console.error(error);
  fs.writeFileSync(path.join(OUT, "results.txt"), `${results.join("\n")}\nFATAL: ${error}\n`);
  process.exit(1);
});
