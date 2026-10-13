# 微博批量设为「仅自己可见」（按日期）

把某个日期之前发布的微博，自动、批量改为「仅自己可见」。提供两种可执行方案，二选一即可。

> 接口依据（微博官方开放平台 statuses 文档）：`visible` 取值 `0=公开, 1=仅自己可见, 2=密友可见, 3=指定分组`。
> 本工具默认 `TARGET_VISIBLE=1`。仅操作你自己账号、你自己已登录的会话，不涉及他人数据。

---

## 方案 A：浏览器脚本（推荐，免装 Cookie）

文件：`weibo_set_private.user.js`

**最简单的用法（F12 控制台）：**
1. 电脑浏览器打开并登录 `https://weibo.com`，进入**你自己的个人主页**。
2. 按 `F12` → 切到 `Console`（控制台）。
3. 打开 `weibo_set_private.user.js`，全选复制，粘贴进控制台，回车。
4. 默认是**试运行（DRY_RUN=true）**：只打印将被修改的微博，不会真改。先核对日期筛选是否正确。
5. 确认无误后，把脚本顶部 `CONFIG.DRY_RUN` 改成 `false`（建议先保持 `TEST_ONE=true` 只改一条，刷新页面确认那条已变「仅自己可见」），再把 `TEST_ONE` 改 `false` 全量执行。

**油猴用法：** 安装 Tampermonkey → 新建脚本 → 粘贴本文件保存 → 刷新微博页面 → 右下角出现按钮，点击运行。

---

## 方案 B：Python 脚本（适合命令行/服务器）

文件：`weibo_set_private.py`，依赖：`pip install requests`

1. 浏览器登录 `weibo.com`，进你自己主页，`F12` → `Network` → 刷新 → 找一条 `mymblog` 请求 → 复制 Request Headers 里整段 **Cookie**。
2. 把 Cookie 粘贴到脚本 `COOKIE`，或存到同目录 `cookie.txt`。
3. 在 `TARGET_UID` 填你自己的数字 uid（主页 `weibo.com/u/` 后面的数字）。
4. 运行：`python weibo_set_private.py`
5. 同样默认 `DRY_RUN=True` 先预览，核对后改 `False`；可先用 `TEST_ONE=True` 验证一条。

---

## 关键配置

| 配置 | 含义 |
|---|---|
| `CUTOFF_DATE` | 早于该日期（北京时间 00:00）的微博会被修改，格式 `YYYY-MM-DD` |
| `TARGET_VISIBLE` | `1`=仅自己可见（默认）；`0`=恢复公开；`2`=密友可见 |
| `DRY_RUN` | `true/True`=只预览不修改（**默认开，务必先跑一次**） |
| `TEST_ONE` | 只处理第一条命中的，用于验证接口生效 |
| `DELAY` / `DELAY_MS` | 每条间隔，太快可能触发风控，建议 1~2 秒 |

## 注意
- 微博接口可能随版本调整。若单条测试返回失败（`ok` 非 1），大概率是 `visible` 目标值或风控问题——先用 `TEST_ONE` 验证，看控制台打印的原始返回。
- 改为「仅自己可见」后可再改回（`TARGET_VISIBLE=0`），但已产生的对外曝光无法撤回。
- 请合理控制频率，避免账号被限流。
