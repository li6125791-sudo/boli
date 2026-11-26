-- =====================================================================
-- Boli 账本 · 数据库设置
-- 用法：Supabase 控制台 → SQL Editor → New query → 粘贴整个文件 → Run。
-- 可以重复运行（以后更新版本时再运行一次即可），不会删除已有数据。
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- 表 ----------
create table if not exists public.admins (
  email text primary key
);

create table if not exists public.txns (
  id         text primary key default gen_random_uuid()::text,
  doc        jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id         text primary key default gen_random_uuid()::text,
  doc        jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- key = 'public'   客户能看到的汇率、公司名、联系方式
-- key = 'internal' 只有管理员能看到的内部记账汇率
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id         text primary key default gen_random_uuid()::text,
  code       text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name       text not null,
  phone      text not null,
  from_cur   text not null,
  to_cur     text not null,
  amount     numeric not null,
  rate       numeric not null,
  to_amount  numeric not null,
  method     text,
  want_date  text,
  note       text,
  lang       text,
  status     text not null default 'new',
  admin_note text,
  txn_id     text
);
create index if not exists orders_created_idx on public.orders (created_at desc);

do $$ begin
  alter table public.orders add constraint orders_status_chk check (status in ('new','confirmed','done','cancelled'));
exception when duplicate_object then null; end $$;

-- ---------- 权限：只有管理员能读写账本 ----------
alter table public.admins   enable row level security;
alter table public.txns     enable row level security;
alter table public.clients  enable row level security;
alter table public.settings enable row level security;
alter table public.orders   enable row level security;

-- 让网站能通过 API 访问这些表（真正能看到什么由下面的 RLS 规则决定）
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.txns, public.clients, public.settings, public.orders to authenticated;
grant select on public.settings to anon;
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- 第一个登录后台的账号自动成为管理员（之后其他账号都不能再成为管理员）
create or replace function public.claim_admin() returns boolean
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if v_email = '' then return false; end if;
  if not exists (select 1 from public.admins) then
    insert into public.admins (email) values (v_email) on conflict do nothing;
  end if;
  return public.is_admin();
end $$;

drop policy if exists admin_all on public.txns;
create policy admin_all on public.txns for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists admin_all on public.clients;
create policy admin_all on public.clients for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists admin_all on public.orders;
create policy admin_all on public.orders for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists settings_read   on public.settings;
drop policy if exists settings_insert on public.settings;
drop policy if exists settings_update on public.settings;
drop policy if exists settings_delete on public.settings;
create policy settings_read on public.settings for select to anon, authenticated
  using (key = 'public' or public.is_admin());
create policy settings_insert on public.settings for insert to authenticated
  with check (public.is_admin());
create policy settings_update on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy settings_delete on public.settings for delete to authenticated
  using (public.is_admin());

-- ---------- 汇率计算（服务器端，客户无法篡改） ----------
-- 每个币种对 b/q 有两个方向的报价（都写成 1 b = ? q）：
--   buy  = 客户用 b 换 q（我们买入 b）
--   sell = 客户用 q 换 b（我们卖出 b）
-- 旧数据只有 r 时，两个方向都用 r。
create or replace function public._pair_rate(pairs jsonb, f text, t text) returns numeric
language plpgsql immutable set search_path = public as $$
declare r numeric;
begin
  select coalesce(nullif(e ->> 'buy', '')::numeric, nullif(e ->> 'r', '')::numeric) into r
    from jsonb_array_elements(pairs) e
   where e ->> 'b' = f and e ->> 'q' = t
     and coalesce((e ->> 'on')::boolean, true)
   limit 1;
  if r is not null and r > 0 then return r; end if;
  select coalesce(nullif(e ->> 'sell', '')::numeric, nullif(e ->> 'r', '')::numeric) into r
    from jsonb_array_elements(pairs) e
   where e ->> 'b' = t and e ->> 'q' = f
     and coalesce((e ->> 'on')::boolean, true)
   limit 1;
  if r is not null and r > 0 then return 1 / r; end if;
  return null;
