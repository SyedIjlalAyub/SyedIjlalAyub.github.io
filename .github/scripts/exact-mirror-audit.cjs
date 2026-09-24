const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const pixelmatch = require("pixelmatch");
const { PNG } = require("pngjs");

const [mode, a, b, c] = process.argv.slice(2);
if (!mode || !a || !b) {
  console.error("Usage: exact-mirror-audit.cjs discover <origin> <output.json> | compare <source> <local> <dir>");
  process.exit(2);
}

const SOURCE_PATHS = ["/", "/subscribers.html"];
const IGNORE_PREFIXES = ["/api/", "/signin-with-chatgpt", "/cdn-cgi/"];

function normalizeOrigin(value) {
  return value.replace(/\/+$/, "");
}

function sameOriginStatic(origin, rawUrl) {
  try {
    const source = new URL(origin);
    const url = new URL(rawUrl, origin);
    if (url.origin !== source.origin) return false;
    return !IGNORE_PREFIXES.some(prefix => url.pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

async function newContext(browser, viewport, colorScheme) {
  return browser.newContext({
    viewport,
    colorScheme,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    locale: "en-US",
  });
}

async function settle(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready.catch(() => {});
    }
  });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition: none !important;
        caret-color: transparent !important;
      }
    `,
  });
  await page.waitForTimeout(250);
}

async function discover(origin, output) {
  origin = normalizeOrigin(origin);
  const browser = await chromium.launch({ headless: true });
  const context = await newContext(browser, { width: 1440, height: 1000 }, "light");
  const responses = new Map();

  for (const route of SOURCE_PATHS) {
    const page = await context.newPage();
    page.on("response", response => {
      const url = response.url();
      if (!sameOriginStatic(origin, url)) return;
      const headers = response.headers();
      responses.set(url, {
        url,
        status: response.status(),
        contentType: headers["content-type"] || "",
      });
    });

    const response = await page.goto(origin + route, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!response || response.status() >= 400) {
      throw new Error(`Live source ${route} returned ${response ? response.status() : "no response"}`);
    }
    await settle(page);
    await page.close();
  }

  await context.close();
  await browser.close();

  const payload = {
    origin,
    paths: SOURCE_PATHS,
    responses: [...responses.values()].sort((x, y) => x.url.localeCompare(y.url)),
  };
  fs.writeFileSync(output, JSON.stringify(payload, null, 2) + "\n");
  console.log(`Chromium observed ${payload.responses.length} same-origin non-dynamic responses.`);
}

function diffPng(sourceFile, localFile, diffFile) {
  const source = PNG.sync.read(fs.readFileSync(sourceFile));
  const local = PNG.sync.read(fs.readFileSync(localFile));

  if (source.width !== local.width || source.height !== local.height) {
    return {
      ratio: 1,
      pixels: source.width * source.height,
      reason: `dimensions differ: source ${source.width}x${source.height}, local ${local.width}x${local.height}`,
    };
  }

  const diff = new PNG({ width: source.width, height: source.height });
  const pixels = pixelmatch(
    source.data,
    local.data,
    diff.data,
    source.width,
    source.height,
    { threshold: 0.08, includeAA: true }
  );
  fs.writeFileSync(diffFile, PNG.sync.write(diff));
  return { ratio: pixels / (source.width * source.height), pixels, reason: "" };
}

async function capture(browser, base, route, viewport, colorScheme, file) {
  const context = await newContext(browser, viewport, colorScheme);
  const page = await context.newPage();
  const errors = [];
  page.on("requestfailed", request => {
    const url = request.url();
    // External Google Fonts may occasionally fail transiently; a visual diff
    // will still catch any resulting presentation difference.
    errors.push(`${request.failure()?.errorText || "failed"} ${url}`);
  });

  const response = await page.goto(normalizeOrigin(base) + route, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  if (!response || response.status() >= 400) {
    throw new Error(`${base}${route} returned ${response ? response.status() : "no response"}`);
  }

  await settle(page);
  const metrics = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
    title: document.title,
    bodyText: document.body.innerText,
  }));
  await page.screenshot({ path: file, fullPage: true });
  await context.close();
  return { metrics, errors };
}

async function compare(source, local, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  const cases = [
    { name: "desktop-light", viewport: { width: 1440, height: 1000 }, scheme: "light" },
    { name: "desktop-dark", viewport: { width: 1440, height: 1000 }, scheme: "dark" },
    { name: "mobile-light", viewport: { width: 390, height: 844 }, scheme: "light" },
    { name: "mobile-dark", viewport: { width: 390, height: 844 }, scheme: "dark" },
  ];

  const results = [];
  let failed = false;

  for (const test of cases) {
    for (const route of SOURCE_PATHS) {
      const safeRoute = route === "/" ? "home" : route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
      const prefix = `${test.name}-${safeRoute}`;
      const sourcePng = path.join(outputDir, `${prefix}-source.png`);
      const localPng = path.join(outputDir, `${prefix}-local.png`);
      const diffPngFile = path.join(outputDir, `${prefix}-diff.png`);

      const sourceCapture = await capture(browser, source, route, test.viewport, test.scheme, sourcePng);
      const localCapture = await capture(browser, local, route, test.viewport, test.scheme, localPng);

      const diff = diffPng(sourcePng, localPng, diffPngFile);
      const metricsMatch =
        sourceCapture.metrics.width === localCapture.metrics.width &&
        sourceCapture.metrics.height === localCapture.metrics.height &&
        sourceCapture.metrics.title === localCapture.metrics.title &&
        sourceCapture.metrics.bodyText === localCapture.metrics.bodyText;

      // Same Chromium process + same external dependencies should be nearly
      // pixel-identical. Allow only tiny rasterization/network noise.
      const visualPass = diff.ratio <= 0.001;
      const pass = metricsMatch && visualPass;
      if (!pass) failed = true;

      results.push({
        case: test.name,
        route,
        pass,
        diffRatio: diff.ratio,
        diffPixels: diff.pixels,
        diffReason: diff.reason,
        sourceMetrics: sourceCapture.metrics,
        localMetrics: localCapture.metrics,
        sourceRequestFailures: sourceCapture.errors,
        localRequestFailures: localCapture.errors,
      });

      console.log(
        `${pass ? "PASS" : "FAIL"} ${test.name} ${route}: ` +
        `pixel diff ${(diff.ratio * 100).toFixed(4)}%`
      );
    }
  }

  await browser.close();

  fs.writeFileSync(
    path.join(outputDir, "visual-comparison.json"),
    JSON.stringify(results, null, 2) + "\n"
  );

  if (failed) {
    console.error("Source/local rendering comparison failed. Refusing to publish.");
    process.exit(1);
  }

  console.log("Source/local Chromium rendering audit passed.");
}

(async () => {
  if (mode === "discover") {
    await discover(a, b);
  } else if (mode === "compare") {
    if (!c) throw new Error("compare mode requires source, local, and output directory");
    await compare(a, b, c);
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
