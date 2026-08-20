-- ============================================================
-- 喝了么 · Supabase 数据库初始化脚本（v11.6：用户 id 主键 + 角色）
-- 使用方法：Supabase Dashboard → SQL Editor → New query → 粘贴执行
-- 说明：脚本幂等，可对「旧版 username 主键」的存量库直接执行（自动迁移），
--       也可用于全新项目初始化。重复执行安全。
-- ============================================================

-- ============================================================
-- 1) 用户表 profiles
-- id          用户唯一标识（uuid 主键，子表一律用 user_id 关联）
-- username    用户名（唯一，登录标识，仅作展示）
-- role        角色：user=普通用户 / admin=管理员
-- password_hash 密码哈希（PBKDF2，格式：pbkdf2$100000$<salt>$<hex hash>）
-- goal        每日饮水目标（ml）
-- custom_cups 自定义快速记录按钮（JSON 文本，null=使用默认 4 个）
-- ============================================================
create table if not exists public.profiles (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,
  role          text not null default 'user' check (role in ('user','admin')),
  password_hash text not null,
  goal          integer not null default 2000 check (goal between 500 and 10000),
  custom_cups   text,
  first_login   timestamptz not null default now(),
  last_active   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- ============================================================
-- 2) 存量库迁移：profiles 升级（加 id / role，回填 id，主键切换）
--    全新库直接跳过（列/约束已存在）
-- ============================================================
do $$
begin
  -- 加 id / role 列（幂等）
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='profiles' and column_name='id') then
    alter table public.profiles add column id uuid default gen_random_uuid();
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='profiles' and column_name='role') then
    alter table public.profiles add column role text not null default 'user';
  end if;
  -- 回填存量行的 id
  update public.profiles set id = gen_random_uuid() where id is null;
  alter table public.profiles alter column id set not null;

  -- 给 id 建唯一约束（供子表 user_id 外键引用；若 id 已是主键则跳过）
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'profiles' and c.contype in ('p','u')
      and c.conkey = (select array_agg(a.attnum) from pg_attribute a
                      where a.attrelid = t.oid and a.attname = 'id')
  ) then
    alter table public.profiles add constraint profiles_id_key unique (id);
  end if;
end $$;

-- ============================================================
-- 3) 子表迁移模板：username → user_id（存量库数据回填 + 外键切换）
--    每个子表：drop 旧 username 外键 → 加 user_id → 回填 → 清孤儿 →
--              加新外键 → 删 username 列 → 重建唯一约束/索引
-- ============================================================

-- 3.1 water_records
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='water_records' and column_name='username') then
    alter table public.water_records drop constraint if exists water_records_username_fkey;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='water_records' and column_name='user_id') then
    alter table public.water_records add column user_id uuid;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='water_records' and column_name='username') then
    update public.water_records wr set user_id = p.id
    from public.profiles p where p.username = wr.username and wr.user_id is null;
    delete from public.water_records where user_id is null;
  end if;
  alter table public.water_records alter column user_id set not null;
  if not exists (select 1 from pg_constraint where conname='water_records_user_id_fkey') then
    alter table public.water_records add constraint water_records_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='water_records' and column_name='username') then
    alter table public.water_records drop column username;
  end if;
end $$;

-- 3.2 forum_posts
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='forum_posts' and column_name='author') then
    alter table public.forum_posts drop constraint if exists forum_posts_author_fkey;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='forum_posts' and column_name='user_id') then
    alter table public.forum_posts add column user_id uuid;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='forum_posts' and column_name='author') then
    update public.forum_posts fp set user_id = p.id
    from public.profiles p where p.username = fp.author and fp.user_id is null;
    delete from public.forum_posts where user_id is null;
  end if;
  alter table public.forum_posts alter column user_id set not null;
  if not exists (select 1 from pg_constraint where conname='forum_posts_user_id_fkey') then
    alter table public.forum_posts add constraint forum_posts_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='forum_posts' and column_name='author') then
    alter table public.forum_posts drop column author;
  end if;
end $$;

-- 3.3 forum_likes（unique(post_id, username) → unique(post_id, user_id)）
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='forum_likes' and column_name='username') then
    alter table public.forum_likes drop constraint if exists forum_likes_username_fkey;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='forum_likes' and column_name='user_id') then
    alter table public.forum_likes add column user_id uuid;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='forum_likes' and column_name='username') then
    update public.forum_likes fl set user_id = p.id
    from public.profiles p where p.username = fl.username and fl.user_id is null;
    delete from public.forum_likes where user_id is null;
  end if;
  alter table public.forum_likes alter column user_id set not null;
  if not exists (select 1 from pg_constraint where conname='forum_likes_user_id_fkey') then
    alter table public.forum_likes add constraint forum_likes_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='forum_likes' and column_name='username') then
    alter table public.forum_likes drop column username;
  end if;
  if not exists (select 1 from pg_constraint where conname='forum_likes_post_user_key') then
    alter table public.forum_likes add constraint forum_likes_post_user_key unique (post_id, user_id);
  end if;