end $$;

create or replace function public.quote_rate(f text, t text) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare pairs jsonb; r numeric; a numeric; b numeric; m text;
begin
  select value -> 'pairs' into pairs from public.settings
   where key = 'public' and coalesce((value ->> 'published')::boolean, false);
  if pairs is null then return null; end if;
  r := public._pair_rate(pairs, f, t);
  if r is not null then return r; end if;
  foreach m in array array['USD','KZT','CNY'] loop
    if m <> f and m <> t then
      a := public._pair_rate(pairs, f, m);
      b := public._pair_rate(pairs, m, t);
      if a is not null and b is not null then return a * b; end if;
    end if;
  end loop;
  return null;
end $$;

-- ---------- 客户下单（不用登录） ----------
create or replace function public.place_order(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_from text := upper(coalesce(p ->> 'from', ''));
  v_to   text := upper(coalesce(p ->> 'to', ''));
  v_amt  numeric;
  v_name text := left(trim(coalesce(p ->> 'name', '')), 100);
  v_phone text := left(trim(coalesce(p ->> 'phone', '')), 60);
  v_rate numeric;
  v_out  numeric;
  v_code text;
begin
  begin v_amt := (p ->> 'amount')::numeric; exception when others then v_amt := null; end;
  if v_from not in ('USD','KZT','CNY') or v_to not in ('USD','KZT','CNY') or v_from = v_to then
    raise exception 'bad_currency';
  end if;
  if v_amt is null or v_amt <= 0 or v_amt > 1e12 then raise exception 'bad_amount'; end if;
  if v_name = '' or v_phone = '' then raise exception 'missing_contact'; end if;
  if (select count(*) from public.orders where created_at > now() - interval '1 minute') >= 30 then
    raise exception 'busy';
  end if;
  v_rate := public.quote_rate(v_from, v_to);
  if v_rate is null then raise exception 'no_rate'; end if;
  v_rate := round(v_rate, 8);
  v_out := round(v_amt * v_rate, 2);
  loop
    v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
    exit when not exists (select 1 from public.orders where code = v_code);
  end loop;
  insert into public.orders (code, name, phone, from_cur, to_cur, amount, rate, to_amount, method, want_date, note, lang)
  values (v_code, v_name, v_phone, v_from, v_to, v_amt, v_rate, v_out,
          left(p ->> 'method', 40), left(p ->> 'date', 20), left(p ->> 'note', 500), left(p ->> 'lang', 5));
  return jsonb_build_object('code', v_code, 'rate', v_rate, 'to_amount', v_out);
end $$;

-- 客户用订单号查进度（只返回这一单的基本信息）
create or replace function public.order_status(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', code, 'status', status, 'created_at', created_at,
           'from_cur', from_cur, 'to_cur', to_cur, 'amount', amount, 'rate', rate,
           'to_amount', to_amount, 'admin_note', admin_note)
    from public.orders where code = upper(trim(p_code)) limit 1;
$$;

revoke all on function public._pair_rate(jsonb, text, text) from public;
revoke all on function public.quote_rate(text, text) from public;
revoke all on function public.place_order(jsonb) from public;
revoke all on function public.order_status(text) from public;
revoke all on function public.claim_admin() from public;
revoke all on function public._pair_rate(jsonb, text, text) from anon, authenticated;
revoke all on function public.quote_rate(text, text) from anon, authenticated;
revoke all on function public.claim_admin() from anon;
grant execute on function public.place_order(jsonb) to anon, authenticated;
grant execute on function public.order_status(text) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.claim_admin() to authenticated;

-- ---------- 实时同步（新订单马上出现在后台） ----------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['orders','txns','clients','settings'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- 完成。下一步：Authentication → Users → Add user，创建你的后台账号（邮箱 + 密码）。
