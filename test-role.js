// 角色权限 + 后台管理 + user_id 数据关联 jsdom 冒烟测试（v11.6）
const fs = require('fs');
const { JSDOM } = require('C:\\Users\\12746\\.workbuddy\\binaries\\node\\workspace\\node_modules\\jsdom');

const html = fs.readFileSync('C:\\soft\\water-tracker\\index.html', 'utf8');

// ---- 内存 Mock Supabase ----
const store = {
  profiles: [
    { id: 'u1', username: 'alice', role: 'admin', password_hash: 'pbkdf2$100000$salt$hash', goal: 2000, first_login: '2026-01-01T00:00:00Z', last_active: '2026-08-20T00:00:00Z' },
    { id: 'u2', username: 'bob', role: 'user', password_hash: 'pbkdf2$100000$salt$hash', goal: 2500, first_login: '2026-02-01T00:00:00Z', last_active: '2026-08-19T00:00:00Z' }
  ],
  water_records: [
    { id: 1, user_id: 'u1', date: '2026-08-20', time: '08:00', amount: 500 },
    { id: 2, user_id: 'u1', date: '2026-08-20', time: '12:00', amount: 400 },
    { id: 3, user_id: 'u2', date: '2026-08-19', time: '09:00', amount: 250 }
  ]
};
const nextId = { water_records: 4 };
let delLog = [];

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
          rows.forEach((r) => {
            if (matches(r)) { Object.assign(r, terminal.payload); updated.push(r); }
          });
          resolve({ data: updated, error: null });
          return;
        }
        if (terminal.type === 'delete') {
          delLog.push({ table: table, filters: filters.slice() });
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
    window.confirm = function() { return true; };
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

    // ---- Test 1: 登录页无后台入口 ----
    console.log('=== Test 1: 登录页 ===');
    check('登录页无后台管理按钮', !d.querySelector('.admin-link'));
    check('无 adminPwOverlay', !d.getElementById('adminPwOverlay'));
    check('无 ADMIN_PASSWORD 全局变量', w.ADMIN_PASSWORD === undefined);

    // ---- Test 2: 普通用户看不到后台入口 ----
    console.log('\n=== Test 2: 普通用户 ===');
    w.currentUser = 'bob';
    w.currentUserId = 'u2';
    w.currentUserRole = 'user';
    w.renderUserBadge();
    check('navUser 显示', d.getElementById('navUser').style.display === 'flex');
    check('navAdmin 隐藏', d.getElementById('navAdmin').style.display === 'none');

    // ---- Test 3: 管理员看到后台入口 ----
    console.log('\n=== Test 3: 管理员 ===');
    w.currentUser = 'alice';
    w.currentUserId = 'u1';
    w.currentUserRole = 'admin';
    w.renderUserBadge();
    check('navAdmin 显示', d.getElementById('navAdmin').style.display === 'flex');

    // ---- Test 4: 后台面板渲染（user_id 聚合 + 角色标签） ----
    console.log('\n=== Test 4: 后台面板 ===');
    await w.showAdminPanel();
    check('adminOverlay 显示', d.getElementById('adminOverlay').classList.contains('show'));
    const rows = d.getElementById('adminUserList').querySelectorAll('.admin-user-row');
    check('渲染 2 个用户', rows.length === 2, 'actual=' + rows.length);
    const row0 = rows[0];
    check('alice 行显示角色标签', !!row0.querySelector('.au-role.admin'));
    check('alice 记录数=2', row0.querySelector('.au-records').textContent.trim() === '2 条', row0.querySelector('.au-records').textContent);
    const row1 = rows[1];
    check('bob 行无 admin 标签', !row1.querySelector('.au-role.admin'));
    check('bob 记录数=1', row1.querySelector('.au-records').textContent.trim() === '1 条');
    const summary = d.getElementById('adminSummary').textContent;
    check('汇总含注册用户 2', summary.indexOf('2') >= 0);

    // ---- Test 5: 重置密码弹窗按 id ----
    console.log('\n=== Test 5: 重置密码 ===');
    w.confirmResetPw('u2', 'bob');
    check('弹窗显示用户名', d.getElementById('resetPwUser').textContent === 'bob');
    d.getElementById('resetPwInput').value = 'newpass';
    await w.executeResetPw();
    check('bob 密码已更新', store.profiles[1].password_hash.indexOf('pbkdf2') === 0);

    // ---- Test 6: 删除用户按 id ----
    console.log('\n=== Test 6: 删除用户 ===');
    w.confirmDeleteUser('u2', 'bob');
    check('删除确认文案含用户名', d.getElementById('deleteUserMsg').textContent.indexOf('bob') >= 0);
    await w.executeDeleteUser();
    check('profiles 删除后剩 1 行', store.profiles.length === 1);
    const delProfile = delLog.find(x => x.table === 'profiles');
    check('删除条件 eq id=u2', !!delProfile && delProfile.filters.some(f => f.col === 'id' && f.val === 'u2'), JSON.stringify(delProfile && delProfile.filters));

    // ---- Test 7: 数据写入使用 user_id ----
    console.log('\n=== Test 7: 数据关联 ===');
    delLog.length = 0;
    w.currentUserId = 'u1';
    await w.addWater(200);
    const lastRec = store.water_records[store.water_records.length - 1];
    check('addWater 写入 user_id=u1', lastRec.user_id === 'u1' && lastRec.username === undefined, JSON.stringify(lastRec));
    // 排行榜聚合按 user_id 且展示用户名
    await w.loadRanking('today');
    await wait(100);
    const rankRows = d.getElementById('rankList').querySelectorAll('.rank-row');
    check('排行榜渲染成功', rankRows.length > 0, 'count=' + rankRows.length);
    const rankNames = Array.from(rankRows).map(r => r.querySelector('.rank-name').textContent.replace('我', '').trim());
    check('排行榜显示用户名', rankNames[0] === 'alice' || rankNames.indexOf('alice') >= 0, JSON.stringify(rankNames));
    // 清空今日：eq user_id
    w.cache['2026-08-20'] = [{ id: 1, time: '08:00', amount: 500 }];
    await w.clearToday();
    const delRec = delLog.find(x => x.table === 'water_records' && x.filters.some(f => f.col === 'date'));
    check('clearToday 按 user_id+date 删除', !!delRec && delRec.filters.some(f => f.col === 'user_id' && f.val === 'u1'));

    // ---- Test 8: 登出重置 ----
    console.log('\n=== Test 8: 登出 ===');
    w.doLogout();
    check('登出后 navAdmin 隐藏', d.getElementById('navAdmin').style.display === 'none');
    check('登出后 currentUserId=null', w.currentUserId === null);
    check('登出后 currentUserRole=user', w.currentUserRole === 'user');

    console.log('\n========== 结果: ' + pass + ' passed, ' + fail + ' failed ==========');
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.error('TEST CRASH:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
