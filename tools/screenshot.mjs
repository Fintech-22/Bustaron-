/**
 * Screenshot harness for BUSTARON UI verification.
 *
 * Usage:
 *   bun tools/screenshot.mjs --url http://127.0.0.1:4173 --tag m2-fix
 *
 * Saves PNGs to screenshots/<timestamp>-<tag>/ and writes a manifest.json.
 * Uses puppeteer-core + the installed Chrome (no npm install required).
 */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const WORKSPACE_MODULES =
  'C:/Users/user/.workbuddy-ai/binaries/node/workspace/node_modules';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const require = createRequire(import.meta.url);
const puppeteer = require(`${WORKSPACE_MODULES}/puppeteer-core`);

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const url = arg('url', 'http://127.0.0.1:4173');
const tag = arg('tag', 'run');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.resolve(process.cwd(), 'screenshots', `${stamp}-${tag}`);

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'laptop-1024', width: 1024, height: 800 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'mobile-320', width: 320, height: 720 },
];

const shots = [];

async function shoot(page, name, note = '') {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  shots.push({ name, file: path.relative(process.cwd(), file), note });
  console.log(`  shot: ${name}${note ? ` — ${note}` : ''}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});

try {
  await mkdir(outDir, { recursive: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  // --- responsive sweep of the default (operator) dashboard ---
  for (const vp of VIEWPORTS) {
    await page.setViewport({ width: vp.width, height: vp.height });
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.app-shell', { timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
    await shoot(page, `01-operator-${vp.name}`, `${vp.width}x${vp.height}`);
  }

  // --- back to desktop for interaction states ---
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.app-shell', { timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 400));

  // Admin view: click the first button whose accessible name matches /admin/i
  const clickedAdmin = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((x) => /admin/i.test(x.textContent || ''));
    if (b) { b.click(); return true; }
    return false;
  });
  await new Promise((r) => setTimeout(r, 500));
  await shoot(page, '02-admin', clickedAdmin ? 'clicked Admin' : 'Admin button NOT FOUND');

  // Focus state: tab to the first control and capture the focus ring
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.app-shell', { timeout: 15000 }).catch(() => {});
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await new Promise((r) => setTimeout(r, 300));
  await shoot(page, '03-focus-ring', 'after 3x Tab');

  // Layer toggles: turn every map layer off, then back on
  const toggleResult = await page.evaluate(() => {
    const group = document.querySelector('[role="group"][aria-label*="layer" i]');
    if (!group) return 'layer group not found';
    const btns = Array.from(group.querySelectorAll('button'));
    btns.forEach((b) => b.click());
    return `toggled ${btns.length} layer buttons`;
  });
  await new Promise((r) => setTimeout(r, 500));
  await shoot(page, '04-layers-off', toggleResult);

  await writeFile(
    path.join(outDir, 'manifest.json'),
    JSON.stringify({ url, tag, capturedAt: new Date().toISOString(), consoleErrors: errors, shots }, null, 2),
  );
  console.log(`\nSaved ${shots.length} screenshots to ${path.relative(process.cwd(), outDir)}`);
  console.log(`Console errors captured: ${errors.length}`);
  errors.slice(0, 10).forEach((e) => console.log(`  ! ${e}`));
} finally {
  await browser.close();
}
