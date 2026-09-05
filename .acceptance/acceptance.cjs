/* TransHub 深色工具台浏览器验收（playwright-core + Chrome for Testing） */
const path = require("path");
const os = require("os");
const fs = require("fs");

const NODE_MODULES = "/Users/sakurasep/.npm/_npx/0b9ff77863cb6e9f/node_modules";
const { chromium } = require(path.join(NODE_MODULES, "playwright-core"));

const BASE = "http://127.0.0.1:8978";
const SAMPLE = "/Users/sakurasep/Documents/Code/Project/Personal Project/TransHub/local-trans-api-demo/samples/1.flac";
const SHOT_DIR = "/Users/sakurasep/Documents/Code/Project/TransHub-dark-workbench-impl-20260906/.acceptance/shots";
const CHROME = path.join(
  os.homedir(),
  "Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);

const results = [];
function report(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();

  // 0. 确认加载的是本 worktree 的构建（hash 匹配）
  await page.goto(BASE, { waitUntil: "networkidle" });
  const titleText = await page.title();
  report(
    "loaded our worktree build (title)",
    titleText === "TransHub 本地字幕工作台",
    `title="${titleText}"`,
  );

  // 1. 四档宽度：无横向溢出 + 截图
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return { scroll: doc.scrollWidth, client: doc.clientWidth };
    });
    report(
      `width ${width}: no horizontal overflow`,
      overflow.scroll <= overflow.client,
      `scrollWidth=${overflow.scroll} clientWidth=${overflow.client}`,
    );
    if (width === 390) {
      const order = await page.evaluate(() => {
        const sections = [...document.querySelectorAll(".workspace .panel")];
        return sections.map((s) => s.getAttribute("aria-label"));
      });
      report(
        "mobile order: create panel before tasks panel",
        order[0] === "创建字幕" && order[1] === "任务记录",
        order.join(" → "),
      );
    }
    await page.screenshot({
      path: path.join(SHOT_DIR, `width-${width}.png`),
      fullPage: true,
    });
  }

  // 深色主题基础检查
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE, { waitUntil: "networkidle" });
  const bg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  report("dark theme background", bg === "rgb(11, 14, 20)", bg);

  // 2. 键盘可达：定位到「选择文件」按钮
  await page.goto(BASE, { waitUntil: "networkidle" });
  let reached = "";
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    const label = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return "";
      return el.textContent?.trim() || el.getAttribute("aria-label") || "";
    });
    if (label.includes("选择文件")) {
      reached = label;
      break;
    }
  }
  report("keyboard reaches file picker button", reached.includes("选择文件"), `focus="${reached}"`);

  // 3. Mock 全流程：选文件 → 提交 → 查看结果 → 下载
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.setInputFiles('.file-picker input[type="file"]', SAMPLE);
  await page.waitForTimeout(300);
  const picked = await page.textContent(".file-picker");
  report("file picker shows selected file", picked.includes("1.flac"), picked.slice(0, 60));

  // 点击生成字幕
  await page.click("button.button-primary");
  // 等待任务进入 succeeded
  let taskCompleted = false;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(500);
    const tasks = await page.textContent(".panel-tasks");
    if (tasks.includes("下载 SRT")) {
      taskCompleted = true;
      break;
    }
  }
  report("submitted task completes (succeeded)", taskCompleted);
  await page.screenshot({ path: path.join(SHOT_DIR, "task-completed.png"), fullPage: true });

  // 展开全文
  const expandBtn = await page.locator("button.action", { hasText: "展开全文" }).first();
  if (await expandBtn.count()) {
    await expandBtn.click();
    await page.waitForTimeout(200);
    const collapseBtn = await page.locator("button.action", { hasText: "收起" }).first();
    report("expand/collapse toggles subtitle preview", await collapseBtn.count() > 0);
  }

  // 复制文本反馈（验证 role=status 的卡片反馈，限定 li.task 之内）
  const copyBtn = await page.locator("li.task-card button.action", { hasText: "复制文本" }).first();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await copyBtn.click();
  await page.waitForTimeout(300);
  const copyStatus = await page.locator("li.task-card [role=\"status\"]").first().textContent();
  report("copy feedback appears (已复制)", copyStatus && copyStatus.includes("已复制"), `status="${copyStatus}"`);

  // 下载 SRT / LRC
  const [srtDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("li.task-card a.action", { hasText: "下载 SRT" }).first().click(),
  ]);
  const srtPath = await srtDownload.path();
  const srtSize = fs.statSync(srtPath).size;
  report("SRT download produces non-empty file", srtSize > 0, `path=${srtPath} size=${srtSize}`);
  fs.mkdirSync(path.join(SHOT_DIR, "download-srt"), { recursive: true });
  fs.copyFileSync(srtPath, path.join(SHOT_DIR, "download-srt", "subtitle.srt"));

  const [lrcDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("li.task-card a.action", { hasText: "下载 LRC" }).first().click(),
  ]);
  const lrcPath = await lrcDownload.path();
  const lrcSize = fs.statSync(lrcPath).size;
  report("LRC download produces non-empty file", lrcSize > 0, `path=${lrcPath} size=${lrcSize}`);
  fs.mkdirSync(path.join(SHOT_DIR, "download-lrc"), { recursive: true });
  fs.copyFileSync(lrcPath, path.join(SHOT_DIR, "download-lrc", "subtitle.lrc"));

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log(`\nFAILURES: ${failed.length}/${results.length}`);
    process.exit(1);
  } else {
    console.log(`\nALL PASS (${results.length})`);
  }
})().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});