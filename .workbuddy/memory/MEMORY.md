# 喝水追踪器 · 项目长期记忆

## 产品形态
- 双版本：**云端共享版**（index.html，**Netlify** + Supabase，推荐）与**本地单机版**（water-tracker.html，localStorage，离线备用）
- 用户偏好单文件 HTML、双击即用、可分享

## 容量配置（产品约定，勿改）
- 小杯 150ml / 标准杯 250ml / 大杯 400ml / 瓶装 500ml，每日目标默认 2000ml（范围 500~10000）

## 云端版架构（v11.3）
- 前端：**Netlify** 静态托管（用户实际部署平台，非 Vercel），supabase-js 走 CDN UMD，零构建
- 数据库：Supabase PostgreSQL，两张表
  - `profiles`：username(PK) / password_hash(PBKDF2 格式 `pbkdf2$100000$salt$hex`) / goal / first_login / last_active
  - `water_records`：id(自增 PK) / username(FK 级联删) / date / time / amount
- 鉴权：纯前端用户名+密码，PBKDF2(10万迭代) 校验，RLS 全开（应用层隔离），适合亲友/团队内部
- 数据流：内存缓存同步渲染 UI + 操作异步精确写库；记录 id 用数据库自增主键
- 后台管理：聚合查询 + 重置密码（🔑）/删除用户（🗑）/全量备份恢复
- **🏆 排行榜（v11.1）**：右侧栏 Top10，每日/每周/每月 tab（自然周/自然月），自己高亮+名次提示；登录/数据变更后刷新（400ms 防抖）
- **🖥️ 布局（v11.2）**：Gitee 风格——固定 48px 深色导航栏（#1f2733，z-index 900）+ 居中容器（max-width 1200px）+ hash 路由三页面 `#/home` `#/history` `#/settings`；历史页含近 30 天趋势图+内联历史列表；设置页含每日目标+数据导入导出；用户下拉菜单（设置入口）+独立退出按钮
- **⚙️ 增强（v11.3）**：每日目标可手动输入（goalInput，Enter/onchange 提交）；历史记录每条可删除（deleteRecord 遍历所有日期缓存，删空移除日期键）；设置页可修改密码（旧密码校验→新密码≥6位→更新 password_hash）；页面文案 Vercel→Netlify
- **⚠️ 已知坑**：Supabase anon 默认禁用数据库聚合函数（PGRST123），排行榜等聚合需求必须前端拉明细再 JS 分组，或建 RPC/视图
- 部署步骤见 DEPLOY.md（仍写 Vercel，用户实际用 Netlify 未同步文档）；备份格式向后兼容旧版，旧格式导入默认密码 water123

## 用户环境
- Windows，工作区 C:\soft\water-tracker
- 已有 Supabase 项目（URL/anon key 已填入 index.html，表已建且有数据）；部署平台为 **Netlify**
