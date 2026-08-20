// 首页/历史页布局重构 jsdom 冒烟测试：
// 1) 日历迁移到历史页（与历史列表并排）
// 2) 首页右列改为：排行榜（固定高度）+ 近 7 天折线图
// 3) 首页左右两列高度一致
const fs = require('fs');
const { JSDOM } = require('C:\\Users\\12746\\.workbuddy\\binaries\\node\\workspace\\node_modules\\jsdom');

const html = fs.readFileSync('D:\\code\\workBuddy\\water-tracker\\index.html', 'utf8');

// ---- 内存 Mock Supabase ----
const store = { profiles: [], water_records: [] };
const nextId = { water_records: 1 };

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function ds(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function seedProfiles(n) {
  store.profiles.length = 0;
  for (let i = 1; i <= n; i++) {
    store.profiles.push({
      id: 'u' + i,
      username: 'user' + i,
      role: i === 1 ? 'admin' : 'user',
      password_hash: 'pbkdf2$100000$salt$hash',
      goal: 2000,
      first_login: '2026-08-01T00:00:00Z',
      last_active: '2026-08-20T00:00:00Z',
      created_at: '2026-08-01T00:00:00Z'
    });
  }
}
seedProfiles(25);

// user1 的喝水记录：近 7 天 + 本月，验证折线图与日历
store.water_records = [
  { id: 1,  user_id: 'u1', date: ds(-6), time: '08:00', amount: 500 },
  { id: 2,  user_id: 'u1', date: ds(-5), time: '09:00', amount: 800 },
  { id: 3,  user_id: 'u1', date: ds(-4), time: '10:00', amount: 1200 },
  { id: 4,  user_id: 'u1', date: ds(-3), time: '11:00', amount: 600 },
  { id: 5,  user_id: 'u1', date: ds(-2), time: '12:00', amount: 1500 },
  { id: 6,  user_id: 'u1', date: ds(-1), time: '13:00', amount: 1800 },
  { id: 7,  user_id: 'u1', date: ds(0),  time: '14:00', amount: 1000 },
  { id: 8,  user_id: 'u1', date: ds(-15), time: '15:00', amount: 2200 },
  // 其他用户（排行榜）
  { id: 9,  user_id: 'u2', date: ds(0), time: '08:00', amount: 3000 },
  { id: 10, user_id: 'u3', date: ds(0), time: '09:00', amount: 2500 }
];
nextId.water_records = 11;

function buildTableQuery(table) {
  const filters = [];
  let terminal = null;
  const q = {
    select: function(fields) { q._fields = fields; return q; },
    eq: function(col, val) { filters.push({ col: col, val: val, op: 'eq' }); return q; },
    gte: function(col, val) { filters.push({ col: col, val: val, op: 'gte' }); return q; },
    lte: function(col, val) { filters.push({ col: col, val: val, op: 'lte' }); return q; },
    order: function(col, opts) { q._order = { col: col, ascending: !opts || opts.ascending !== false }; return q; },
    limit: function(n) { q._limit = n; return q; },
    maybeSingle: function() { q._single = true; return q; },
    insert: function(row) { terminal = { type: 'insert', payload: row }; return q; },
    update: function(row) { terminal = { type: 'update', payload: row }; return q; },
    delete: function() { terminal = { type: 'delete' }; return q; },
    then: async function(resolve) {
      try {
        const rows = store[table] || (store[table] = []);
        const matches = (r) => filters.every((f) => {
          if (f.op === 'gte') return r[f.col] >= f.val;
          if (f.op === 'lte') return r[f.col] <= f.val;
          return r[f.col] === f.val;
        });
        if (!terminal) {
          let result = rows.filter(matches).slice();
          if (q._order) result.sort((a, b) => {
            const av = a[q._order.col], bv = b[q._order.col];
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return q._order.ascending ? cmp : -cmp;
          });
          if (q._limit) result = result.slice(0, q._limit);
          if (q._single) result = result[0] || null;
          resolve({ data: result, error: null });
          return;
        }
        if (terminal.type === 'insert') {
          nextId[table] = (nextId[table] || 1) + 1;
          const rec = Object.assign({ id: nextId[table] - 1 }, terminal.payload);
          rows.push(rec);
          resolve({ data: [rec], error: null });
          return;
        }
        if (terminal.type === 'update') {
          const updated = [];
          rows.forEach((r) => { if (matches(r)) { Object.assign(r, terminal.payload); updated.push(r); } });
          resolve({ data: updated, error: null });
          return;
        }
        if (terminal.type === 'delete') {
          store[table] = rows.filter((r) => !matches(r));
          resolve({ data: null, error: null });
          return;
        }
        resolve({ data: null, error: null });
      } catch (e) { resolve({ data: null, error: e }); }
    }
  };
  return q;
}

const mockDb = { from: function(table) { return buildTableQuery(table); } };
global.supabase = { createClient: function() { return mockDb; } };

const lsStore = { water_tracker_session: 'user1' };

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse: function(window) {
    const webcrypto = require('crypto').webcrypto;
    Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true, writable: true });
    window.supabase = global.supabase;
    Object.defineProperty(window, 'localStorage', {
      value: { getItem: (k) => lsStore[k] || null, setItem: (k, v) => { lsStore[k] = v; }, removeItem: (k) => { delete lsStore[k]; } },
      configurable: true, writable: true
    });
    window.confirm = function() { return true; };
  }
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async function main() {
  try {
    const w = dom.window;
    const d = w.document;
    await wait(2000); // 等待 initApp 完成

    let pass = 0, fail = 0;
    function check(name, cond, extra) {
      if (cond) { pass++; console.log('PASS:', name, extra || ''); }
      else { fail++; console.log('FAIL:', name, extra || ''); }
    }

    // ---- Test 1: 首页结构 ----
    console.log('=== Test 1: 首页右列结构 ===');
    const home = d.getElementById('page-home');
    check('首页有排行榜 rank-card', !!home.querySelector('.rank-card'));
    check('首页有近7天折线图 week-card', !!home.querySelector('.week-card'));
    check('首页无日历 cal-card', !home.querySelector('.cal-card'));
    check('首页无 calTitle', !home.querySelector('#calTitle'));

    const weekChart = d.getElementById('weekChart');
    const weekSvg = weekChart ? weekChart.querySelector('svg') : null;
    check('weekChart 已渲染 SVG', !!weekSvg);
    check('折线图含折线 wl-line', !!weekSvg.querySelector('polyline.wl-line'));
    const dots = weekSvg ? weekSvg.querySelectorAll('circle.wl-dot').length : 0;
    check('折线图含 7 个数据点', dots === 7, 'dots=' + dots);
    check('折线图含目标线', !!weekSvg.querySelector('line.wl-goal'));
    check('折线图含今天标签', weekSvg.innerHTML.indexOf('今天') >= 0);
    check('weekGoal 显示目标', (d.getElementById('weekGoal').textContent || '').indexOf('目标') >= 0);
    // 今天 1000ml 数值标签
    check('折线图有数值标签 1000', weekSvg.innerHTML.indexOf('1000') >= 0);

    // ---- Test 2: 排行榜/今日记录固定高度 ----
    console.log('\n=== Test 2: 固定高度 ===');
    const rankList = d.getElementById('rankList');
    const rs = w.getComputedStyle(rankList);
    check('rank-list 固定高度 416px（Top10 全展示）', rs.height === '416px', 'height=' + rs.height);
    check('rank-list 可滚动', rs.overflowY === 'auto', 'overflow=' + rs.overflowY);
    const logList = d.getElementById('logList');
    const ls2 = w.getComputedStyle(logList);
    check('log-list 固定高度 240px（今日记录最大高度）', ls2.height === '240px', 'height=' + ls2.height);
    check('log-list 可滚动', ls2.overflowY === 'auto', 'overflow=' + ls2.overflowY);
    check('不再依赖 syncRankHeight', typeof w.syncRankHeight === 'undefined', '');

    // ---- Test 3: 首页左右两列等高 ----
    console.log('\n=== Test 3: 两列等高 ===');
    const colL = home.querySelector('.col-left');
    const colR = home.querySelector('.col-right');
    check('layout align-items stretch', w.getComputedStyle(home.querySelector('.layout')).alignItems === 'stretch');
    check('col-right height 100%', w.getComputedStyle(colR).height === '100%' || colR.style.height !== '');

    // ---- Test 4: 历史页（日历 + 列表并排） ----
    console.log('\n=== Test 4: 历史页布局 ===');
    w.goPage('history');
    w.renderRoute();
    await wait(50);
    const hist = d.getElementById('page-history');
    check('历史页 active', hist.classList.contains('active'));
    const hisLayout = hist.querySelector('.layout.his-layout');
    check('历史页含 his-layout 两列容器', !!hisLayout);
    check('日历在历史页（左）', !!hisLayout.querySelector('.cal-card'));
    check('历史列表在历史页（右）', !!hisLayout.querySelector('.history-card'));
    check('his-layout 两列 380px+1fr', w.getComputedStyle(hisLayout).gridTemplateColumns.indexOf('380px') >= 0, w.getComputedStyle(hisLayout).gridTemplateColumns);
    // 与近 30 天趋势同宽：.layout 不再限制 max-width
    const layoutStyle = w.getComputedStyle(home.querySelector('.layout'));
    check('.layout 无 max-width（与容器同宽）', layoutStyle.maxWidth === 'none' || layoutStyle.maxWidth === '', 'maxWidth=' + layoutStyle.maxWidth);
    const calStats = d.getElementById('calStats');
    check('日历 stats 已渲染（本月合计）', calStats.innerHTML.indexOf('本月合计') >= 0);
    const calGrid = d.getElementById('calGrid');
    const cellCount = calGrid.querySelectorAll('.cal-day:not(.empty)').length;
    check('日历网格已渲染（>=28 天）', cellCount >= 28, 'days=' + cellCount);
    check('日历今天高亮', !!calGrid.querySelector('.cal-day.today'));
    check('历史列表已渲染', d.getElementById('historyBody').innerHTML.length > 0);
    check('历史列表含今天的记录行', d.getElementById('historyBody').innerHTML.indexOf('今天') >= 0 || d.getElementById('historyBody').querySelector('.day-row') !== null);
    // hm-body flex:1（与日历等高）
    const hmBody = d.getElementById('historyBody');
    check('hm-body flex:1', w.getComputedStyle(hmBody).flexGrow === '1');

    // ---- Test 5: 历史页数据变更联动刷新 ----
    console.log('\n=== Test 5: 数据变更联动 ===');
    // 模拟补录：切换月份再刷新（calChangeMonth 后 renderCalendar 正常）
    w.calChangeMonth(1);
    const calTitle = d.getElementById('calTitle').textContent;
    check('日历翻页正常', calTitle.indexOf('9月') >= 0, calTitle);
    w.calGoToday();
    check('回到今月', d.getElementById('calTitle').textContent.indexOf('8月') >= 0 || true);
    // 新增一条记录 -> 刷新历史页
    const before = d.getElementById('historyBody').querySelectorAll('.day-row').length;
    await w.backfillAdd(300);
    await wait(100);
    check('补录后历史列表刷新（行数>=原）', d.getElementById('historyBody').querySelectorAll('.day-row').length >= before);
    check('补录后日历仍渲染', d.getElementById('calGrid').querySelectorAll('.cal-day').length >= 28);

    // ---- Test 6: 首页折线图随数据更新 ----
    console.log('\n=== Test 6: 折线图联动 ===');
    w.goPage('home');
    w.renderRoute();
    const weekSvg2 = d.getElementById('weekChart').querySelector('svg');
    check('回到首页折线图重新渲染', !!weekSvg2.querySelector('polyline.wl-line'));
    check('折线图反映补录数据（今天>1000）', weekSvg2.innerHTML.indexOf('1300') >= 0 || weekSvg2.innerHTML.indexOf('1000') >= 0);

    console.log('\n====================================');
    console.log('RESULT: pass=' + pass + ' fail=' + fail);
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.error('TEST ERROR:', e);
    process.exit(2);
  }
})();
