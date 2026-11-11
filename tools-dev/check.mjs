// Проверка сайта в настоящем Chrome: node tools-dev/check.mjs <url> <out-dir> [mobile]
import puppeteer from "puppeteer-core";

const [url, out, mobile] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(`${m.type()}: ${m.text()}`); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
await page.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1400, height: 860 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name, full = false) => {
  if (full) {
    // Ленивые картинки ниже первого экрана — загрузить сразу, иначе на снимке пустые карточки
    await page.evaluate(() => document.querySelectorAll("img[loading=lazy]").forEach((i) => (i.loading = "eager")));
    await page.waitForNetworkIdle();
  }
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
};

// Главная и регион
await page.goto(url, { waitUntil: "networkidle0" });
await wait(500);
await shot("a-home", true);
await page.goto(url + "#/r/upper", { waitUntil: "networkidle0" });
await wait(500);
await shot("b-region", true);

// Модель «Коленный сустав»: описание, затем термин
await page.goto(url + "#/m/knee", { waitUntil: "networkidle0" });
await page.waitForSelector("#loading.hidden", { timeout: 60000 });
await wait(4000);
await shot("c-model");
await page.click('[data-tab="parts"]');
await page.evaluate(() => [...document.querySelectorAll("#tabParts .row")].find((b) => b.textContent.includes("Передняя крестообразная"))?.click());
await wait(4000);
await shot("d-term");
await page.click('[data-view="lat"]');
await wait(3500);
await shot("e-lateral");

// Точка на кости в плечевом суставе по прямой ссылке через поиск
await page.evaluate(() => { location.hash = "#/m/shoulder"; });
await wait(3500);
await page.click('[data-tab="parts"]');
await page.evaluate(() => [...document.querySelectorAll("#tabParts .row")].find((b) => b.textContent.includes("Головка плечевой"))?.click());
await wait(4000);
await shot("f-point");

// Тест
await page.click('[data-tab="quiz"]');
await wait(4000);
await shot("g-quiz");

// Поиск
await page.type("#search", "мениск");
await wait(300);
await shot("h-search");

console.log(errors.length ? errors.join("\n") : "консоль без ошибок");
await browser.close();
