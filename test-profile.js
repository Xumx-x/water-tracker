// 个人中心 + 排行榜遮罩 + 后台分页/改名 jsdom 冒烟测试
const fs = require('fs');
const { JSDOM } = require('C:\\Users\\12746\\.workbuddy\\binaries\\node\\workspace\\node_modules\\jsdom');

const html = fs.readFileSync('C:\\soft\\water-tracker\\index.html', 'utf8');

// ---- 内存 Mock Supabase ----
const store = { profiles: [], water_records: [] };
const nextId = { water_records: 1 };
let delLog = [];

function seedProfiles(n) {
  store.profiles.length = 0;
  for (let i = 1; i <= n; i++) {
    store.profiles.push({
      id: 'u' + i,
      username: 'user' + i,
      role: i === 1 ? 'admin' : 'user',
      password_hash: 'pbkdf2$100000$salt$hash',
      goal: 2000,
      first_login: '2026-0' + ((i % 9) + 1) + '-01T00:00:00Z',
      last_active: '2026-08-20T00:00:00Z',
      created_at: '2026-0' + ((i % 9) + 1) + '-01T00:00:00Z'
    });
  }
}
seedProfiles(25);

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
          // 模拟 username 唯一约束（23505）
          if (table === 'profiles' && terminal.payload.username !== undefined) {
            const dup = rows.some((r) => matches(r) && r.username !== terminal.payload.username &&
              rows.some((o) => o !== r && o.username === terminal.payload.username));
            if (dup) { resolve({ data: null, error: { code: '23505', message: 'duplicate' } }); return; }
          }
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

