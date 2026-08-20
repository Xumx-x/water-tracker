// 荣誉墙功能 jsdom 冒烟测试（v11.6：user_id 关联版）
const fs = require('fs');
const { JSDOM } = require('C:\\Users\\12746\\.workbuddy\\binaries\\node\\workspace\\node_modules\\jsdom');

const html = fs.readFileSync('C:\\soft\\water-tracker\\index.html', 'utf8');

// ---- 内存 Mock Supabase ----
const store = { honor_badges: [], profiles: [] };
const mockProfs = [
  { id: 'u1', username: 'alice' },
  { id: 'u2', username: 'bob' },
  { id: 'u3', username: 'carol' },
  { id: 'u4', username: 'dave' }
];

function buildTableQuery(table) {
  const filters = [];
  let terminal = null;
  const q = {
    select: function(fields) { q._fields = fields; return q; },
    eq: function(col, val) { filters.push({ col: col, val: val }); return q; },
    order: function(col, opts) { q._order = { col: col, ascending: !opts || opts.ascending !== false }; return q; },
    limit: function(n) { q._limit = n; return q; },
    maybeSingle: function() { q._single = true; return q; },
    insert: function(row) { terminal = { type: 'insert', payload: row }; return q; },
    update: function(row) { terminal = { type: 'update', payload: row }; return q; },
    delete: function() { terminal = { type: 'delete' }; return q; },
    then: async function(resolve) {
      try {
        const rows = store[table] || (store[table] = []);
        const matches = (r) => filters.every((f) => r[f.col] === f.val);
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
        resolve({ data: null, error: new Error('not supported in mock') });
      } catch (e) { resolve({ data: null, error: e }); }
    }
  };
  return q;
}

const mockDb = { from: function(table) { if (table === 'profiles') store.profiles = mockProfs; return buildTableQuery(table); } };
global.supabase = { createClient: function() { return mockDb; } };

// ---- 预置勋章数据（user_id 关联） ----
store.honor_badges.push(
  { user_id: 'u1', badge_type: 'daily', count: 2 },
  { user_id: 'u1', badge_type: 'achieve', count: 5 },
  { user_id: 'u2', badge_type: 'weekly', count: 3 },
  { user_id: 'u2', badge_type: 'monthly', count: 1 },
  { user_id: 'u2', badge_type: 'achieve', count: 2 },
  { user_id: 'u3', badge_type: 'daily', count: 1 },
  { user_id: 'u4', badge_type: 'achieve', count: 10 }
);

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse: function(window) {
    const webcrypto = require('crypto').webcrypto;
    Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true, writable: true });
    window.supabase = global.supabase;
    const ls = {};
    Object.defineProperty(window, 'localStorage', {
      value: { getItem: (k) => ls[k] || null, setItem: (k, v) => { ls[k] = v; }, removeItem: (k) => { delete ls[k]; } },
      configurable: true, writable: true
    });
  }
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async function main() {
  try {
    const w = dom.window;
    const d = w.document;
    await wait(1500);

    let pass = 0, fail = 0;
    function check(name, cond, extra) {
      if (cond) { pass++; console.log('PASS:', name, extra || ''); }
      else { fail++; console.log('FAIL:', name, extra || ''); }
    }

    // ---- Test 1: 导航 ----
    console.log('=== Test 1: 导航菜单 ===');
    const links = Array.from(d.querySelectorAll('.nav-link'));
    const pages = links.map(a => a.getAttribute('data-page'));
    check('导航顺序 home→honor→history→forum', JSON.stringify(pages) === JSON.stringify(['home', 'honor', 'history', 'forum']), JSON.stringify(pages));
    check('PAGES 含 honor', w.PAGES.indexOf('honor') >= 0);

    // ---- Test 2: 路由 ----
    console.log('\n=== Test 2: 路由 ===');
    w.currentUser = 'alice';
    w.currentUserId = 'u1';
    w.currentUserRole = 'user';
    w.goPage('honor');
    w.renderRoute();
    check('page-honor active', d.getElementById('page-honor').classList.contains('active'));
    check('荣誉墙菜单高亮', d.querySelector('.nav-link[data-page="honor"]').classList.contains('active'));

    // ---- Test 3: 个人勋章（按 user_id 取） ----
    console.log('\n=== Test 3: 个人勋章 ===');
    await w.loadHonorWall();
    const myBadges = d.getElementById('honorMyBadges').querySelectorAll('.honor-badge-card');
    check('渲染 5 张勋章卡', myBadges.length === 5, 'actual=' + myBadges.length);
    const counts = Array.from(myBadges).map(c => c.querySelector('.hb-count').textContent);
    check('alice 计数 2/0/0/5/7', JSON.stringify(counts) === JSON.stringify(['2', '0', '0', '5', '7']), JSON.stringify(counts));

    // ---- Test 4: TOP50 排序（用户名来自 userNameMap） ----
    console.log('\n=== Test 4: TOP50 排名 ===');
    const rows = d.getElementById('honorRankList').querySelectorAll('.honor-rank-row');
    check('渲染 4 行', rows.length === 4, 'actual=' + rows.length);
    const users = Array.from(rows).map(r => r.querySelector('.c-user').textContent.replace('我', '').trim());
    check('按总数降序 dave→alice→bob→carol', JSON.stringify(users) === JSON.stringify(['dave', 'alice', 'bob', 'carol']), JSON.stringify(users));
    check('第一名 🥇', rows[0].querySelector('.c-rank').textContent === '🥇');
    check('自己所在行高亮(me)', rows[1].classList.contains('me'));
    check('alice 行有「我」标签', !!rows[1].querySelector('.honor-me-tag'));
    const bobCells = Array.from(rows[2].querySelectorAll('.c-badge')).map(c => c.textContent);
    check('bob 各勋章列 0/3/1/2', JSON.stringify(bobCells) === JSON.stringify(['0', '3', '1', '2']), JSON.stringify(bobCells));

    // ---- Test 5: 空数据 ----
    console.log('\n=== Test 5: 空数据 ===');
    store.honor_badges.length = 0;
    await w.loadHonorWall();
    check('空数据提示存在', !!d.getElementById('honorRankList').querySelector('.honor-rank-empty'));
    const emptyBadges = d.getElementById('honorMyBadges').querySelectorAll('.honor-badge-card');
    check('空数据个人勋章全 0', emptyBadges.length === 5 && emptyBadges[4].querySelector('.hb-count').textContent === '0');

    // ---- Test 6: 超过 50 人截断 ----
    console.log('\n=== Test 6: TOP50 截断 ===');
    const extraProfs = [];
    for (let i = 1; i <= 60; i++) extraProfs.push({ id: 'ux' + i, username: 'user' + i });
    mockProfs.push.apply(mockProfs, extraProfs);
    for (let i = 1; i <= 60; i++) {
      store.honor_badges.push({ user_id: 'ux' + i, badge_type: 'achieve', count: i });
    }
    await w.loadHonorWall();
    const rows2 = d.getElementById('honorRankList').querySelectorAll('.honor-rank-row');
    check('最多渲染 50 行', rows2.length === 50, 'actual=' + rows2.length);
    check('第一名 user60', rows2[0].querySelector('.c-user').textContent === 'user60');

    console.log('\n========== 结果: ' + pass + ' passed, ' + fail + ' failed ==========');
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.error('TEST CRASH:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
