# Boli 网站上线步骤（约 15 分钟，只需做一次）

网站由两部分组成：
- **GitHub Pages**：放网页（免费）
- **Supabase**：放数据、管理后台登录（免费额度足够一个小公司用）

---

## 第 1 步：创建 Supabase 数据库

1. 打开 https://supabase.com ，用 GitHub 账号登录。
2. 点 **New project**：
   - Name：`boli`
   - Database Password：随便设一个强密码（自己保存好，平时用不到）
   - Region：选 **Central EU (Frankfurt)** 或离你最近的
3. 等 1–2 分钟项目创建好。
4. 左侧菜单 **SQL Editor** → **New query** → 把仓库里 `supabase/setup.sql` 的全部内容粘贴进去 → 点 **Run**。看到 `Success` 就好。

## 第 2 步：创建你的后台账号（密码登录）

1. 左侧 **Authentication** → **Users** → **Add user** → **Create new user**。
2. 填你的邮箱和后台密码，勾选 **Auto Confirm User**，点创建。
3. **重要**：左侧 **Authentication** → **Sign In / Providers**（或 Settings）→ 关闭 **Allow new users to sign up**。这样别人无法自己注册。
4. 第一个登录后台的账号会自动成为管理员，之后其他账号即使存在也进不了后台。

## 第 3 步：把数据库连到网站

1. Supabase 左侧 **Project Settings** → **API**（或 **Data API**）。
2. 复制 **Project URL** 和 **anon public** key。
3. 打开仓库里的 `config.js`，填进去：
   ```js
   supabaseUrl: "https://xxxx.supabase.co",
   supabaseAnonKey: "eyJhbGciOi...",
   ```
   （anon key 本来就是公开用的，放在网站里是安全的；数据由数据库权限规则保护。）
4. 提交并推送（GitHub Desktop：Commit → Push）。

## 第 4 步：开启 GitHub Pages

1. GitHub 仓库 → **Settings** → **Pages**。
2. Source 选 **Deploy from a branch**，分支选放这些文件的分支，文件夹 `/ (root)`，保存。
3. 约 1 分钟后得到网址：
   - 客户网站：`https://你的用户名.github.io/boli/`
   - 你的后台：`https://你的用户名.github.io/boli/admin.html`

> 免费 GitHub 只能给**公开仓库**开 Pages。仓库公开没关系：里面只有程序，没有任何账本数据。

## 第 5 步：开始使用

1. 打开后台 `admin.html`，用第 2 步的邮箱和密码登录。
2. 「汇率」→ 填客户汇率 → **发布给客户**。客户网站立即显示，客户可以开始下单。
3. 客户下单后，后台「订单」会实时出现（标签上有红色数字）。确认 → 完成并记账，自动生成一笔换汇账目并计算利润。
4. 手机上打开后台，浏览器菜单选「添加到主屏幕」，就像 App 一样使用。

---

## 以后怎么更新

- **改汇率、公司名、联系方式**：后台「汇率」页面，点发布即可，不用改代码。
- **改程序**：修改 `app.js` / `app.css` 后推送到 GitHub，网站 1 分钟内更新。
- **数据库结构有更新时**：把新版 `supabase/setup.sql` 在 SQL Editor 再运行一次（不会删数据）。

## 数据安全

- 每次记账、修改、订单处理都会**立即自动保存到云端**，后台顶部显示「已自动保存 时:分」。
- 网络断开时会提示「未保存」，15 秒后自动重试同步。
- 建议每月在「流水」点一次 **备份 JSON** 存到电脑。Supabase 免费版项目 7 天无人访问会暂停，打开控制台点 Restore 即可恢复（数据不会丢）。
