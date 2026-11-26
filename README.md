# Boli 账本

美元 (USD) / 坚戈 (KZT) / 人民币 (CNY) 进出账系统 + 给客户看的汇率网站。

## 网站结构（GitHub Pages）

| 文件 | 作用 |
|---|---|
| `index.html` | **客户看的汇率页**（网站首页）：只显示你发布的汇率、联系方式、换算器，中文 / 俄语 |
| `admin.html` | **你的后台账本**：进账、出账、换汇、客户、利润、内部汇率、发布客户汇率 |
| `rates.json` | 客户汇率数据，后台点「发布给客户」时自动更新 |
| `app.js` / `app.css` | 程序和样式 |
| `claude-artifact.html` | Claude 版本（在 claude.ai 上运行的同款页面） |

## 隐私

- 账本数据只保存在你打开 `admin.html` 的那台设备的浏览器里，不会上传。别人打开 `admin.html` 只会看到一个空账本。
- 客户在首页只能看到 `rates.json` 里的内容。
- 换设备或清理浏览器前，在「流水」点「备份 JSON」，到新设备点「恢复备份」。

## 开启网站

1. 仓库 → **Settings → Pages** → Source 选 **Deploy from a branch**，分支选放这些文件的分支，文件夹 `/ (root)`，保存。
2. 约 1 分钟后网址出现在同一页面，例如 `https://<用户名>.github.io/boli/`。
   - 客户网址：`https://<用户名>.github.io/boli/`
   - 你的后台：`https://<用户名>.github.io/boli/admin.html`

## 让后台可以发布汇率

1. GitHub → 头像 → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**。
2. Repository access 选 **Only select repositories** → 这个仓库；Permissions → **Contents: Read and write**。
3. 复制令牌，在后台「汇率」→「GitHub 发布设置」里填入用户名、仓库名、网站分支和令牌，点保存。
4. 以后改好汇率点「发布给客户」，网站约 1 分钟后更新。令牌只保存在你这台设备的浏览器里。
