/* Functional smoke test over CDP. */
'use strict';
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
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      // Headless evaluation has no user gesture; vibrate is expected to be refused.
      if (!/navigator\.vibrate/i.test(m.params.entry.text)) errors.push('LOG: ' + m.params.entry.text);
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
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await sleep(1400);

  await evaluate(`Promise.all([
    navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))),
    caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k))))
  ]).then(() => { localStorage.clear(); location.reload(); })`);
  await sleep(1600);
  await evaluate('closeSheet(); loadDemo()');
  await sleep(500);

  const results = [];
  const check = (name, cond, detail = '') => {
    results.push({ name, ok: !!cond, detail });
    if (!cond) console.log('FAIL', name, detail);
  };

  // baseline
  const base = await evaluate('({savings:db.savings.length, expenses:db.expenses.length, workouts:db.workouts.length, studies:db.studies.length, readings:db.readings.length, weights:db.weights.length, meals:db.meals.length, water:db.water.length, habits:db.habits.length, daily:db.daily.length})');

  // --- home quick grid must open the right sheet, not the placeholder toast ---
  await evaluate(`location.hash = '#/home'`);
  await sleep(400);
  const quickCount = await evaluate("document.querySelectorAll('.quick-grid .quick').length");
  check('home quick grid exists', quickCount === 8, String(quickCount));
  for (let i = 0; i < Math.min(7, quickCount); i++) {
    await evaluate(`document.querySelectorAll('.quick-grid .quick')[${i}].click()`);
    await sleep(250);
    const open = await evaluate("!!document.querySelector('#sheet-form')");
    const toastText = await evaluate("document.getElementById('toast').textContent");
    check('quick ' + i + ' opens sheet', open, toastText);
    await evaluate('closeSheet()');
    await sleep(120);
  }
  await evaluate(`location.hash = '#/home'`);
  await sleep(350);
  await evaluate("document.querySelectorAll('.quick-grid .quick')[7].click()");
  await sleep(350);
  check('quick three-things navigates', (await evaluate('location.hash')) === '#/daily');
  await evaluate(`location.hash = '#/home'`);
  await sleep(350);

  // --- savings ---
  await evaluate('sheetAddSavings()');
  check('savings sheet opens', await evaluate("!!document.querySelector('#sheet-form')"));
  await evaluate(`(() => { const f = document.querySelector('#sheet-form');
    f.amount.value = '123.45'; f.note.value = '测试存款'; f.requestSubmit(); })()`);
  await sleep(350);
  check('savings added', (await evaluate('db.savings.length')) === base.savings + 1);
  check('savings amount', (await evaluate('db.savings[db.savings.length-1].amount')) === 123.45);

  // --- expense ---
  await evaluate('sheetAddExpense()');
  await evaluate(`(() => { const f = document.querySelector('#sheet-form');
    f.amount.value = '66.6'; f.note.value = '测试消费'; f.requestSubmit(); })()`);
  await sleep(350);
  check('expense added', (await evaluate('db.expenses.length')) === base.expenses + 1);
  check('expense cat default', (await evaluate('db.expenses[db.expenses.length-1].cat')) === 'food');

  // --- workout strength with exercise ---
  await evaluate('sheetAddWorkout()');
  await evaluate(`(() => { const f = document.querySelector('#sheet-form');
    f.minutes.value = '60'; f.bodyweight.value = '70';
    const row = f.querySelector('.ex-row');
    row.querySelector('[name=exName]').value = '测试深蹲';
    row.querySelector('[name=exSets]').value = '3';
    row.querySelector('[name=exReps]').value = '10';
    row.querySelector('[name=exWeight]').value = '100';
    f.requestSubmit(); })()`);
  await sleep(400);
  check('workout added', (await evaluate('db.workouts.length')) === base.workouts + 1);
  const wk = await evaluate('db.workouts[db.workouts.length-1]');
  check('workout kcal', wk && wk.kcal === Math.round((5 * 70 * 60) / 60), JSON.stringify(wk && wk.kcal));
  check('workout exercise saved', wk && wk.exercises.length === 1 && wk.exercises[0].name === '测试深蹲');
  check('workout PR exists', await evaluate("prs().some(p => p.name === '测试深蹲')"));

  // --- workout cardio distance ---
  await evaluate('sheetAddWorkout()');
  await evaluate(`(() => { const f = document.querySelector('#sheet-form');
    const t = f.querySelector('input[name=wtype][value=cardio]'); t.checked = true; t.dispatchEvent(new Event('change', {bubbles:true}));
    f.querySelector('#wk-act').value = 'run';
    f.minutes.value = '40'; f.bodyweight.value = '72.4';
    f.querySelector('#wk-dist').value = '7.2';
    f.requestSubmit(); })()`);
  await sleep(400);
  const wk2 = await evaluate('db.workouts[db.workouts.length-1]');
  check('cardio saved with distance', wk2 && Number(wk2.distance) === 7.2 && wk2.type === 'cardio', JSON.stringify(wk2));

  // --- Xiaomi watch CSV import ---
  const sportCsv = `Uid,Sid,Key,Time,Category,Value,UpdateTime
1,9001,sport_record,2026-10-15 07:30:00,running,"{""proto_type"":1,""sport_type"":1,""start_time"":1792049400,""duration"":3600,""distance"":8200,""calories"":560,""avg_hrm"":148,""max_hrm"":172,""steps"":8100}",2026-10-15 08:31:00
`;
  const watchRes = await evaluate(`applyWatchImport(parseWatchText(${JSON.stringify(sportCsv)}, '20261015_MiFitness_hlth_center_sport_record.csv'))`);
  check('watch sport imported', watchRes.workouts === 1, JSON.stringify(watchRes));
  const wx = await evaluate("db.workouts[db.workouts.length-1]");
  check('watch sport mapped', wx && wx.source === 'xiaomi' && wx.activity === 'run' && wx.minutes === 60, JSON.stringify(wx));
  check('watch sport metrics', wx && wx.kcal === 560 && Number(wx.distance) === 8.2 && wx.hr === 148 && wx.maxHr === 172, JSON.stringify(wx));
  const watchAgain = await evaluate(`applyWatchImport(parseWatchText(${JSON.stringify(sportCsv)}, '20261015_MiFitness_hlth_center_sport_record.csv'))`);
  check('watch import deduped', watchAgain.workouts === 0 && watchAgain.dup >= 1, JSON.stringify(watchAgain));

  const healthCsv = `Uid,Sid,Tag,Key,Time,Value,UpdateTime
1,1,daily_report,steps,2026-10-14 00:00:00,"{""steps"":12345,""distance"":8900,""calories"":430,""active_minutes"":55,""sleep_minutes"":440,""sleep_score"":84,""resting_hr"":57}",2026-10-14 23:59:00
`;
  const healthRes = await evaluate(`applyWatchImport(parseWatchText(${JSON.stringify(healthCsv)}, '20261014_MiFitness_hlth_center_aggregated_fitness_data.csv'))`);
  const wh = await evaluate("db.health.find(h => h.date === '2026-10-14')");
  check('watch daily imported', healthRes.health === 1 && wh && wh.steps === 12345 && wh.sleepMinutes === 440 && wh.restingHr === 57, JSON.stringify(wh));

  // --- WeChat Pay bill import ---
  const wechatCsv = `微信支付账单明细
微信昵称：[Jack]
----------------------微信支付账单明细列表--------------------
交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注
2026-10-16 12:30:00,商户消费,美团外卖,午餐,支出,¥35.50,零钱,支付成功,4200001,M1,
2026-10-16 18:00:00,转账,张三,转账,支出,¥200.00,零钱,已转账,4200002,,朋友还款
2026-10-15 08:00:00,商户消费,滴滴出行,快车,支出,¥18.00,银行卡,支付成功,4200003,M3,
2026-10-15 20:00:00,商户消费,某超市,日用品,支出,¥88.00,零钱,已全额退款,4200004,M4,
2026-10-14 10:00:00,商户消费,京东,耳机,支出,"¥1,299.00",零钱,支付成功,4200005,M5,
2026-10-14 11:00:00,转账,李四,收款,收入,¥500.00,零钱,已收钱,4200006,,,
`;
  const wxParsed = await evaluate(`parseWechatText(${JSON.stringify(wechatCsv)})`);
  check('wechat rows parsed', wxParsed && wxParsed.items.length === 3, JSON.stringify(wxParsed));
  check('wechat skips income/refund/transfer', wxParsed.income === 1 && wxParsed.refunds === 1 && wxParsed.transfers === 1, JSON.stringify(wxParsed));
  const wxImport = await evaluate(`applyWechatImport(parseWechatText(${JSON.stringify(wechatCsv)}))`);
  check('wechat expenses imported', wxImport.added === 3, JSON.stringify(wxImport));
  const wxRows = await evaluate(`db.expenses.filter(e => e.source === 'wechat')`);
  check('wechat categories', wxRows.map(r => r.cat).sort().join(',') === 'food,shop,traffic', JSON.stringify(wxRows.map(r => r.cat)));
  check('wechat comma amount', wxRows.some(r => r.amount === 1299), JSON.stringify(wxRows.map(r => r.amount)));
  const wxAgain = await evaluate(`applyWechatImport(parseWechatText(${JSON.stringify(wechatCsv)}))`);
  check('wechat import deduped', wxAgain.added === 0 && wxAgain.dup === 3, JSON.stringify(wxAgain));

  await evaluate(`location.hash='#/expenses'`);
  await sleep(400);
  check('wechat tag rendered', await evaluate("document.querySelector('#view').innerHTML.includes('微信')"));

  // --- study ---
  await evaluate('sheetAddStudy()');
  await evaluate(`(() => { const f = document.querySelector('#sheet-form');
    f.minutes.value = '25'; f.content.value = '测试学习'; f.requestSubmit(); })()`);
  await sleep(300);
  check('study added', (await evaluate('db.studies.length')) === base.studies + 1);

  // --- reading ---
  await evaluate('sheetAddReading()');
  await evaluate(`(() => { const f = document.querySelector('#sheet-form');
    f.book.value = '测试之书'; f.pages.value = '12'; f.minutes.value = '20'; f.requestSubmit(); })()`);
  await sleep(300);
  check('reading added', (await evaluate('db.readings.length')) === base.readings + 1);

  // --- weight ---
  await evaluate('sheetAddWeight()');
  await evaluate(`(() => { const f = document.querySelector('#sheet-form');
    f.weight.value = '71.8'; f.requestSubmit(); })()`);
  await sleep(300);
  check('weight added', (await evaluate('db.weights.length')) === base.weights + 1);
  check('settings weight synced', (await evaluate('db.settings.weight')) === 71.8);

  // --- meal ---
  await evaluate('sheetAddMeal()');
  await evaluate(`(() => { const f = document.querySelector('#sheet-form');
    f.name.value = '测试午餐'; f.kcal.value = '500'; f.requestSubmit(); })()`);
  await sleep(300);
  check('meal added', (await evaluate('db.meals.length')) === base.meals + 1);

  // --- water ---
  await evaluate('sheetAddWater()');
  await evaluate(`(() => { const f = document.querySelector('#sheet-form');
    f.ml.value = '300'; f.requestSubmit(); })()`);
  await sleep(300);
  check('water added', (await evaluate('db.water.length')) === base.water + 1);

  // --- habit + toggle ---
  await evaluate('sheetAddHabit()');
  await evaluate(`(() => { const f = document.querySelector('#sheet-form');
    f.name.value = '测试习惯'; f.requestSubmit(); })()`);
  await sleep(300);
  const habitId = await evaluate("db.habits[db.habits.length-1].id");
  check('habit added', (await evaluate('db.habits.length')) === base.habits + 1);
  await evaluate(`toggleHabit('${habitId}')`);
  check('habit toggled on', await evaluate(`(db.habitLogs['${habitId}']||[]).includes(todayISO())`));

  // --- daily form ---
  await evaluate('location.hash="#/daily"');
  await sleep(400);
  await evaluate(`(() => { const f = document.querySelector('[data-form="daily"]');
    f.happy.value = '测试开心'; f.thought.value = '测试思考'; f.requestSubmit(); })()`);
  await sleep(400);
  const daily = await evaluate('db.daily.find(d => d.date === todayISO())');
  check('daily saved', daily && daily.happy === '测试开心');

  // --- settings ---
  await evaluate('sheetSettings()');
  await evaluate(`(() => { const f = document.querySelector('#sheet-form');
    f.nickname.value = 'Tester'; f.waterGoal.value = '2600'; f.requestSubmit(); })()`);
  await sleep(400);
  check('settings saved', (await evaluate("db.settings.nickname + '|' + db.settings.waterGoal")) === 'Tester|2600');

  // --- custom pact dates must propagate to every date label ---
  await evaluate('sheetSettings()');
  await evaluate(`(() => { const f = document.querySelector('#sheet-form');
    f.startDate.value = '2025-01-01'; f.endDate.value = '2029-12-31'; f.requestSubmit(); })()`);
  await sleep(450);
  check('settings dates saved', (await evaluate("db.settings.startDate + '|' + db.settings.endDate")) === '2025-01-01|2029-12-31');
  await evaluate(`location.hash='#/home'`);
  await sleep(450);
  const heroTxt = await evaluate("document.querySelector('.hero').textContent");
  check('hero shows custom start', heroTxt.includes('2025.01.01'), heroTxt.replace(/\s+/g, ' ').slice(0, 160));
  check('hero shows custom end', heroTxt.includes('2029.12.31'), heroTxt.replace(/\s+/g, ' ').slice(0, 160));
  check('hero drops hardcoded dates', !heroTxt.includes('2024.12.30') && !heroTxt.includes('2030.12.31'));
  await evaluate(`location.hash='#/me'`);
  await sleep(450);
  const meTxt = await evaluate("document.querySelector('.profile-card').textContent");
  check('me page shows custom dates', meTxt.includes('2025.01.01') && meTxt.includes('2029.12.31'), meTxt.replace(/\s+/g, ' ').slice(0, 160));
  await evaluate('sheetSettings()');
  await evaluate(`(() => { const f = document.querySelector('#sheet-form');
    f.startDate.value = '2024-12-30'; f.endDate.value = '2030-12-31'; f.requestSubmit(); })()`);
  await sleep(400);

  // --- navigation all routes ---
  for (const r of ['home', 'savings', 'expenses', 'fitness', 'study', 'reading', 'daily', 'habits', 'me', 'body', 'diet', 'watch']) {
    await evaluate(`location.hash='#/${r}'`);
    await sleep(220);
    const ok = await evaluate("!!document.querySelector('#view').innerHTML.length");
    check('route ' + r, ok);
  }

  // --- persistence ---
  await evaluate('save(); location.reload()');
  await sleep(1500);
  check('persisted after reload', (await evaluate('db.savings.length')) === base.savings + 1);
  check('welcome not shown', (await evaluate('!document.querySelector(".sheet-overlay")')));

  // cleanup test records
  await evaluate(`db.savings = db.savings.filter(r => r.note !== '测试存款'); db.expenses = db.expenses.filter(r => r.note !== '测试消费'); db.workouts = db.workouts.filter(r => !(r.exercises||[]).some(e => e.name === '测试深蹲') && !(r.activity === 'run' && r.distance === '7.2')); db.studies = db.studies.filter(r => r.content !== '测试学习'); db.readings = db.readings.filter(r => r.book !== '测试之书'); db.weights = db.weights.filter(r => !(r.weight === 71.8 && r.date === todayISO())); db.meals = db.meals.filter(r => r.name !== '测试午餐'); db.water = db.water.filter(r => r.ml !== 300); db.habits = db.habits.filter(r => r.name !== '测试习惯'); db.daily = db.daily.filter(r => r.happy !== '测试开心'); db.workouts = db.workouts.filter(w => w.source !== 'xiaomi'); db.health = []; db.weights = db.weights.filter(w => w.source !== 'xiaomi'); db.expenses = db.expenses.filter(e => e.source !== 'wechat'); db.settings.nickname = 'Jack'; db.settings.waterGoal = 2200; save(); render()`);

  console.log('');
  const failed = results.filter((r) => !r.ok);
  console.log(`Results: ${results.length - failed.length}/${results.length} passed`);
  if (errors.length) console.log('JS errors:\n' + errors.join('\n'));
  else console.log('No JS errors captured.');
  ws.close();
  process.exit(failed.length || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
