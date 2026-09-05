/* 浏览器验收：多宽度截图 + Mock 全流程。运行：
 * NODE_PATH=/Users/sakurasep/.npm/_npx/0b9ff77863cb6e9f/node_modules node .acceptance/acceptance.cjs
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:5173";
const OUT = path.join(__dirname, "shots");
const EXECUTABLE =
  process.env.CHROME_PATH ||
  "/Users/sakurasep/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const WIDTHS = [1440, 1024, 768, 390];
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail ?? ""}`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // Mock 引擎接受任意非空 .wav 内容。
  const sample = path.join(OUT, "acceptance-sample.wav");
  fs.writeFileSync(sample, Buffer.alloc(64 * 1024, 1));

  const browser = await chromium.launch({
    executablePath: EXECUTABLE,
    headless: true,
  });

  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  });

  // 1) 多宽度截图与横向溢出检查
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    const file = path.join(OUT, `w${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    record(
      `宽度 ${width} 无横向溢出`,
      overflow.scroll <= overflow.inner,
      `scrollWidth=${overflow.scroll}`,
    );
  }

  // 2) 服务状态与新旧资源确认
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("text=已连接", { timeout: 15000 });
  record("服务状态显示已连接", true);
  const title = await page.title();
  record("页面标题为新工作台", title.includes("TransHub · 本地字幕工作台"), title);

  // 3) 键盘可用性：连续 Tab 能到达“选择文件”与处理方式单选组
  const walkTabs = async (limit) => {
    const seen = [];
    for (let i = 0; i < limit; i += 1) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        return `${el?.tagName ?? ""}:${(el?.textContent ?? "").trim()}`;
      });
      seen.push(info);
    }
    return seen;
  };
  const firstWalk = await walkTabs(6);
  record(
    "键盘可达文件选择与模式单选",
    firstWalk.some((item) => item.includes("选择文件")) &&
      firstWalk.some((item) => item.startsWith("INPUT")),
    firstWalk.join(" | "),
  );

  // 4) Mock 全流程：选择文件 → 提交 → 查看结果 → 下载
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(sample);
  await page.waitForSelector("text=acceptance-sample.wav");
  record("文件选择后显示文件名", true);

  // 选定文件后“生成字幕”应进入 Tab 顺序：移除文件 → 模式单选 → 生成字幕
  await page.locator('button:has-text("移除文件")').focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const submitFocus = await page.evaluate(() => {
    const el = document.activeElement;
    return `${el?.tagName ?? ""}:${(el?.textContent ?? "").trim()}`;
  });
  record(
    "键盘可达生成字幕按钮",
    submitFocus.includes("生成字幕"),
    `Tab 后焦点 = ${submitFocus}`,
  );

  await page.getByRole("radio", { name: /日语翻译成中文/ }).check();
  await page.getByRole("button", { name: "生成字幕" }).click();
  await page.waitForSelector("text=已受理，任务编号：", { timeout: 15000 });
  record("提交后显示受理编号", true);

  await page.waitForSelector("text=模拟结果", { timeout: 60000 });
  await page.waitForSelector('a:has-text("下载 SRT")', { timeout: 60000 });
  record("任务完成后展示模拟标记与下载", true);

  const srtHref = await page.locator('a:has-text("下载 SRT")').first().getAttribute("href");
  const lrcHref = await page.locator('a:has-text("下载 LRC")').first().getAttribute("href");
  record("SRT 下载地址有效", Boolean(srtHref && srtHref.includes("format=srt")), srtHref);
  record("LRC 下载地址有效", Boolean(lrcHref && lrcHref.includes("format=lrc")), lrcHref);

  // 真正下载一次 SRT，确认产物可获取
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    page.locator('a:has-text("下载 SRT")').first().click(),
  ]);
  const downloaded = path.join(OUT, download.suggestedFilename());
  await download.saveAs(downloaded);
  const srtHead = fs.readFileSync(downloaded, "utf8").slice(0, 80).replace(/\n/g, " ");
  record("SRT 下载成功", fs.statSync(downloaded).size > 0, srtHead);

  // 5) 复制文本反馈（限定在任务卡片内，避免命中服务状态条）
  await page.locator('li.task button:has-text("复制文本")').first().click();
  const copied = await page.waitForSelector('li.task [role="status"]', { timeout: 5000 });
  const copyText = (await copied.textContent()) ?? "";
  record("复制反馈", copyText.includes("已复制"), copyText.trim());

  // 6) 空文件校验提示
  const empty = path.join(OUT, "empty.wav");
  fs.writeFileSync(empty, Buffer.alloc(0));
  await input.setInputFiles(empty);
  const alert = await page.waitForSelector('[role="alert"]', { timeout: 5000 });
  record("空文件提示", ((await alert.textContent()) ?? "").includes("文件为空"));

  await page.screenshot({ path: path.join(OUT, "flow-final.png"), fullPage: true });

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== 汇总: ${results.length - failed.length}/${results.length} 通过 ====`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error("ACCEPTANCE ERROR:", error);
  process.exit(2);
});
