/**
 * Programmatic Mapbox verification — proves the base map actually rendered
 * without needing a human (or a vision model) to look at a screenshot.
 *
 * Usage: bun tools/verify-mapbox.mjs --url http://127.0.0.1:4176
 * Exit code 0 = all checks passed, 1 = at least one failed.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const WORKSPACE_MODULES =
  'C:/Users/user/.workbuddy-ai/binaries/node/workspace/node_modules';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const require = createRequire(import.meta.url);
const puppeteer = require(`${WORKSPACE_MODULES}/puppeteer-core`);

const argv = process.argv.slice(2);
const i = argv.indexOf('--url');
const url = i >= 0 ? argv[i + 1] : 'http://127.0.0.1:4176';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const mapboxResponses = [];
  page.on('response', (r) => {
    if (r.url().includes('api.mapbox.com') || r.url().includes('events.mapbox.com')) {
      mapboxResponses.push({ url: r.url(), status: r.status() });
    }
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 6000)); // let tiles settle

  // 1. Provider switch picked Mapbox
  const provider = await page.$eval('[data-map-provider]', (el) => el.getAttribute('data-map-provider')).catch(() => null);
  check('MapHost selected the mapbox provider', provider === 'mapbox', `data-map-provider="${provider}"`);

  // 2. Mapbox SDK global present
  const hasSdk = await page.evaluate(() => typeof window.mapboxgl !== 'undefined');
  check('mapbox-gl SDK global loaded', hasSdk === true);

  // 3. A real WebGL canvas of non-zero size exists
  const canvas = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    return { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight };
  });
  check('map canvas rendered with non-zero size', !!canvas && canvas.w > 0 && canvas.h > 0,
    canvas ? `${canvas.w}x${canvas.h}px (css ${canvas.cw}x${canvas.ch})` : 'no canvas element');

  // 4. Tiles actually fetched successfully (proves auth works end to end)
  const tileOk = mapboxResponses.filter((r) => r.status === 200);
  const unauthorized = mapboxResponses.filter((r) => r.status === 401);
  check('Mapbox tiles fetched with HTTP 200', tileOk.length > 0, `${tileOk.length} successful responses`);
  check('no 401 Unauthorized from Mapbox', unauthorized.length === 0, `${unauthorized.length} 401s`);

  // 5. Canvas is not a blank fill.
  // NOTE: gl.readPixels() is NOT usable here — Mapbox does not set
  // preserveDrawingBuffer, so the drawing buffer is cleared after each frame
  // and readPixels returns a blank result even when the map is drawn correctly.
  // Instead: screenshot just the canvas element and use the compressed size as
  // a proxy for visual detail (a blank fill compresses to a few KB).
  const canvasEl = await page.$('canvas');
  const box = canvasEl ? await canvasEl.boundingBox() : null;
  let canvasBytes = 0;
  if (box) {
    const { stat } = await import('node:fs/promises');
    const file = path.resolve(process.cwd(), 'screenshots', '_canvas_only.png');
    await page.screenshot({ path: file, clip: box });
    canvasBytes = (await stat(file)).size;
  }
  check('map canvas has rendered detail (not a blank fill)', canvasBytes > 20000,
    `canvas-only screenshot is ${canvasBytes} bytes (blank would be <5 KB)`);

  // 6. What did we actually fetch from Mapbox?
  const kinds = {};
  for (const r of mapboxResponses) {
    const u = r.url.split('?')[0];
    const k = u.includes('.pbf') ? 'vector-tile'
      : u.includes('.png') ? 'raster-tile'
      : u.includes('/styles/') ? 'style'
      : u.includes('sprite') ? 'sprite'
      : u.includes('fonts') ? 'font'
      : u.includes('events') ? 'telemetry' : 'other';
    kinds[k] = (kinds[k] || 0) + 1;
  }
  const tiles = (kinds['vector-tile'] || 0) + (kinds['raster-tile'] || 0);
  check('map tiles were actually fetched', tiles > 0,
    `${tiles} tiles; breakdown ${JSON.stringify(kinds)}`);

  const nonFaviconErrors = errors.filter((e) => !/favicon|404/i.test(e));
  check('no unexpected console/page errors', nonFaviconErrors.length === 0,
    nonFaviconErrors.slice(0, 3).join(' | ') || 'none');

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length === 0 ? 0 : 1;
} finally {
  await browser.close();
}
