// 喝友论坛功能 jsdom 冒烟测试（v11.6：user_id 关联版）
const fs = require('fs');
const { JSDOM } = require('C:\\Users\\12746\\.workbuddy\\binaries\\node\\workspace\\node_modules\\jsdom');

const html = fs.readFileSync('C:\\soft\\water-tracker\\index.html', 'utf8');

// ---- 内存 Mock Supabase ----
const store = { forum_posts: [], forum_likes: [], forum_comments: [], profiles: [] };
const nextId = { forum_posts: 1, forum_likes: 1, forum_comments: 1 };
let mockProfs = [
  { id: 'u1', username: 'alice' },
  { id: 'u2', username: 'bob' },
  { id: 'u3', username: 'carol' }
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

const mockDb = {
  from: function(table) {
    if (table === 'profiles') store.profiles = mockProfs;
    return buildTableQuery(table);
  }
};
global.supabase = { createClient: function() { return mockDb; } };

// ---- 预置论坛数据（user_id 关联） ----
store.forum_posts.push(
  { id: 1, user_id: 'u1', title: '今天喝水目标达成', content: '坚持喝水第 30 天，感觉皮肤都变好了！', created_at: '2026-08-20T08:00:00Z' },
  { id: 2, user_id: 'u2', title: '求推荐水杯', content: '想买个 800ml 的大水杯，大家有什么推荐吗？', created_at: '2026-08-19T10:00:00Z' }
);
nextId.forum_posts = 3;
store.forum_likes.push(
  { id: 1, post_id: 1, user_id: 'u2', created_at: '2026-08-20T09:00:00Z' },
  { id: 2, post_id: 1, user_id: 'u3', created_at: '2026-08-20T09:10:00Z' }
);
nextId.forum_likes = 3;
store.forum_comments.push(
  { id: 1, post_id: 1, user_id: 'u2', content: '太厉害了，我也要坚持！', created_at: '2026-08-20T09:05:00Z' }
);
nextId.forum_comments = 2;

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

    // ---- Test 1: 导航 ----
    console.log('=== Test 1: 导航 ===');
    const forumLink = d.querySelector('.nav-link[data-page="forum"]');
    check('导航含喝友论坛', !!forumLink);
    check('PAGES 含 forum', w.PAGES.indexOf('forum') >= 0);

    // ---- Test 2: 登录态 + 路由 ----
    console.log('\n=== Test 2: 路由 ===');
    w.currentUser = 'alice';
    w.currentUserId = 'u1';
    w.currentUserRole = 'user';
    w.goPage('forum');
    w.renderRoute();
    check('page-forum active', d.getElementById('page-forum').classList.contains('active'));

    // ---- Test 3: 加载与渲染（作者名来自 userNameMap） ----
    console.log('\n=== Test 3: 帖子列表 ===');
    await w.loadForumPosts();
    const cards = d.getElementById('forumPostList').querySelectorAll('.post-card');
    check('渲染 2 张帖子卡片', cards.length === 2, 'actual=' + cards.length);
    check('作者显示 alice', cards[0].querySelector('.post-author').textContent === 'alice');
    check('作者显示 bob', cards[1].querySelector('.post-author').textContent === 'bob');
    check('点赞数=2', cards[0].querySelectorAll('.post-action')[0].textContent.replace(/\s+/g, ' ').trim() === '👍 2');
    check('评论数=1', cards[0].querySelectorAll('.post-action')[1].textContent.replace(/\s+/g, ' ').trim() === '💬 1');
    check('alice 帖子有删除按钮', !!cards[0].querySelector('.post-del'));
    check('bob 帖子无删除按钮', !cards[1].querySelector('.post-del'));

    // ---- Test 4: 查询 ----
    console.log('\n=== Test 4: 查询 ===');
    d.getElementById('forumSearchInput').value = '水杯';
    w.searchForum();
    await wait(50);
    check('搜索"水杯"只剩 1 帖', d.getElementById('forumPostList').querySelectorAll('.post-card').length === 1);

    // ---- Test 5: 刷新 ----
    console.log('\n=== Test 5: 刷新 ===');
    w.refreshForum();
    await wait(50);
    check('刷新后恢复 2 帖', d.getElementById('forumPostList').querySelectorAll('.post-card').length === 2);

    // ---- Test 6: 点赞（user_id 关联） ----
    console.log('\n=== Test 6: 点赞 ===');
    await w.toggleForumLike(1, null);
    check('点赞后 likedByMe[1]=true', w.forumState.likedByMe[1] === true);
    check('点赞后计数=3', w.forumState.likeCount[1] === 3);
    check('写入 forum_likes 3 行', store.forum_likes.length === 3);
    check('新点赞行 user_id=u1', store.forum_likes[2].user_id === 'u1');
    await w.toggleForumLike(1, null);
    check('取消点赞后计数=2', w.forumState.likeCount[1] === 2);
    check('删除后 forum_likes 2 行', store.forum_likes.length === 2);

    // ---- Test 7: 发帖（user_id 关联） ----
    console.log('\n=== Test 7: 发帖 ===');
    d.getElementById('postTitle').value = '新人报道';
    d.getElementById('postContent').value = '大家好，我是刚加入的喝水新手！';
    await w.submitForumPost();
    check('论坛新增 3 帖', store.forum_posts.length === 3);
    check('新帖 user_id=u1', store.forum_posts[2].user_id === 'u1');
    check('无 author 字段', store.forum_posts[2].author === undefined);
    await wait(50);
    check('列表重新渲染为 3 帖', d.getElementById('forumPostList').querySelectorAll('.post-card').length === 3);

    // ---- Test 8: 评论（user_id 关联） ----
    console.log('\n=== Test 8: 评论 ===');
    await w.openForumComments(1);
    const cmtItems = d.getElementById('commentList').querySelectorAll('.comment-item');
    check('渲染 1 条评论', cmtItems.length === 1);
    check('评论作者 bob', cmtItems[0].querySelector('.comment-author').textContent === 'bob');
    check('评论内容正确', cmtItems[0].querySelector('.comment-text').textContent === '太厉害了，我也要坚持！');
    d.getElementById('commentInput').value = '一起加油！';
    await w.addForumComment();
    await wait(50);
    check('评论新增 2 条', store.forum_comments.length === 2);
    check('新评论 user_id=u1', store.forum_comments[1].user_id === 'u1');
    check('评论数更新为 2', w.forumState.commentCount[1] === 2);
    w.closeForumComments();

    // ---- Test 9: 删除帖子 ----
    console.log('\n=== Test 9: 删除帖子 ===');
    await w.deleteForumPost(2);
    check('删除后 forum_posts 剩 2 帖', store.forum_posts.length === 2);

    // ---- Test 10: 空结果 ----
    console.log('\n=== Test 10: 空结果 ===');
    d.getElementById('forumSearchInput').value = '不存在的关键词xyz';
    w.searchForum();
    await wait(50);
    check('空结果提示存在', !!d.getElementById('forumPostList').querySelector('.forum-empty'));

    console.log('\n========== 结果: ' + pass + ' passed, ' + fail + ' failed ==========');
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.error('TEST CRASH:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
