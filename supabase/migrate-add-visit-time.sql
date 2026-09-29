-- ============================================================
--  增量升级脚本：为已有数据库补上「到访时间」和「访问人」两列
--
--  什么时候需要执行？
--    如果你的数据库是**在增加这两个字段之前**建的（执行过旧版 schema.sql），
--    就必须执行本脚本。否则访客端不会报错（有自动降级保护），
--    但这两个字段存不进数据库，管理页会显示为空。
--
--  执行方式：
--    Supabase 控制台 → SQL Editor → New query → 粘贴全部 → Run
--    看到 "Success. No rows returned" 即成功。
--
--  本脚本可以安全地重复执行：
--    第一行有 if not exists 判断，重复执行不会报错、不会丢数据。
-- ============================================================

-- 1. 到访时间：访客填写，可修改
alter table public.visitors
  add column if not exists visit_time timestamptz;

-- 2. 访问人：被访者 / 接待方
alter table public.visitors
  add column if not exists receptionist text;

-- 3. 约束：限制长度，避免超长内容
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'visitors_receptionist_len'
  ) then
    alter table public.visitors
      add constraint visitors_receptionist_len
      check (receptionist is null or char_length(receptionist) <= 30);
  end if;
end $$;

-- 4. 索引：管理端按到访时间排序
create index if not exists visitors_visit_time_idx
  on public.visitors (visit_time desc);

-- 5. 老数据回填：
--    之前没有到访时间，用系统记录的到达时间填充，
--    保证列表和导出不出现空白。
update public.visitors
   set visit_time = arrived_at
 where visit_time is null;

-- 6. 更新注释
comment on column public.visitors.visit_time   is '到访时间：访客填写，可修改';
comment on column public.visitors.receptionist is '访问人：被访者 / 接待方';

-- ============================================================
--  执行完成后可以这样验证（应返回两列，且无报错）：
--    select visit_time, receptionist from public.visitors limit 1;
-- ============================================================
