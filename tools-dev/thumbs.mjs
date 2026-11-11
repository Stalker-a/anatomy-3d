// Превью карточек моделей и регионов: node tools-dev/thumbs.mjs <url сайта> [id…]
// Снимает сцену в режиме ?thumb= и сохраняет public/thumbs/<id>.webp (прозрачный фон).
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const [url, ...only] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync("public/data/t1-arthrology.json", "utf-8"));
const jobs = [
  ...data.chapters.map((c) => ({ id: c.id, q: c.id })),
  ...data.regions.map((r) => ({ id: "region-" + r.id, q: "region:" + r.id })),
].filter((j) => !only.length || only.includes(j.id));

fs.mkdirSync("public/thumbs", { recursive: true });
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.setViewport({ width: 640, height: 480, deviceScaleFactor: 1 });
for (const j of jobs) {
  await page.goto(`${url}?thumb=${encodeURIComponent(j.q)}`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.__thumbReady, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: `public/thumbs/${j.id}.webp`, type: "webp", quality: 82, omitBackground: true });
  console.log("ok", j.id);
}
await browser.close();
