import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/user/.workbuddy-ai/binaries/node/workspace/node_modules/puppeteer-core');

const url = process.argv[2];
const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});

for (const vp of [{ n: '1440x900', w: 1440, h: 900 }, { n: '320x720', w: 320, h: 720 }]) {
  const p = await b.newPage();
  await p.setViewport({ width: vp.w, height: vp.h });
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));

  const m = await p.evaluate(() => {
    const findBtn = () => Array.from(document.querySelectorAll('button'))
      .find((x) => /new flight/i.test(x.textContent || ''));
    const btn = findBtn();
    return {
      scrollH: document.documentElement.scrollHeight,
      clientH: document.documentElement.clientHeight,
      overflowX: getComputedStyle(document.body).overflowX,
      btnTop: btn ? Math.round(btn.getBoundingClientRect().top) : null,
    };
  });

  console.log(vp.n + ': scrollHeight=' + m.scrollH + ' clientHeight=' + m.clientH
    + ' scrollable=' + (m.scrollH > m.clientH) + ' bodyOverflowX=' + m.overflowX);
  console.log('   New Flight button top=' + m.btnTop + 'px (viewport ' + vp.h + 'px)');

  const after = await p.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    return new Promise((res) => setTimeout(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find((x) => /new flight/i.test(x.textContent || ''));
      const r = btn.getBoundingClientRect();
      res({ top: Math.round(r.top), fullyVisible: r.top >= 0 && r.bottom <= window.innerHeight });
    }, 400));
  });
  console.log('   after scrolling to bottom: top=' + after.top + 'px fullyVisible=' + after.fullyVisible);
  await p.close();
}

await b.close();
