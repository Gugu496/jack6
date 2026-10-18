/* Headless visual QA via Chrome DevTools Protocol (no dependencies). */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '.shots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9222/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* retry */ }
    await sleep(250);
  }
  throw new Error('Edge debugging port not available');
}

(async () => {
  const wsUrl = await getWs();
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
    screenWidth: 390, screenHeight: 844,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  async function evaluate(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  }
  async function shot(name) {
    await sleep(450);
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('shot', name);
  }

  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await sleep(1600);
  // Drop a previously installed service worker so screenshots show current files.
  await evaluate(`Promise.all([
    navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))),
    caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k))))
  ]).then(() => location.reload())`);
  await sleep(1600);
  await shot('00-welcome');
  await evaluate('closeSheet(); loadDemo();');
  await sleep(900);
  await shot('01-home');

  // seed watch data so the screenshots show the populated state
  await evaluate(`(() => {
    const time = todayISO() + ' 07:30:00';
    const start = Math.floor(new Date(todayISO() + 'T07:30:00').getTime() / 1000);
    const sport = 'Uid,Sid,Key,Time,Category,Value,UpdateTime\\n1,9001,sport_record,' + time + ',running,"' +
      JSON.stringify({ sport_type: 1, start_time: start, duration: 3600, distance: 8200, calories: 560, avg_hrm: 148, max_hrm: 172, steps: 8100 }).replace(/"/g, '""') +
      '",' + time + '\\n';
    applyWatchImport(parseWatchText(sport, 'x_sport_record.csv'));
    applyWatchImport(parseWatchText('Uid,Sid,Tag,Key,Time,Value,UpdateTime\\n1,1,daily_report,steps,' + time + ',"' +
      JSON.stringify({ steps: 12345, distance: 8900, calories: 430, active_minutes: 55, sleep_minutes: 440, sleep_score: 84, resting_hr: 57 }).replace(/"/g, '""') +
      '",' + time + '\\n', 'y_aggregated_fitness_data.csv'));
  })()`);
  await evaluate(`(() => {
    const d = todayISO();
    const csv = '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注\\n' +
      d + ' 12:30:00,商户消费,美团外卖,午餐,支出,¥35.50,零钱,支付成功,wx1,m1,\\n' +
      d + ' 18:10:00,商户消费,滴滴出行,快车,支出,¥18.00,银行卡,支付成功,wx2,m2,\\n' +
      d + ' 20:00:00,商户消费,京东,耳机,支出,"¥1,299.00",零钱,支付成功,wx3,m3,\\n';
    applyWechatImport(parseWechatText(csv));
  })()`);
  await sleep(600);
  await shot('02-home-watch');

  const routes = ['savings', 'expenses', 'fitness', 'study', 'reading', 'daily', 'habits', 'me', 'body', 'diet', 'watch'];
  for (const r of routes) {
    await evaluate(`location.hash='#/${r}'`);
    await sleep(550);
    await shot('10-' + r);
  }

  // scroll the fitness page to inspect records
  await evaluate(`location.hash='#/fitness'`);
  await sleep(600);
  await evaluate('window.scrollTo(0, 780)');
  await shot('20-fitness-scrolled');

  // workout sheet
  await evaluate('sheetAddWorkout()');
  await shot('30-sheet-workout');
  await evaluate('closeSheet(); sheetAddExpense()');
  await shot('31-sheet-expense');
  await evaluate('closeSheet(); sheetSettings()');
  await shot('32-sheet-settings');
  await evaluate('closeSheet(); sheetImportWatch()');
  await shot('33-sheet-watch-import');
  await evaluate('closeSheet(); sheetImportWechat()');
  await shot('34-sheet-wechat-import');
  await evaluate('closeSheet(); sheetCloudSync()');
  await shot('35-sheet-cloud-sync');
  await evaluate('closeSheet(); sheetSnapshots()');
  await shot('36-sheet-snapshots');
  await evaluate('closeSheet(); sheetVoice()');
  await shot('37-sheet-voice');
  await evaluate(`(() => { const f = document.querySelector('#sheet-form');
    f.querySelector('#voice-text').value = '今天跑了五公里，用了三十分钟，喝了三瓶水，中午吃了牛肉面，还存了五千块';
    f.requestSubmit(); })()`);
  await shot('38-voice-preview');

  // dark mode home
  await evaluate("closeSheet(); db.settings.theme='dark'; applyTheme(); location.hash='#/home'; render(true)");
  await sleep(600);
  await shot('40-home-dark');
  await evaluate("location.hash='#/fitness'");
  await sleep(500);
  await shot('41-fitness-dark');
  await evaluate("db.settings.theme='light'; applyTheme(); render()");

  console.log('done');
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