// 预置登录会话（模拟浏览器刷新前的状态）
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
    await wait(1800); // 等待 initApp 完成

    let pass = 0, fail = 0;
    function check(name, cond, extra) {
      if (cond) { pass++; console.log('PASS:', name, extra || ''); }
      else { fail++; console.log('FAIL:', name, extra || ''); }
    }

    // ---- Test 1: 刷新后自动恢复会话（不闪登录页） ----
    console.log('=== Test 1: 刷新恢复 ===');
    check('initApp 后登录层隐藏', d.getElementById('loginOverlay').classList.contains('hidden'));
    check('currentUser=user1', w.currentUser === 'user1');
    check('currentUserId=u1', w.currentUserId === 'u1');
    check('currentUserRole=admin', w.currentUserRole === 'admin');
    // 保持在当前页面：hash 为 #/forum 时渲染 forum
    w.location.hash = '#/forum';
    w.renderRoute();
    check('hash 为 forum 时停留在论坛页', d.getElementById('page-forum').classList.contains('active'));
    w.goPage('home');

    // ---- Test 2: 下拉菜单与个人中心页面 ----
    console.log('\n=== Test 2: 个人中心 ===');
    const ddItems = Array.from(d.querySelectorAll('#userDropdown .dd-item')).map(b => b.textContent.trim());
    check('下拉含个人中心与设置', JSON.stringify(ddItems) === JSON.stringify(['👤 个人中心', '⚙️ 设置']), JSON.stringify(ddItems));
    w.goPage('profile');
    w.renderRoute();
    check('page-profile active', d.getElementById('page-profile').classList.contains('active'));
    check('个人中心显示当前用户名', d.getElementById('profileCurName').value.indexOf('user1') >= 0);
    check('settings 页无修改密码卡片', !d.getElementById('page-settings').innerHTML.includes('修改密码'));
    check('profile 页含修改密码表单', !!d.getElementById('pwOld') && !!d.getElementById('pwNew'));

    // ---- Test 3: 修改用户名 ----
    console.log('\n=== Test 3: 修改用户名 ===');
    d.getElementById('profileUsername').value = 'admin001';
    await w.changeUsername();
    check('profiles 用户名已更新', store.profiles[0].username === 'admin001');
    check('currentUser 已同步', w.currentUser === 'admin001');
    check('会话已更新', lsStore.water_tracker_session === 'admin001');
    check('userNameMap 已更新', w.userNameMap['u1'] === 'admin001');
    check('导航栏已更新', d.getElementById('navUserName').textContent === 'admin001');

    // ---- Test 4: 排行榜遮罩 ----
    console.log('\n=== Test 4: 排行榜遮罩 ===');
    const rankLoading = d.getElementById('rankLoading');
    check('遮罩元素存在', !!rankLoading);
    // 等待 changeUsername 触发的异步 loadRanking 完成
    await wait(400);
    check('加载完成后遮罩隐藏', !rankLoading.classList.contains('show'));
    store.water_records.push({ id: 1, user_id: 'u1', date: '2026-08-20', time: '08:00', amount: 500 });
    w.loadRanking('day');
    await wait(150);
    check('重新加载完成后遮罩隐藏', !rankLoading.classList.contains('show'));
    const rankRows = d.querySelectorAll('#rankList .rank-row');
    check('排行榜数据渲染', rankRows.length >= 1, 'count=' + rankRows.length);
    // 请求开始时应显示遮罩（代码路径：setRankLoading(true)）
    check('renderRanking 后 rankList 有数据', d.getElementById('rankList').querySelector('.rank-row') !== null);

    // ---- Test 5: 后台分页 ----
    console.log('\n=== Test 5: 后台分页 ===');
    w.goPage('home');
    w.currentUserRole = 'admin';
    await w.showAdminPanel();
    let rows = d.getElementById('adminUserList').querySelectorAll('.admin-user-row');
    check('第一页渲染 20 行', rows.length === 20, 'actual=' + rows.length);
    const pgInfo = d.getElementById('adminPagination').querySelector('.admin-pg-info');
    check('分页显示 1 / 2', pgInfo && pgInfo.textContent.trim() === '1 / 2', pgInfo ? pgInfo.textContent : 'MISSING');
    w.adminGoPage(2);
    await wait(30);
    rows = d.getElementById('adminUserList').querySelectorAll('.admin-user-row');
    check('第二页渲染 5 行', rows.length === 5, 'actual=' + rows.length);
    check('第二页信息 2 / 2', d.getElementById('adminPagination').querySelector('.admin-pg-info').textContent.trim() === '2 / 2');

    // ---- Test 6: 后台搜索 ----
    console.log('\n=== Test 6: 后台搜索 ===');
    d.getElementById('adminSearchInput').value = 'user22';
    w.adminSearchChanged();
    await wait(30);
    rows = d.getElementById('adminUserList').querySelectorAll('.admin-user-row');
    check('搜索 user22 渲染 1 行', rows.length === 1, 'actual=' + rows.length);
    check('搜索命中 user22', rows[0].querySelector('.au-name').textContent.indexOf('user22') >= 0);
    check('计数显示共 1 人', d.getElementById('adminCount').textContent.indexOf('1 人') >= 0);
    d.getElementById('adminSearchInput').value = '';
    w.adminSearchChanged();
    await wait(30);

    // ---- Test 7: 后台排序（创建时间） ----
    console.log('\n=== Test 7: 排序 ===');
    d.getElementById('adminSortSelect').value = 'created';
    w.adminSortChanged();
    await wait(30);
    const firstRowName = d.getElementById('adminUserList').querySelector('.au-name').textContent;
    // 种子数据创建时间：user8 → 2026-09-01（最新），user9 → 2026-01-01
    check('按创建时间排序首行 user8', firstRowName.indexOf('user8') >= 0, firstRowName);

    // ---- Test 8: 后台改名 ----
    console.log('\n=== Test 8: 改名 ===');
    w.confirmRenameUser('u2', 'user2');
    check('改名弹窗显示', d.getElementById('renameUserOverlay').classList.contains('show'));
    check('弹窗显示旧名', d.getElementById('renameUserOldName').textContent === 'user2');
    d.getElementById('renameUserInput').value = 'renamed2';
    await w.executeRenameUser();
    check('改名写入 profiles', store.profiles[1].username === 'renamed2');
    check('改名后弹窗关闭', !d.getElementById('renameUserOverlay').classList.contains('show'));
    // 重复名冲突（renamed2 已被 Test 8 占用）
    w.confirmRenameUser('u3', 'user3');
    d.getElementById('renameUserInput').value = 'renamed2';
    await w.executeRenameUser();
    check('renamed2 已被占用时不写入', store.profiles[2].username === 'user3', store.profiles[2].username);

    console.log('\n========== 结果: ' + pass + ' passed, ' + fail + ' failed ==========');
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.error('TEST CRASH:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
