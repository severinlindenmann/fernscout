#!/usr/bin/env node
// A trimmed copy of .claude/skills/test-in-a-browser/check-page.mjs, extended
// with two things that script doesn't do: setting the theme before the page's
// own script ever runs (via Page.addScriptToEvaluateOnNewDocument, since
// localStorage set after load is too late for the bootstrap script that reads
// it), and reading the rendered text twice, with a real wait in between and
// *no reload*, so a tick can be observed on the live component rather than
// inferred from two separate page loads.
//
//   node check-ticker.mjs <url> <out-dir> --cookie name=value [--theme dark]
//                          [--width 390] [--wait 2000] [--slug name]
//                          [--tick-wait 5000]

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function parseArgs(argv) {
  const positional = [];
  const opts = { cookies: [], width: 390, wait: 2000, slug: null, theme: null, tickWait: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cookie') opts.cookies.push(argv[++i]);
    else if (a === '--width') opts.width = Number(argv[++i]);
    else if (a === '--wait') opts.wait = Number(argv[++i]);
    else if (a === '--slug') opts.slug = argv[++i];
    else if (a === '--theme') opts.theme = argv[++i];
    else if (a === '--tick-wait') opts.tickWait = Number(argv[++i]);
    else positional.push(a);
  }
  if (positional.length !== 2) { console.error('need a url and an out-dir'); process.exit(2); }
  return { url: positional[0], outDir: positional[1], ...opts };
}

const slugify = (url) => {
  const u = new URL(url);
  return (u.pathname + u.search).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'index';
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
  const { url, outDir, cookies, width, wait, slug: slugOpt, theme, tickWait } = parseArgs(process.argv.slice(2));
  const slug = slugOpt || slugify(url);
  const port = 9222 + Math.floor(Math.random() * 700);
  const profile = await mkdtemp(join(tmpdir(), 'check-ticker-'));

  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--hide-scrollbars', '--force-device-scale-factor=1',
  ], { stdio: 'ignore' });

  const cleanup = async () => { chrome.kill(); await rm(profile, { recursive: true, force: true }).catch(() => {}); };

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
    cdp.on((method, p) => {
      if (method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'assert')) {
        consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
      } else if (method === 'Runtime.exceptionThrown') {
        consoleErrors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text);
      }
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    for (const c of cookies) {
      const i = c.indexOf('=');
      await cdp.send('Network.setCookie', { name: c.slice(0, i), value: c.slice(i + 1), url });
    }

    if (theme === 'dark' || theme === 'light') {
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `try { localStorage.setItem('fs.theme', '${theme}'); } catch (e) {}`,
      });
    }

    await mkdir(outDir, { recursive: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 2, mobile: true });

    const loaded = new Promise((resolve) => {
      const off = (m) => { if (m === 'Page.loadEventFired') resolve(); };
      cdp.on(off);
      setTimeout(resolve, 30000);
    });
    await cdp.send('Page.navigate', { url });
    await loaded;
    await sleep(wait);

    const readTicker = async () => {
      const r = await cdp.send('Runtime.evaluate', {
        expression: `
          (() => {
            const boxes = [...document.querySelectorAll('[aria-hidden="true"] span.tabular-nums')]
              .map((el) => el.textContent.trim());
            return JSON.stringify({ boxes, at: new Date().toISOString(), text: document.body.innerText.slice(0, 2000) });
          })()
        `,
        returnByValue: true,
      });
      return JSON.parse(r.result.value);
    };

    const first = await readTicker();

    // Full-page screenshot at the requested (mobile) width.
    const metrics = await cdp.send('Page.getLayoutMetrics');
    const full = Math.min(Math.ceil(metrics.cssContentSize.height), 12000);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: full, deviceScaleFactor: 2, mobile: true });
    await sleep(150);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = join(outDir, `${slug}${theme ? `-${theme}` : ''}-${width}.png`);
    await writeFile(file, Buffer.from(shot.data, 'base64'));

    let second = null;
    if (tickWait > 0) {
      await sleep(tickWait);
      second = await readTicker();
    }

    const record = { url, slug, theme, width, first, second, tickWaitMs: tickWait, consoleErrors: [...new Set(consoleErrors)] };
    const jsonPath = join(outDir, `${slug}${theme ? `-${theme}` : ''}.json`);
    await writeFile(jsonPath, JSON.stringify(record, null, 2));
    console.log(jsonPath);
    console.log(file);
    console.log(JSON.stringify({ first: first.boxes, second: second?.boxes, at1: first.at, at2: second?.at }));

    await cleanup();
    process.exit(0);
  } catch (err) {
    await cleanup();
    console.error(`check-ticker: ${err.message}`);
    process.exit(2);
  }
};

main();
