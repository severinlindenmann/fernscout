#!/usr/bin/env node
// Look at a page the way a person does, and write down what was there.
//
// An agent cannot tell from the JSX whether a feature is inert — B42 drew a
// second clock on the two demo days its own change had edited and on nothing
// else in the world, and the suite was green (B1090). `curl` cannot answer it
// either: anything in or below TripHero is handed to the animated story
// component and is absent from the server HTML.
//
// So this drives real Chrome over CDP and writes four things a caller can
// check: the picture, the text as rendered, the console, and the requests that
// failed. A screenshot on its own is a thing to have an opinion about. B1097.
//
//   node check-page.mjs <url> <out-dir> [--cookie name=value] [--widths 1280,390]
//                                       [--wait 2000] [--slug name]
//
// No dependency, deliberately: Node has a global WebSocket, and Chrome speaks
// CDP over one socket. Adding Playwright here would be a package.json entry
// for a script that four skills call and nothing ships.

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function usage(msg) {
  console.error(msg ? `check-page: ${msg}\n` : '');
  console.error('usage: check-page.mjs <url> <out-dir> [--cookie name=value]... '
    + '[--widths 1280,390] [--wait 2000] [--slug name]');
  process.exit(2);
}

function parseArgs(argv) {
  const positional = [];
  const opts = { cookies: [], widths: [1280, 390], wait: 2000, slug: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cookie') opts.cookies.push(argv[++i]);
    else if (a === '--widths') opts.widths = argv[++i].split(',').map(Number);
    else if (a === '--wait') opts.wait = Number(argv[++i]);
    else if (a === '--slug') opts.slug = argv[++i];
    else if (a.startsWith('--')) usage(`unknown flag ${a}`);
    else positional.push(a);
  }
  if (positional.length !== 2) usage('need a url and an out-dir');
  if (opts.widths.some((w) => !Number.isFinite(w) || w < 200)) usage('bad --widths');
  if (!Number.isFinite(opts.wait)) usage('bad --wait');
  return { url: positional[0], outDir: positional[1], ...opts };
}

const slugify = (url) => {
  const u = new URL(url);
  const s = (u.pathname + u.search).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return s || 'index';
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForEndpoint(port, deadline) {
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return await r.json();
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('Chrome did not open its debugging port');
    await sleep(100);
  }
}

// One socket, one id counter, one map of pending replies. Events are handed to
// listeners; everything else resolves a call.
function client(ws) {
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg.method, msg.params);
    }
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    on(fn) { listeners.push(fn); },
  };
}

const main = async () => {
  const { url, outDir, cookies, widths, wait, slug: slugOpt } = parseArgs(process.argv.slice(2));
  const slug = slugOpt || slugify(url);
  const port = 9222 + Math.floor(Math.random() * 700);
  const profile = await mkdtemp(join(tmpdir(), 'check-page-'));

  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--hide-scrollbars', '--force-device-scale-factor=1',
  ], { stdio: 'ignore' });
  chrome.on('error', (e) => { console.error(`check-page: cannot start Chrome (${e.message}). Set CHROME_PATH.`); process.exit(2); });

  const cleanup = async () => {
    chrome.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  };

  try {
    await waitForEndpoint(port, Date.now() + 15000);
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('CDP socket refused')), { once: true });
    });
    const cdp = client(ws);

    const consoleErrors = [];
    const failedRequests = [];
    let mainStatus = null;
    let navigationError = null;

    cdp.on((method, p) => {
      if (method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'assert')) {
        consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
      } else if (method === 'Runtime.exceptionThrown') {
        consoleErrors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text);
      } else if (method === 'Network.responseReceived') {
        if (p.type === 'Document' && p.response.url.replace(/\/$/, '') === url.replace(/\/$/, '')) {
          mainStatus = p.response.status;
        }
        if (p.response.status >= 400) failedRequests.push(`${p.response.status} ${p.response.url}`);
      } else if (method === 'Network.loadingFailed' && !p.canceled) {
        failedRequests.push(`failed ${p.errorText}`);
      }
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    for (const c of cookies) {
      const i = c.indexOf('=');
      if (i < 1) usage(`bad --cookie ${c}`);
      // Network.setCookie is the only way in: the session cookie is HttpOnly,
      // and document.cookie silently returns "" rather than failing.
      await cdp.send('Network.setCookie', { name: c.slice(0, i), value: c.slice(i + 1), url });
    }

    await mkdir(outDir, { recursive: true });
    const shots = [];
    let innerText = '';
    let title = '';

    for (const width of widths) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width, height: 900, deviceScaleFactor: 1, mobile: width < 700,
      });
      const loaded = new Promise((resolve) => {
        const off = (m) => { if (m === 'Page.loadEventFired') resolve(); };
        cdp.on(off);
        setTimeout(resolve, 30000);
      });
      const nav = await cdp.send('Page.navigate', { url });
      if (nav.errorText) navigationError = nav.errorText;
      await loaded;
      await sleep(wait);

      // Full page without `captureBeyondViewport`, which tiles the content
      // when device metrics are overridden: measure, grow the viewport to the
      // whole document, shoot, and put it back.
      const metrics = await cdp.send('Page.getLayoutMetrics');
      const full = Math.min(Math.ceil(metrics.cssContentSize.height), 12000);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width, height: full, deviceScaleFactor: 1, mobile: width < 700,
      });
      await sleep(150);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = join(outDir, `${slug}-${width}.png`);
      await writeFile(file, Buffer.from(shot.data, 'base64'));
      shots.push(file);

      // Read the rendered text, not the fetched markup — that is the whole
      // reason this exists rather than a curl.
      const text = await cdp.send('Runtime.evaluate', {
        expression: 'document.body.innerText', returnByValue: true,
      });
      const t = await cdp.send('Runtime.evaluate', {
        expression: 'document.title', returnByValue: true,
      });
      if (!innerText) { innerText = text.result.value || ''; title = t.result.value || ''; }
    }

    const record = {
      url, slug, status: mainStatus, title, widths, capturedAt: new Date().toISOString(),
      navigationError, innerText,
      // Deduped: a page is loaded once per width, so an error on every load
      // would otherwise be reported as two.
      consoleErrors: [...new Set(consoleErrors)],
      failedRequests: [...new Set(failedRequests)],
      screenshots: shots,
    };
    const jsonPath = join(outDir, `${slug}.json`);
    await writeFile(jsonPath, JSON.stringify(record, null, 2));

    console.log(jsonPath);
    for (const s of shots) console.log(s);
    console.log(`status ${mainStatus ?? '?'} · ${record.consoleErrors.length} console error(s) · ${record.failedRequests.length} failed request(s)`);

    await cleanup();
    // Exit non-zero on the two failures a caller must not carry forward, so a
    // run can gate on this without reading the JSON.
    process.exit(navigationError || mainStatus === null || mainStatus >= 500 ? 1 : 0);
  } catch (err) {
    await cleanup();
    console.error(`check-page: ${err.message}`);
    process.exit(2);
  }
};

main();
