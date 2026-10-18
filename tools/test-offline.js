/* Verify the single-file build works from file:// with local persistence. */
'use strict';
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let wsUrl;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9222/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch (e) { /* retry */ }
    await sleep(250);
  }
  if (!wsUrl) throw new Error('no debug target');

  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('console.error: ' + m.params.args.map((a) => a.value || a.description).join(' '));
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });

  const file = path.join(__dirname, '..', '六年之约.html');
  const url = pathToFileURL(file).href;
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok });
    if (!ok) console.log('FAIL', name, detail);
  };

  await send('Page.navigate', { url });
  await sleep(1500);
  check('app booted', (await evaluate("typeof db === 'object' && typeof render === 'function'")));
  check('view rendered', (await evaluate("document.querySelector('#view').textContent.includes('六年之约')")));
  check('no external assets', (await evaluate("[...document.querySelectorAll('[src],[href]')].every(el => { const v = el.getAttribute('src') || el.getAttribute('href'); return !v || v.startsWith('data:') || v.startsWith('#'); })")));

  await evaluate(`location.hash = '#/home'`);
  await sleep(350);
  await evaluate("document.querySelectorAll('.quick-grid .quick')[0].click()");
  await sleep(300);
  check('quick action opens sheet offline', await evaluate("!!document.querySelector('#sheet-form')"));
  check('no placeholder toast', (await evaluate("document.getElementById('toast').textContent")) !== '这个功能还在路上');
  await evaluate('closeSheet()');

  const before = await evaluate("localStorage.getItem('jack6.v1')");
  await evaluate("db.savings.push({id:'offline-test',type:'deposit',amount:1,date:todayISO(),note:'offline'}); save();");
  check('localStorage writable', (await evaluate("!!localStorage.getItem('jack6.v1')")));
  await evaluate('location.reload()');
  await sleep(1500);
  check('persisted after reload', await evaluate("db.savings.some(r => r.id === 'offline-test')"));
  check('app still offline-ready', (await evaluate("typeof db === 'object'")));
  await evaluate("db.savings = db.savings.filter(r => r.id !== 'offline-test'); save(); render();");

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, '..', '.shots', '90-offline-file.png'), Buffer.from(shot.data, 'base64'));

  console.log('');
  console.log(`Results: ${results.filter((r) => r.ok).length}/${results.length} passed`);
  if (errors.length) console.log('JS errors:\n' + errors.join('\n'));
  else console.log('No JS errors captured.');
  ws.close();
  process.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