end $$;

-- 3.4 forum_comments
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='forum_comments' and column_name='username') then
    alter table public.forum_comments drop constraint if exists forum_comments_username_fkey;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='forum_comments' and column_name='user_id') then
    alter table public.forum_comments add column user_id uuid;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='forum_comments' and column_name='username') then
    update public.forum_comments fc set user_id = p.id
    from public.profiles p where p.username = fc.username and fc.user_id is null;
    delete from public.forum_comments where user_id is null;
  end if;
  alter table public.forum_comments alter column user_id set not null;
  if not exists (select 1 from pg_constraint where conname='forum_comments_user_id_fkey') then
    alter table public.forum_comments add constraint forum_comments_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='forum_comments' and column_name='username') then
    alter table public.forum_comments drop column username;
  end if;
end $$;

-- 3.5 honor_boards
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='honor_boards' and column_name='username') then
    alter table public.honor_boards drop constraint if exists honor_boards_username_fkey;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='honor_boards' and column_name='user_id') then
    alter table public.honor_boards add column user_id uuid;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='honor_boards' and column_name='username') then
    update public.honor_boards hb set user_id = p.id
    from public.profiles p where p.username = hb.username and hb.user_id is null;
    delete from public.honor_boards where user_id is null;
  end if;
  alter table public.honor_boards alter column user_id set not null;
  if not exists (select 1 from pg_constraint where conname='honor_boards_user_id_fkey') then
    alter table public.honor_boards add constraint honor_boards_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='honor_boards' and column_name='username') then
    alter table public.honor_boards drop column username;
  end if;
  if not exists (select 1 from pg_constraint where conname='honor_boards_board_period_user_key') then
    alter table public.honor_boards add constraint honor_boards_board_period_user_key
      unique (board_type, period, user_id);
  end if;
end $$;

-- 3.6 honor_badges（主键 username+badge_type → user_id+badge_type）
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='honor_badges' and column_name='username') then
    alter table public.honor_badges drop constraint if exists honor_badges_pkey;
    alter table public.honor_badges drop constraint if exists honor_badges_username_fkey;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='honor_badges' and column_name='user_id') then
    alter table public.honor_badges add column user_id uuid;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='honor_badges' and column_name='username') then
    update public.honor_badges hb set user_id = p.id
    from public.profiles p where p.username = hb.username and hb.user_id is null;
    delete from public.honor_badges where user_id is null;
  end if;
  alter table public.honor_badges alter column user_id set not null;
  if not exists (select 1 from pg_constraint where conname='honor_badges_pkey') then
    alter table public.honor_badges add primary key (user_id, badge_type);
  end if;
  if not exists (select 1 from pg_constraint where conname='honor_badges_user_id_fkey') then
    alter table public.honor_badges add constraint honor_badges_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='honor_badges' and column_name='username') then
    alter table public.honor_badges drop column username;
  end if;
end $$;

-- 3.7 honor_achieve（unique(username, record_date) → unique(user_id, record_date)）
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='honor_achieve' and column_name='username') then
    alter table public.honor_achieve drop constraint if exists honor_achieve_username_fkey;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='honor_achieve' and column_name='user_id') then
    alter table public.honor_achieve add column user_id uuid;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='honor_achieve' and column_name='username') then
    update public.honor_achieve ha set user_id = p.id
    from public.profiles p where p.username = ha.username and ha.user_id is null;
    delete from public.honor_achieve where user_id is null;
  end if;
  alter table public.honor_achieve alter column user_id set not null;
  if not exists (select 1 from pg_constraint where conname='honor_achieve_user_id_fkey') then
    alter table public.honor_achieve add constraint honor_achieve_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='honor_achieve' and column_name='username') then
    alter table public.honor_achieve drop column username;
  end if;
  if not exists (select 1 from pg_constraint where conname='honor_achieve_user_date_key') then
    alter table public.honor_achieve add constraint honor_achieve_user_date_key
      unique (user_id, record_date);
  end if;
end $$;

-- ============================================================
-- 4) 主键切换：profiles 主键 username → id（必须在子表迁移全部完成后执行）
--    仅当当前主键不是 id 时执行；新库（id 已是主键）直接跳过
-- ============================================================
do $$
declare is_id_pk boolean;
begin
  select exists (
    select 1 from pg_index i
    join pg_class c on c.oid = i.indrelid
    where c.relname = 'profiles' and i.indisprimary
      and exists (select 1 from pg_attribute a
                  where a.attrelid = c.oid and a.attnum = any(i.indkey) and a.attname = 'id')
  ) into is_id_pk;
  if not is_id_pk then
    -- 此时子表旧外键已全部删除，可安全移除 username 主键
    alter table public.profiles drop constraint if exists profiles_pkey;
    alter table public.profiles add primary key (id);
    alter table public.profiles add constraint profiles_username_unique unique (username);
    -- 注意：不删除 profiles_id_key。子表 user_id 外键是在其存在时建立的，
    --       依赖该约束索引，删除会因 2BP01 失败（CASCADE 会连带删掉外键）。
    --       保留为冗余唯一约束，功能无影响。
  end if;
