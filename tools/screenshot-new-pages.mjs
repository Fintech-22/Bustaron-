/**
 * Targeted screenshot pass for the two new pages:
 *  - operator Flight Detail (activeSection = 'flightDetail')
 *  - admin Airspace Management (activeSection = 'airspace')
 *
 * Reuses puppeteer-core from the workspace modules.
 */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const WORKSPACE_MODULES = 'C:/Users/user/.workbuddy-ai/binaries/node/workspace/node_modules';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const require = createRequire(import.meta.url);
const puppeteer = require(`${WORKSPACE_MODULES}/puppeteer-core`);

const url = 'http://127.0.0.1:4173';
const tag = process.argv.includes('--tag') ? process.argv[process.argv.indexOf('--tag') + 1] : 'new-pages';
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.resolve(process.cwd(), 'screenshots', `${stamp}-${tag}`);

const shots = [];
const errors = [];

async function shoot(page, name, note = '') {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: name.includes('expanded') || name.includes('full') });
  shots.push({ name, file: path.relative(process.cwd(), file), note });
  console.log(`  shot: ${name}${note ? ` — ${note}` : ''}`);
}

async function clickByLabel(page, labelRegex) {
  return page.evaluate((re) => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((x) => new RegExp(re, 'i').test(x.textContent || ''));
    if (b) { b.click(); return true; }
    return false;
  }, labelRegex.source);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});

try {
  await mkdir(outDir, { recursive: true });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  // 1) Operator Flight Detail page
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.app-shell', { timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  await clickByLabel(page, /flight detail/i);
  await new Promise((r) => setTimeout(r, 500));
  await shoot(page, '01-operator-flight-detail', 'Flight Detail view');

  // Expand the first row
  await page.evaluate(() => {
    const btn = document.querySelector('.flight-detail__row-toggle');
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  await shoot(page, '02-operator-flight-detail-expanded', 'Flight Detail expanded');

  // 2) Admin Airspace Management page
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.app-shell', { timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  await clickByLabel(page, /^\s*ADM\s*Admin\s*$/i);
  await new Promise((r) => setTimeout(r, 200));
  await clickByLabel(page, /airspace/i);
  await new Promise((r) => setTimeout(r, 500));
  await shoot(page, '03-admin-airspace', 'Airspace Management view');

  await writeFile(
    path.join(outDir, 'manifest.json'),
    JSON.stringify({ url, tag, capturedAt: new Date().toISOString(), consoleErrors: errors, shots }, null, 2),
  );
  console.log(`\nSaved ${shots.length} screenshots to ${path.relative(process.cwd(), outDir)}`);
  console.log(`Console errors: ${errors.length}`);
  errors.slice(0, 10).forEach((e) => console.log(`  ! ${e}`));
} finally {
  await browser.close();
}