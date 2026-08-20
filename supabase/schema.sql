-- ============================================================
-- 喝了么 · Supabase 数据库初始化脚本
-- 使用方法：Supabase Dashboard → SQL Editor → New query → 粘贴执行
-- ============================================================

-- 1) 用户表 profiles
-- username      用户名（唯一，登录标识）
-- password_hash 密码哈希（PBKDF2，格式：pbkdf2$100000$<salt>$<hex hash>）
-- goal          每日饮水目标（ml）
-- custom_cups   自定义快速记录按钮（JSON 字符串，null=使用默认 4 个）
-- first_login   首次登录时间
-- last_active   最后活跃时间
create table if not exists public.profiles (
  username      text primary key,
  password_hash text not null,
  goal          integer not null default 2000 check (goal between 500 and 10000),
  custom_cups   text,
  first_login   timestamptz not null default now(),
  last_active   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- 如果表已存在，添加 custom_cups 列（安全迁移，重复执行不报错）
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'custom_cups'
  ) then
    alter table public.profiles add column custom_cups text;
  end if;
end $$;

-- 2) 喝水记录表 water_records
-- date   日期（YYYY-MM-DD）
-- time   时刻（HH:MM）
-- amount 毫升数
create table if not exists public.water_records (
  id         bigint generated always as identity primary key,
  username   text not null references public.profiles(username) on delete cascade,
  date       date not null,
  time       text not null default '12:00',
  amount     integer not null check (amount > 0 and amount <= 5000),
  created_at timestamptz not null default now()
);

-- 3) 常用查询索引
create index if not exists idx_records_username_date on public.water_records (username, date);
create index if not exists idx_records_date on public.water_records (date);

-- 4) 行级安全（RLS）
-- 说明：本项目是纯前端架构（Vercel 静态托管），应用层负责「用户名 + 密码」校验，
--       因此数据库对所有请求开放读写（RLS 策略 using(true)）。
--       该设计适用于喝水记录这类低敏感数据；如需更高安全性，请改用 Supabase Auth。
alter table public.profiles      enable row level security;
alter table public.water_records enable row level security;

drop policy if exists "profiles_public_all" on public.profiles;
create policy "profiles_public_all"
  on public.profiles
  for all
  using (true)
  with check (true);

drop policy if exists "records_public_all" on public.water_records;
create policy "records_public_all"
  on public.water_records
  for all
  using (true)
  with check (true);
