# 喝水追踪器 · 项目长期记忆

## 产品形态
- 双版本：**云端共享版**（index.html，**Netlify** + Supabase，推荐）与**本地单机版**（water-tracker.html，localStorage，离线备用）
- 用户偏好单文件 HTML、双击即用、可分享

## 容量配置（产品约定，勿改）
- 小杯 150ml / 标准杯 250ml / 大杯 400ml / 瓶装 500ml，每日目标默认 2000ml（范围 500~10000）

## 云端版架构（v11.6）
- 前端：**Netlify** 静态托管（用户实际部署平台，非 Vercel），supabase-js 走 CDN UMD，零构建
- 数据库：Supabase PostgreSQL，八张表（**全部以 user_id 关联，无 username 外键**）
  - `profiles`：**id(uuid PK, default gen_random_uuid())** / username(unique) / **role(user|admin, 默认 user)** / password_hash(PBKDF2 `pbkdf2$100000$salt$hex`) / goal / custom_cups(JSON) / first_login / last_active
  - `water_records`：id(自增 PK) / **user_id**(FK 级联删) / date / time / amount
  - `forum_posts`：id / user_id(FK) / title(≤60) / content(≤2000) / created_at
  - `forum_likes`：id / post_id(FK 级联删) / user_id(FK) / **unique(post_id,user_id)** 防重复赞
  - `forum_comments`：id / post_id(FK 级联删) / user_id(FK) / content(≤500) / created_at
  - `honor_boards`：id / board_type / period / rank(1-3) / user_id(FK) / amount，**unique(board_type,period,user_id)** 幂等
  - `honor_badges`：**PK(user_id,badge_type)** / count
  - `honor_achieve`：user_id(FK) / record_date / total / goal，**unique(user_id,record_date)** 防重复计分
- 鉴权：纯前端用户名+密码，PBKDF2(10万迭代) 校验，RLS 全开（应用层隔离），适合亲友/团队内部
- **角色权限（v11.6）**：登录页后台入口已取消；管理员登录后导航栏「🛠 后台管理」（#navAdmin，renderUserBadge 按 role 显示，普通用户隐藏）；后台管理=管理员入口直开（无独立密码层）；`revoke insert/update (id, role) on profiles from anon, authenticated` 防提权；设置管理员：`update profiles set role='admin' where username='...'`
- 数据流：内存缓存同步渲染 UI + 操作异步精确写库；前端全局 `currentUserId`/`currentUserRole`/`userNameMap{}`（`loadUserNameMap()` 拉 id→username 映射，排行榜/论坛/荣誉墙/后台展示用户名）
- 后台管理：聚合查询 + 重置密码（🔑）/删除用户（🗑，均按 id）/全量备份恢复（导出含 id/role，导入兼容旧版字符串数组备份）
- **🏆 排行榜（v11.1）**：右侧栏 Top10，每日/每周/每月 tab（自然周/自然月），自己高亮+名次提示；登录/数据变更后刷新（400ms 防抖）；按 user_id 分组 + userNameMap 显示名
- **🖥️ 布局（v11.2）**：Gitee 风格——固定 48px 深色导航栏（#1f2733，z-index 900）+ 居中容器（max-width 1200px）+ hash 路由五页面 `#/home` `#/honor` `#/history` `#/forum` `#/settings`；历史页含近 30 天趋势图+内联历史列表；设置页含每日目标+数据导入导出；用户下拉菜单（设置入口）+独立退出按钮
- **⚙️ 增强（v11.3）**：每日目标可手动输入（goalInput）；历史记录每条可删除（deleteRecord 遍历所有日期缓存，删空移除日期键）；设置页可修改密码；快速记录自定义（DEFAULT_CUPS + getCups()/getCupIcon()，custom_cups 存 profiles，最多 8 个每行 4 个，补录弹窗同步动态化）；页面文案 Vercel→Netlify
- **💬 论坛（v11.4）**：导航新增喝友论坛；loadForumPosts 拉明细前端统计 likeCount/likedByMe/commentCount（PGRST123 对策）；toggleForumLike 增删 forum_likes；openForumComments/addForumComment 评论弹窗；searchForum 客户端过滤标题/内容/作者；refreshForum 清关键词重拉；deleteForumPost 仅作者本人（级联删赞/评）
- **🏆 荣誉墙（v11.5）**：pg_cron 定时（**北京时间=UTC+8**，日榜/达标 `0 17 * * *`/`30 17 * * *`、周榜 `0 17 * * 1`、月榜 `0 17 1 * *`）→ 生成函数 `generate_honor_board(+daily/weekly/monthly)` 与 `generate_honor_achieve()`（user_id 版）；**冻结机制**=INSERT ON CONFLICT DO NOTHING RETURNING，仅新增成功才发勋章；函数日期按 `Asia/Shanghai` 计算；函数已 revoke PUBLIC 执行权限；honor 三表 RLS 只读；前端页面展示个人 4 勋章 + TOP50 总榜（明细拉取前端聚合）
- **⚠️ 已知坑**：Supabase anon 默认禁用数据库聚合函数（PGRST123），排行榜/论坛计数必须前端拉明细再 JS 分组，或建 RPC/视图；jsdom 测试勿用 resources:'usable'（会真实加载 CDN supabase 覆盖 mock），用 beforeParse 注入；SQL 美元引用外层用 $do$ 内层用 $$（同标签不能嵌套）；mock 链式查询需含 gte/lte
- 部署步骤见 DEPLOY.md（已同步角色说明；Netlify 实际部署，DEPLOY 仍写 Vercel 未改）；备份格式向后兼容旧版，旧格式导入默认密码 water123

## 用户环境
- Windows，工作区 C:\soft\water-tracker
- 已有 Supabase 项目（URL/anon key 已填入 index.html，表已建且有数据）；部署平台为 **Netlify**
