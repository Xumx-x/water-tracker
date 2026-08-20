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

-- ============================================================
-- 5) 喝友论坛表
-- forum_posts     帖子（author=发帖人，title+content）
-- forum_likes     点赞（每用户每帖最多一次，unique 约束）
-- forum_comments  评论
-- ============================================================
create table if not exists public.forum_posts (
  id         bigint generated always as identity primary key,
  author     text not null references public.profiles(username) on delete cascade,
  title      text not null check (char_length(title) <= 60),
  content    text not null check (char_length(content) <= 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.forum_likes (
  id         bigint generated always as identity primary key,
  post_id    bigint not null references public.forum_posts(id) on delete cascade,
  username   text not null references public.profiles(username) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, username)
);

create table if not exists public.forum_comments (
  id         bigint generated always as identity primary key,
  post_id    bigint not null references public.forum_posts(id) on delete cascade,
  username   text not null references public.profiles(username) on delete cascade,
  content    text not null check (char_length(content) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists idx_forum_posts_created   on public.forum_posts (created_at desc);
create index if not exists idx_forum_likes_post      on public.forum_likes (post_id);
create index if not exists idx_forum_comments_post   on public.forum_comments (post_id);

alter table public.forum_posts    enable row level security;
alter table public.forum_likes    enable row level security;
alter table public.forum_comments enable row level security;

drop policy if exists "forum_posts_public_all" on public.forum_posts;
create policy "forum_posts_public_all"
  on public.forum_posts
  for all
  using (true)
  with check (true);

drop policy if exists "forum_likes_public_all" on public.forum_likes;
create policy "forum_likes_public_all"
  on public.forum_likes
  for all
  using (true)
  with check (true);

drop policy if exists "forum_comments_public_all" on public.forum_comments;
create policy "forum_comments_public_all"
  on public.forum_comments
  for all
  using (true)
  with check (true);

-- ============================================================
-- 6) 荣誉墙（🏆）
-- honor_boards   榜单快照：日/周/月 TOP3，生成后冻结（补录不改）
-- honor_badges   勋章计数：daily(日榜)/weekly(周榜)/monthly(月榜)/achieve(达标)
-- honor_achieve  达标记录：每人每天一条（防重复计分）
--
-- 定时任务（pg_cron，按北京时间排程，见下方第 7 节）：
--   每日 01:00  生成昨日日榜 TOP3，上榜者日榜勋章 +1
--   每周一 01:00 生成上周周榜 TOP3，上榜者周榜勋章 +1
--   每月 1 号 01:00 生成上月月榜 TOP3，上榜者月榜勋章 +1
--   每日 01:30  统计昨日达标（饮水量 ≥ 每日目标），达标者达标勋章 +1
--
-- 冻结规则：榜单/勋章只在定时任务生成时一次性写入（快照）。
--   之后用户补录旧日期数据不会改写 honor_boards / honor_badges，
--   历史结果永久冻结。
-- ============================================================
create table if not exists public.honor_boards (
  id         bigint generated always as identity primary key,
  board_type text not null check (board_type in ('daily','weekly','monthly')),
  period     text not null,   -- daily: 'YYYY-MM-DD' / weekly: 上周一日期 / monthly: 'YYYY-MM'
  rank       smallint not null check (rank between 1 and 3),
  username   text not null references public.profiles(username) on delete cascade,
  amount     integer not null,
  created_at timestamptz not null default now(),
  unique (board_type, period, username)
);

create table if not exists public.honor_badges (
  username   text not null references public.profiles(username) on delete cascade,
  badge_type text not null check (badge_type in ('daily','weekly','monthly','achieve')),
  count      integer not null default 0 check (count >= 0),
  updated_at timestamptz not null default now(),
  primary key (username, badge_type)
);

create table if not exists public.honor_achieve (
  id          bigint generated always as identity primary key,
  username    text not null references public.profiles(username) on delete cascade,
  record_date date not null,
  total       integer not null,
  goal        integer not null,
  created_at  timestamptz not null default now(),
  unique (username, record_date)
);

create index if not exists idx_honor_boards_period on public.honor_boards (board_type, period);
create index if not exists idx_honor_achieve_date  on public.honor_achieve (record_date);

-- RLS：匿名只能读（荣誉墙展示）；写入仅由定时任务（postgres 角色）完成
alter table public.honor_boards  enable row level security;
alter table public.honor_badges  enable row level security;
alter table public.honor_achieve enable row level security;

drop policy if exists "honor_boards_select" on public.honor_boards;
create policy "honor_boards_select" on public.honor_boards for select using (true);

drop policy if exists "honor_badges_select" on public.honor_badges;
create policy "honor_badges_select" on public.honor_badges for select using (true);

drop policy if exists "honor_achieve_select" on public.honor_achieve;
create policy "honor_achieve_select" on public.honor_achieve for select using (true);

-- ============================================================
-- 7) 荣誉墙 · 榜单/勋章生成函数（幂等，可重复执行）
-- ============================================================
-- 通用：按时间段取 TOP3 写入 honor_boards，仅当榜单行【新增】成功时下发勋章 +1
--   （ON CONFLICT DO NOTHING：同一周期同一用户已上榜则跳过 → 冻结 + 防重复计分）
create or replace function public.generate_honor_board(p_type text, p_start date, p_end date, p_period text)
returns void
language plpgsql
as $$
declare
  r record;
  inserted_name text;
begin
  for r in
    select t.username, t.total,
           row_number() over (order by t.total desc) as rn
    from (
      select username, sum(amount) as total
      from public.water_records
      where date >= p_start and date <= p_end
      group by username
    ) t
    order by t.total desc
    limit 3
  loop
    inserted_name := null;
    insert into public.honor_boards (board_type, period, rank, username, amount)
    values (p_type, p_period, r.rn::smallint, r.username, r.total)
    on conflict (board_type, period, username) do nothing
    returning username into inserted_name;

    if inserted_name is not null then
      insert into public.honor_badges (username, badge_type, count)
      values (inserted_name, p_type, 1)
      on conflict (username, badge_type)
      do update set count = honor_badges.count + 1, updated_at = now();
    end if;
  end loop;
end;
$$;

-- 日榜：昨日（北京时间）
create or replace function public.generate_honor_board_daily() returns void
language plpgsql
as $$
declare
  p_date date := (now() at time zone 'Asia/Shanghai')::date - 1;
begin
  perform public.generate_honor_board('daily', p_date, p_date, to_char(p_date, 'YYYY-MM-DD'));
end;
$$;

-- 周榜：上周（周一 ~ 周日，北京时间；仅应在周一 01:00 调用）
create or replace function public.generate_honor_board_weekly() returns void
language plpgsql
as $$
declare
  today     date := (now() at time zone 'Asia/Shanghai')::date;
  week_start date := today - 7;  -- 上周一
  week_end   date := today - 1;  -- 上周日
begin
  perform public.generate_honor_board('weekly', week_start, week_end, to_char(week_start, 'YYYY-MM-DD'));
end;
$$;

-- 月榜：上月（仅应在每月 1 号 01:00 调用）
create or replace function public.generate_honor_board_monthly() returns void
language plpgsql
as $$
declare
  today  date := (now() at time zone 'Asia/Shanghai')::date;
  m_start date := (date_trunc('month', today) - interval '1 month')::date;  -- 上月 1 号
  m_end   date := (date_trunc('month', today) - interval '1 day')::date;    -- 上月最后一天
begin
  perform public.generate_honor_board('monthly', m_start, m_end, to_char(m_start, 'YYYY-MM'));
end;
$$;

-- 达标勋章：昨日饮水量 ≥ 每日目标（北京时间；目标取 profiles.goal 快照）
create or replace function public.generate_honor_achieve() returns void
language plpgsql
as $$
declare
  p_date date := (now() at time zone 'Asia/Shanghai')::date - 1;
  r record;
  inserted_name text;
begin
  for r in
    select wr.username, sum(wr.amount) as total, max(p.goal) as goal
    from public.water_records wr
    join public.profiles p on p.username = wr.username
    where wr.date = p_date
    group by wr.username
  loop
    if r.total >= r.goal then
      inserted_name := null;
      insert into public.honor_achieve (username, record_date, total, goal)
      values (r.username, p_date, r.total, r.goal)
      on conflict (username, record_date) do nothing
      returning username into inserted_name;

      if inserted_name is not null then
        insert into public.honor_badges (username, badge_type, count)
        values (inserted_name, 'achieve', 1)
        on conflict (username, badge_type)
        do update set count = honor_badges.count + 1, updated_at = now();
      end if;
    end if;
  end loop;
end;
$$;

-- 安全：函数仅供定时任务调用，撤销匿名/普通角色的执行权限，避免通过 REST RPC 提前触发
revoke all on function public.generate_honor_board(text, date, date, text) from public;
revoke all on function public.generate_honor_board_daily()   from public;
revoke all on function public.generate_honor_board_weekly()  from public;
revoke all on function public.generate_honor_board_monthly() from public;
revoke all on function public.generate_honor_achieve()       from public;

-- ============================================================
-- 8) 荣誉墙 · pg_cron 定时任务
--    说明：pg_cron 按数据库时区（Supabase 默认 UTC）排程，已换算为北京时间：
--      01:00 北京 = 前一自然日 17:00 UTC → 0 17 * * *
--      01:30 北京 = 前一自然日 17:30 UTC → 30 17 * * *
--    函数内部日期一律用 now() at time zone 'Asia/Shanghai' 计算，与排程无关。
-- ============================================================
create extension if not exists pg_cron;

-- 注意：do 块必须用带标签的 $do$ ... $do$（内部 cron 命令用 $$），
--       同标签美元引用（$$ 嵌套 $$）不允许嵌套，会报 syntax error at or near "select"
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'water-honor-daily-board') then
    perform cron.unschedule('water-honor-daily-board');
  end if;
  perform cron.schedule('water-honor-daily-board', '0 17 * * *',
    $$select public.generate_honor_board_daily();$$);
end $do$;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'water-honor-weekly-board') then
    perform cron.unschedule('water-honor-weekly-board');
  end if;
  perform cron.schedule('water-honor-weekly-board', '0 17 * * 1',
    $$select public.generate_honor_board_weekly();$$);
end $do$;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'water-honor-monthly-board') then
    perform cron.unschedule('water-honor-monthly-board');
  end if;
  perform cron.schedule('water-honor-monthly-board', '0 17 1 * *',
    $$select public.generate_honor_board_monthly();$$);
end $do$;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'water-honor-achieve') then
    perform cron.unschedule('water-honor-achieve');
  end if;
  perform cron.schedule('water-honor-achieve', '30 17 * * *',
    $$select public.generate_honor_achieve();$$);
end $do$;
