# Boli 账本 — 项目说明（给 Claude 看的记忆文件）

> 每次在这个仓库开新对话，Claude 会先读这个文件。改了架构、加了功能、换了设置，都要更新这里。
> 本仓库是**公开**的：这里不要写邮箱、密码、service_role key 或任何私人信息。

## 用户和业务
- 老板做中国 ↔ 哈萨克斯坦生意，经手 **美元 USD / 坚戈 KZT / 人民币 CNY**，也给客户换汇。
- **回复一律用中文**，一步一步讲，用户不写代码；主要在 **iPad + Safari** 上操作，遇到问题会发截图。
- 客户在哈萨克斯坦，客户网站要有 **中文 + 俄语**。

## 用户提出过的要求（按时间）
1. 进账 / 出账会计系统：每笔记录当时汇率，三种货币，按客户统计，自动算利润，好看好用。
2. 更美观；发给客户能看到汇率，但汇率由老板自己调；后台数据只有老板能看（隐私）。
3. 做成网站（GitHub Pages）。
4. 做成真正的软件：后台要**密码登录**；客户能**在线预约换汇**（写多少钱、怎么换）；以后**方便更新**；每次修改**自动保存**；全程自动化。
5. 问过能否用 iPad 当数据库 → 解释了不行（订单需要 24 小时在线的服务器），保留 Supabase。
6. 只要**一个网址**：客户页右上角显示「内部管理登录」，点进去填账号密码进后台，客户进不去。
7. 页面重新设计：**不要绿色**，好看、新奇、好玩。
8. 嫌上一版 low：要**高级感**、客户一看就被吸引，可以有**可爱的小动态表情**；人民币和坚戈要**双向换汇**（两个方向分别填汇率），不是只有一个汇率。

## 架构
| 文件 | 作用 |
|---|---|
| `index.html` | **唯一的网址**。访客看到客户页（已发布汇率、在线预约、查订单，中 / 俄）；右上角「内部管理登录」→ 邮箱+密码 → 同一页面变成后台（概览 / 订单 / 流水 / 客户 / 汇率）。已登录的设备打开直接进后台 |
| `admin.html` | 只是跳转到 `./`（旧链接兼容） |
| `app.js` | 全部程序（按 `/* ---------- 章节 ---------- */` 分段）；`S.role` = `client` / `owner` |
| `app.css` | 「午夜香槟」高级感设计：客户页（`.pub`）永远是深夜蓝 + 极光渐变 + 毛玻璃卡片 + 香槟金文字 + 中文衬线标题；两只会眨眼、打招呼、点一下会跳的**硬币宝宝**（¥ 和 ₸，`coin()` 函数画的 SVG）。后台是同色系的浅色（也有深色模式）。**用户不要绿色**：进账钴蓝、出账珊瑚红。字体：Playfair Display + Noto Serif SC（标题）、Manrope（正文/数字） |
| `config.js` | 唯一配置：Supabase URL + anon key + 公司名 |
| `supabase/setup.sql` | 建表、RLS 权限、`place_order` / `order_status` / `claim_admin` 函数、实时同步；**可重复运行** |
| `SETUP.md` | 给用户的上线步骤 |
| `claude-artifact.html` | 早期的 Claude Artifact 版本（https://claude.ai/artifact/MWUafEqnSyYRhbXYwzPf87），已不是主版本 |

- 前端：纯 HTML/CSS/JS，无构建步骤；supabase-js 2.45.4 从 jsdelivr 加载。
- 后端：**Supabase**（Postgres + Auth + Realtime）。
  - 项目 ref：`ehltorpszvtuupqwzocg`，区域 Tokyo (ap-northeast-1)，免费版。
  - `txns` / `clients`：`{id text, doc jsonb, updated_at}`，记录内容放在 `doc` 里，加字段不用改表。
  - `settings`：`key='public'`（客户汇率，anon 可读）、`key='internal'`（内部汇率，仅管理员）。
  - `orders`：客户订单；anon 只能通过 `place_order` RPC 下单（汇率在服务器端按已发布汇率计算），用 `order_status(code)` 查单。
  - `admins`：管理员邮箱；**第一个登录后台的账号自动成为管理员**（`claim_admin`）。
- 对客户汇率是**双向**的：每个币种对 `{b,q,buy,sell,r,on}`，都写成 1 b = ? q。`buy` = 客户用 b 换 q，`sell` = 客户用 q 换 b；`r` = 中间价（兼容旧数据）。服务器端 `_pair_rate` 按方向取价。主打 CNY⇄KZT 排第一。
- 每笔账的汇率存为「每 1 美元的单位数」：`rates: {CNY, KZT}`。换汇（fx）的利润 = 收进 − 付出（按本笔汇率折算）。
- 订单「完成并记账」= 生成一笔 fx：`currency`=客户要的币种（我们付出），`toCurrency`=客户付的币种（我们收进）。

## 网址
- 网站（客户和后台同一个网址）：https://li6125791-sudo.github.io/boli/ ，后台从右上角「内部管理登录」进入
- Supabase 控制台：https://supabase.com/dashboard/project/ehltorpszvtuupqwzocg

## 当前状态（2026-11-26）
- GitHub Pages 从 `main` 分支 `/ (root)` 发布；PR #1 已合并。改动走新分支 + PR，用户在 GitHub 点 Merge。
- 已完成：Supabase 项目创建、`setup.sql` 运行成功、后台账号已创建、`config.js` 已填 URL 和 anon key。
- 双向汇率需要用户把新版 `supabase/setup.sql` 在 SQL Editor **再运行一次**（不运行时服务器按中间价 r 计算，仍能用）。
- 待用户确认：已关闭 Supabase「Allow new users to sign up」；第一次登录后台、发布汇率。
- 尚未在真实 Supabase 上端到端测试过（云端开发环境连不上 supabase.co）。

## 修改时的约定
- 改完用 Playwright + 假的 supabase 客户端（拦截 jsdelivr 的 supabase-js 和 `config.js`）走一遍：登录 → 发布汇率 → 客户下单 → 后台确认 → 完成并记账。
- 改数据库：只追加到 `supabase/setup.sql`，保持可重复运行（`if not exists` / `create or replace` / `drop policy if exists`），并提醒用户在 SQL Editor 再运行一次。可用本机 PostgreSQL 16 先测（需要建 `anon` / `authenticated` 角色和 `auth.jwt()` 桩）。
- 界面文字：后台中文；客户页中 / 俄两套（`L.zh` / `L.ru`）。
- 提交信息末尾不写模型名。