end $$;

-- ============================================================
-- 5) 索引（新结构）
-- ============================================================
drop index if exists idx_records_username_date;
create index if not exists idx_records_user_date on public.water_records (user_id, date);
create index if not exists idx_records_date on public.water_records (date);
create index if not exists idx_forum_posts_created on public.forum_posts (created_at desc);
create index if not exists idx_forum_likes_post on public.forum_likes (post_id);
create index if not exists idx_forum_comments_post on public.forum_comments (post_id);
create index if not exists idx_honor_boards_period on public.honor_boards (board_type, period);
create index if not exists idx_honor_achieve_date on public.honor_achieve (record_date);

-- ============================================================
-- 6) 行级安全（RLS）
--    说明：本项目纯前端架构（应用层校验用户名+密码），数据库对所有请求开放读写。
--    但 role / id 列禁止匿名修改（防提权、防篡改主键），仅数据库服务端可写。
-- ============================================================
alter table public.profiles       enable row level security;
alter table public.water_records  enable row level security;
alter table public.forum_posts    enable row level security;
alter table public.forum_likes    enable row level security;
alter table public.forum_comments enable row level security;
alter table public.honor_boards   enable row level security;
alter table public.honor_badges   enable row level security;
alter table public.honor_achieve  enable row level security;

-- 防提权：匿名/普通用户禁止写入 id 与 role 列（PostgREST 会遵守列级权限）
revoke insert (id, role) on public.profiles from anon, authenticated;
revoke update (id, role) on public.profiles from anon, authenticated;

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

-- 荣誉墙三表：匿名只读（写入仅由定时任务 postgres 角色完成）
drop policy if exists "honor_boards_select" on public.honor_boards;
create policy "honor_boards_select" on public.honor_boards for select using (true);

drop policy if exists "honor_badges_select" on public.honor_badges;
create policy "honor_badges_select" on public.honor_badges for select using (true);

drop policy if exists "honor_achieve_select" on public.honor_achieve;
create policy "honor_achieve_select" on public.honor_achieve for select using (true);

-- ============================================================
-- 7) 荣誉墙 · 榜单/勋章生成函数（幂等，可重复执行）
--    关联一律使用 user_id（不再使用 username）
-- ============================================================
-- 通用：按时间段取 TOP3 写入 honor_boards，仅当榜单行【新增】成功时下发勋章 +1
create or replace function public.generate_honor_board(p_type text, p_start date, p_end date, p_period text)
returns void
language plpgsql
as $$
declare
  r record;
  inserted_name text;
begin
  for r in
    select t.user_id, t.total,
           row_number() over (order by t.total desc) as rn
    from (
      select user_id, sum(amount) as total
      from public.water_records
      where date >= p_start and date <= p_end
      group by user_id
    ) t
    order by t.total desc
    limit 3
  loop
    inserted_name := null;
    insert into public.honor_boards (board_type, period, rank, user_id, amount)
    values (p_type, p_period, r.rn::smallint, r.user_id, r.total)
    on conflict (board_type, period, user_id) do nothing
    returning user_id into inserted_name;

    if inserted_name is not null then
      insert into public.honor_badges (user_id, badge_type, count)
      values (inserted_name, p_type, 1)
      on conflict (user_id, badge_type)
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
  today      date := (now() at time zone 'Asia/Shanghai')::date;
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
  today   date := (now() at time zone 'Asia/Shanghai')::date;
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
    select wr.user_id, sum(wr.amount) as total, max(p.goal) as goal
    from public.water_records wr
    join public.profiles p on p.id = wr.user_id
    where wr.date = p_date
    group by wr.user_id
  loop
    if r.total >= r.goal then
      inserted_name := null;
      insert into public.honor_achieve (user_id, record_date, total, goal)
      values (r.user_id, p_date, r.total, r.goal)
      on conflict (user_id, record_date) do nothing
      returning user_id into inserted_name;

      if inserted_name is not null then
        insert into public.honor_badges (user_id, badge_type, count)
        values (inserted_name, 'achieve', 1)
        on conflict (user_id, badge_type)
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

-- ============================================================
-- 9) 管理员设置
--    执行完本脚本后，将某用户设为管理员（在 SQL Editor 手动执行）：
--      update public.profiles set role = 'admin' where username = '你的用户名';
--    普通用户（role='user'）登录后看不到「后台管理」入口。
-- ============================================================
