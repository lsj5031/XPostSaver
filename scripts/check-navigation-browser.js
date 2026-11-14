// Optional offline fixture, using explicitly supplied local tools without installing dependencies.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const missing = ['XPS_PLAYWRIGHT', 'XPS_CHROMIUM'].filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}. Set XPS_PLAYWRIGHT to the absolute path of a locally installed playwright-core module and XPS_CHROMIUM to the absolute path of a local Chromium executable. See README.md for usage.`);
  process.exit(1);
}
const { chromium } = require(process.env.XPS_PLAYWRIGHT);
const executablePath = process.env.XPS_CHROMIUM;
const output = process.env.XPS_EVIDENCE || '/tmp/xps-jk-evidence';
await mkdir(output, { recursive: true });
const code = await readFile(new URL('../x-post-saver-enhanced.user.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-background-networking'] });
const context = await browser.newContext({ viewport: { width: 1000, height: 720 }, serviceWorkers: 'block' });
// Only local synthetic documents, including the URL base. No external requests or sends.
const requests = [];
await context.route('**/*', async (route) => {
  requests.push(route.request().url());
  await route.abort();
});
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
const page = await context.newPage();
const measurements = [];
const html = `<base href="https://x.com/"><style>
  *{box-sizing:border-box}body{margin:0;font:18px sans-serif;background:#fafafa}
  main{width:600px;margin:auto}header{position:sticky;top:0;height:64px;background:#ddd;z-index:2;padding:20px}
  article{height:240px;border:1px solid #aaa;padding:24px;background:white}
  article:focus{outline:4px solid #36c;outline-offset:-4px}
  </style><main data-testid="primaryColumn"><header>Offline timeline fixture, sticky header</header>
  <section aria-label="Timeline: Home">${Array.from({ length: 16 }, (_, i) =>
    `<article id="p${i + 1}" tabindex="0"><a href="/person/status/${i + 1}"><time>Post ${i + 1}</time></a>
    <p>Local fixture content, not live X.</p><div role="group"><button data-testid="reply">Reply</button><button data-testid="like">Like</button></div></article>`).join('')}
  </section></main>`;

async function fixture(userscript) {
  await page.setContent(html);
  await page.evaluate(() => {
    window.opened = [];
    window.GM_openInTab = (url, options) => { window.opened.push({ url, options }); return {}; };
    window.GM_getValue = () => undefined;
    window.GM_setValue = () => {};
    window.nativeCalls = 0;
    window.simulatedSelection = 0;
  });
  if (userscript) await page.addScriptTag({ content: code });
  // Explicit stale-selection simulation, NOT verified native X behavior.
  await page.evaluate(() => {
    window.simulatedHandler = (event) => {
      if (!['j', 'k'].includes(event.key)) return;
      window.nativeCalls++;
      window.simulatedSelection = Math.max(0, Math.min(15,
        window.simulatedSelection + (event.key === 'j' ? 1 : -1)));
      const article = document.querySelectorAll('article')[window.simulatedSelection];
      article.focus();
      article.scrollIntoView({ block: 'start' });
    };
    document.addEventListener('keydown', window.simulatedHandler);
    document.querySelector('#p1').focus();
    window.scrollTo(0, 960);
  });
}
async function capture(name) {
  const data = await page.evaluate(() => {
    const article = document.activeElement;
    const rect = article.getBoundingClientRect();
    return {
      focus: article.id, y: window.scrollY, top: rect.top, bottom: rect.bottom,
      viewport: window.innerHeight, nativeCalls: window.nativeCalls, opened: window.opened,
    };
  });
  measurements.push({ name, ...data });
  await page.screenshot({ path: `${output}/${name}.png` });
  return data;
}

try {
  await fixture(false);
  const stale = await capture('01-stale-before-simulated-native');
  await page.keyboard.press('j');
  const broken = await capture('02-simulated-native-j-upward');
  assert.equal(broken.focus, 'p2');
  assert.ok(broken.y < stale.y - 500, 'simulation reproduces stale upward jump');
  await page.evaluate(() => document.removeEventListener('keydown', window.simulatedHandler));

  await fixture(true);
  await capture('03-userscript-stale-focus');
  await page.keyboard.press('j');
  const anchored = await capture('04-j-visible-anchor');
  assert.equal(anchored.focus, 'p5');
  assert.equal(anchored.y, 960);
  assert.equal(anchored.top, 64);
  assert.equal(anchored.nativeCalls, 0);
  await page.keyboard.press('w');
  const opened = await capture('05-j-w-background');
  assert.deepEqual(opened.opened, [{
    url: 'https://x.com/person/status/5', options: { active: false, insert: true, setParent: true },
  }]);
  assert.equal(opened.focus, 'p5');
  assert.equal(opened.y, 960);
  await page.keyboard.press('k');
  const previous = await capture('06-k-previous-revealed');
  assert.equal(previous.focus, 'p4');
  assert.equal(previous.y, 720);
  assert.equal(previous.top, 64);
  assert.equal(previous.nativeCalls, 0);
  await page.keyboard.press('j');
  assert.equal((await capture('07-j-consecutive')).focus, 'p5');
  await page.evaluate(() => {
    document.querySelector('#p1').focus({ preventScroll: true });
    window.scrollTo(0, 960);
  });
  await page.keyboard.press('k');
  const last = await capture('08-k-stale-visible-anchor');
  assert.equal(last.focus, 'p7');
  assert.equal(last.y, 960);
  assert.ok(last.bottom > 64 && last.top < last.viewport);

  await page.evaluate(() => {
    document.querySelector('#p1').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => Math.abs(window.scrollY - 720) < 1);
  const space = await capture('09-space-stale-focus');
  assert.equal(space.focus, 'p1');
  assert.equal(space.y, 720);
  await page.keyboard.press('j');
  const afterSpace = await capture('10-space-j-anchor');
  assert.equal(afterSpace.focus, 'p4');
  assert.equal(afterSpace.y, 720);
  assert.equal(afterSpace.top, 64);
  assert.equal(afterSpace.nativeCalls, 0);
  assert.deepEqual(requests, [], 'fixture made no external requests');
  await writeFile(`${output}/measurements.json`, JSON.stringify({
    kind: 'Offline Chromium fixture; explicitly simulated native handler, not live X',
    requests, measurements,
  }, null, 2));
  console.log(JSON.stringify(measurements, null, 2));
} finally {
  await context.tracing.stop({ path: `${output}/trace.zip` });
  await browser.close();
}
