# 🚀 部署指南：Vercel 前端 + Supabase 数据库

把「喝了么」从本地单机版升级为**全网可访问的共享版**：

- **前端**：`index.html` 部署到 **Vercel**（静态托管，全球 CDN，免服务器）
- **数据库**：**Supabase**（PostgreSQL 云数据库，所有用户数据集中存储）

> 用户访问你分享的链接后，注册自己的用户名 + 密码即可开始记录，
> 数据写入同一套数据库；每位用户只能看到自己的记录，管理员可在后台总览全局。

---

## 架构一览

```
浏览器访问 Vercel 链接
        │
        ▼
   index.html（Vercel 静态托管）
        │  HTTPS
        ▼
  Supabase 数据库（PostgreSQL）
   ├─ profiles 表       用户（用户名/密码哈希/每日目标/登录时间）
   └─ water_records 表  喝水记录（日期/时间/毫升数）
```

---

## 第一步：创建 Supabase 项目（约 5 分钟）

1. 打开 <https://supabase.com>，用 GitHub 账号登录（免费版即可，足够个人/团队使用）
2. 点击 **New project**
   - **Name**：任意，如 `water-tracker`
   - **Database Password**：设置数据库密码（**请牢记**，用于 SQL 操作）
   - **Region**：选择离你近的区域，例如 `Southeast Asia (Singapore)`
   - 点击 **Create new project**，等待约 1~2 分钟初始化完成

## 第二步：执行建表脚本（约 1 分钟）

1. 进入项目后，点击左侧菜单 **SQL Editor** → **New query**
2. 把项目根目录 `supabase/schema.sql` 的全部内容粘贴进去
3. 点击右下角 **Run**（或按 `Ctrl+Enter`）
4. 看到 3 条 `CREATE TABLE` / `CREATE INDEX` / `CREATE POLICY` 成功提示即完成

> 该脚本会创建 `profiles`（用户表）和 `water_records`（记录表），
> 并配置好索引与行级安全策略。

## 第三步：获取连接信息并填入前端

1. 点击左侧菜单 **Project Settings**（齿轮图标）→ **API**
2. 复制两个值：
   - **Project URL**（形如 `https://xxxx.supabase.co`）
   - **anon public key**（一长串 eyJhbGci...）
3. 用编辑器打开本项目的 `index.html`，找到**文件顶部**的配置区：

```html
<script>
  var SUPABASE_URL = 'https://YOUR-PROJECT-URL.supabase.co';   // ← 改成你的 Project URL
  var SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';              // ← 改成你的 anon key
  var ADMIN_PASSWORD = 'water123';                             // ← 后台管理密码，建议修改
</script>
```

4. 保存文件

> ⚠️ **强烈建议同时修改 `ADMIN_PASSWORD`**（登录页底部「🛠 进入后台管理」的密码）。

## 第四步：部署到 Vercel（约 3 分钟）

### 方式 A：Vercel CLI（最简单，推荐）

1. 安装并登录 Vercel CLI：

```bash
npm i -g vercel
vercel login
```

2. 在项目根目录执行：

```bash
vercel --prod
```

按提示一路回车（首次会询问项目名、目录等，默认即可），
部署完成后终端会输出你的正式网址，例如 `https://water-tracker.vercel.app`。

### 方式 B：Vercel 网页控制台

1. 打开 <https://vercel.com>，用 GitHub 账号登录
2. 把项目目录上传到 GitHub 仓库（`index.html` + `supabase/` + `README.md`）
3. 点击 **Add New → Project**，导入该仓库
4. Framework Preset 选择 **Other**（纯静态站点），无需任何构建命令
5. 点击 **Deploy**，完成后即可通过 `https://<项目名>.vercel.app` 访问

> 纯静态项目部署到 Vercel 后，页面里对 Supabase 的请求走 HTTPS，完全安全。

---

## 部署后验证

1. 打开部署好的链接，应看到登录页
2. 输入任意用户名 + 密码 → 首次输入自动注册
3. 添加几条喝水记录，刷新页面确认数据仍在（数据已写入 Supabase）
4. 换一个浏览器/设备，用同一账号登录 → 数据一致 ✅
5. 把链接分享给家人朋友，各自注册自己的账号即可使用

---

## 🛠 后台管理

- 登录页底部点击「🛠 进入后台管理」，输入 `ADMIN_PASSWORD`（默认 `water123`）
- 功能：
  - 用户总览：注册用户数、总记录、总饮水量、近 7 天日活
  - 用户列表：每人记录数/天数/总量/目标/登录时间
  - 🔑 **重置密码**：用户忘记密码时，管理员可为其设置新密码
  - 🗑 **删除用户**：永久删除该用户及其全部记录
  - 📤 **导出全部数据**：一键备份所有用户数据（JSON）
  - 📥 **导入全部数据**：从备份文件恢复（会覆盖当前数据，需二次确认）

> 管理面板为纯前端实现，密码仅作展示层访问控制。对喝水记录类低敏感数据足够，
> 如需金融级安全请改用 Supabase Auth 接入邮箱/手机号登录。

---

## ❓ 常见问题

### 用户忘了密码怎么办？
管理员进入后台管理 → 点击该用户行的 **🔑** 按钮 → 设置新密码，告知用户即可。

### 旧版 localStorage 里的数据怎么迁移？
登录后点击右上角 **📥** 导入旧版导出的 `water-data.js` 备份文件即可，
导入会写入当前用户的 Supabase 数据（**不会**覆盖密码和账号信息）。

### 数据安全吗？
- 传输全程 HTTPS 加密
- 密码使用 **PBKDF2（10 万次迭代 + 随机盐）** 哈希后存储，不存明文
- 数据库开启行级安全（RLS），配合应用层用户名 + 密码校验实现数据隔离
- 局限：纯前端方案下，数据库连接凭据（anon key）对浏览器可见，
  知道他人用户名即可尝试登录，因此**务必设好每个人的密码**。
  该设计适合亲友/团队内部使用，不适合对公开放数据

### 想停用/删除部署？
Vercel 控制台 → 项目 → Settings → Danger Zone → Delete Project；
Supabase 控制台 → Project Settings → Danger Zone → Delete Project。

---

## 📁 文件清单

| 文件 | 说明 |
|------|------|
| `index.html` | **云端版应用本体**（Vercel 部署入口，部署前需填 Supabase 配置） |
| `supabase/schema.sql` | 数据库建表脚本（在 Supabase SQL Editor 执行） |
| `DEPLOY.md` | 本部署指南 |
| `water-tracker.html` | 旧版本地单文件应用（localStorage 版，保留作离线备用） |
| `water-data.js` | 旧版初始数据文件（可选） |
