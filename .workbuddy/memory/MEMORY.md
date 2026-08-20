# 喝水追踪器 · 项目长期记忆

## 产品形态
- 双版本：**云端共享版**（index.html，Vercel + Supabase，推荐）与**本地单机版**（water-tracker.html，localStorage，离线备用）
- 用户偏好单文件 HTML、双击即用、可分享

## 容量配置（产品约定，勿改）
- 小杯 150ml / 标准杯 250ml / 大杯 400ml / 瓶装 500ml，每日目标默认 2000ml（范围 500~10000）

## 云端版架构（v11.0）
- 前端：Vercel 静态托管，supabase-js 走 CDN UMD，零构建
- 数据库：Supabase PostgreSQL，两张表
  - `profiles`：username(PK) / password_hash(PBKDF2 格式 `pbkdf2$100000$salt$hex`) / goal / first_login / last_active
  - `water_records`：id(自增 PK) / username(FK 级联删) / date / time / amount
- 鉴权：纯前端用户名+密码，PBKDF2(10万迭代) 校验，RLS 全开（应用层隔离），适合亲友/团队内部
- 数据流：内存缓存同步渲染 UI + 操作异步精确写库；记录 id 用数据库自增主键
- 后台管理：聚合查询 + 重置密码（🔑）/删除用户（🗑）/全量备份恢复
- 部署步骤见 DEPLOY.md；备份格式向后兼容旧版，旧格式导入默认密码 water123

## 用户环境
- Windows，工作区 C:\soft\water-tracker
- 用户尚无 Supabase 项目，部署需按 DEPLOY.md 引导完成
