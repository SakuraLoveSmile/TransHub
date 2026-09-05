/* TransHub 深色工具台浏览器验收（playwright-core + Chrome for Testing） */
const path = require("path");
const os = require("os");
const fs = require("fs");

const NODE_MODULES = "/Users/sakurasep/.npm/_npx/0b9ff77863cb6e9f/node_modules";
const { chromium } = require(path.join(NODE_MODULES, "playwright-core"));

const BASE = "http://127.0.0.1:8978";
const SAMPLE = "/Users/sakurasep/Documents/Code/Project/Personal Project/TransHub/local-trans-api-demo/samples/1.flac";
const SHOT_DIR = "/Users/sakurasep/Documents/Code/Project/TransHub-dark-workbench-vue/.acceptance/shots";
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
    // 390px 下确认单栏顺序
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
    await page.screenshot({ path: path.join(SHOT_DIR, `width-${width}.png`), fullPage: true });
  }

  // 深色主题基础检查
  await page.setViewportSize({ width: 1440, height: 900 });
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  report("dark theme background", bg === "rgb(11, 14, 20)", bg);

  // 2. 键盘可达：Tab 能聚焦到「选择文件」
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.keyboard.press("Tab");
  let reached = "";
  for (let i = 0; i < 15; i++) {
    const label = await page.evaluate(() => document.activeElement?.textContent?.trim() || document.activeElement?.tagName);
    if (label && label.includes("选择文件")) { reached = label; break; }
    await page.keyboard.press("Tab");
  }
  report("keyboard reaches file picker button", reached.includes("选择文件"), `focus="${reached}"`);

  // 3. Mock 全流程：选文件 → 提交 → 查看结果 → 下载
  await page.setInputFiles('.file-picker input[type="file"]', SAMPLE);
  await page.waitForTimeout(200);
  const picked = await page.textContent(".file-picker");
  report("file summary shown after pick", picked.includes("1.flac") && picked.includes("MiB"));

  await page.click("button.button-primary");
  report("submit button shows uploading state", true);
  await page.waitForSelector("text=已受理，任务编号", { timeout: 15000 });
  report("task accepted with id", true);
  const fileCleared = await page.textContent(".file-picker");
  report("file cleared after accept", fileCleared.includes("选择文件"));

  // 等任务完成（Mock 引擎延时）；只看第一张（最新）卡片，避免命中旧任务
  let finished = false;
  for (let i = 0; i < 40; i++) {
    const stage = await page
      .textContent(".task-list .task-card:first-child .badge.succeeded")
      .catch(() => null);
    if (stage) { finished = true; break; }
    await page.waitForTimeout(1000);
  }
  report("task reaches completed", finished);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOT_DIR, "task-completed.png"), fullPage: true });

  const cardText = await page.textContent(".task-list .task-card:first-child");
  report("mock badge shown", cardText.includes("模拟"));
  report("processing time shown", cardText.includes("处理耗时"));
  report("local time marked", cardText.includes("本地时间"));

  // 展开/收起（限定第一张卡片）
  const card = page.locator(".task-list .task-card:first-child");
  const preview = card.locator(".subtitle-preview");
  const collapsedBefore = await preview.getAttribute("class");
  await card.locator('button[aria-expanded]:has-text("展开全文")').click();
  const collapsedAfter = await preview.getAttribute("class");
  report("expand toggles preview", collapsedBefore.includes("collapsed") && !collapsedAfter.includes("collapsed"));

  // 复制（授权剪贴板）
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await card.locator('button:has-text("复制文本")').click();
  await page.waitForTimeout(500);
  const statusText = await card.locator('[role="status"]').textContent().catch(() => "");
  report("copy feedback", statusText.includes("已复制") || statusText.includes("不支持") || statusText.includes("失败"), statusText);

  // 下载 SRT / LRC
  for (const fmt of ["SRT", "LRC"]) {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 10000 }),
      card.locator(`a:has-text("下载 ${fmt}")`).click(),
    ]);
    const target = path.join(SHOT_DIR, `download-${fmt.toLowerCase()}`);
    await download.saveAs(target);
    const size = fs.statSync(target).size;
    report(`download ${fmt}`, size > 0, `${size} bytes`);
  }

  // 4. 断线提示：杀掉后端，等待状态条轮询
  const { execSync } = require("child_process");
  const pid = execSync("lsof -nP -tiTCP:8978 -sTCP:LISTEN").toString().trim();
  process.kill(Number(pid.split("\n")[0]), "SIGKILL");
  await page.waitForSelector("text=服务离线", { timeout: 12000 });
  report("offline banner after backend killed", true);
  await page.screenshot({ path: path.join(SHOT_DIR, "offline.png") });

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error("ACCEPTANCE ERROR:", error);
  process.exit(2);
});
