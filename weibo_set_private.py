#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
微博批量设为“仅自己可见”（按日期）—— Python 版

原理：
  列表接口  GET  https://weibo.com/ajax/statuses/mymblog?uid=&page=&feature=0[&since_id=]
  改权限    POST https://weibo.com/ajax/statuses/modifyVisible   body: {"id": mid, "visible": 1}
  visible 取值（微博官方开放平台 statuses 文档）：0=公开, 1=仅自己可见, 2=密友可见, 3=指定分组

准备：
  1) 电脑浏览器登录 weibo.com，进入你自己的主页。
  2) F12 -> Network -> 刷新 -> 找一条 mymblog 请求 -> 复制 Request Headers 里的整段 Cookie。
  3) 把 Cookie 粘贴到下面 COOKIE（或写入同目录 cookie.txt）。
  4) 建议先 DRY_RUN=True 跑一次核对日期筛选，再改 False 正式执行。
"""

import json
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("缺少依赖，请先执行:  pip install requests")

# ================== 配置区 ==================
COOKIE = ""                 # 直接粘贴整段 Cookie；留空则读取同目录 cookie.txt
CUTOFF_DATE = "2020-01-01"  # 早于该日期(北京时间 00:00)的微博将被修改
TARGET_VISIBLE = 1          # 1=仅自己可见
TARGET_UID = ""             # 留空则自动从 Cookie 里的 SUB 无关；建议手动填你自己的数字 uid
DRY_RUN = True              # True=只预览不修改
TEST_ONE = False            # True=只处理第一条命中的，用于验证接口
DELAY = 1.2                 # 每条间隔秒数
MAX_PAGES = 500
# ===========================================

CST = timezone(timedelta(hours=8))
MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], start=1)}


def load_cookie() -> str:
    if COOKIE.strip():
        return COOKIE.strip()
    p = Path(__file__).with_name("cookie.txt")
    if p.exists():
        return p.read_text(encoding="utf-8").strip()
    sys.exit("未提供 Cookie：请设置 COOKIE 变量或写入同目录 cookie.txt")


def get_uid(cookie: str) -> str:
    if TARGET_UID.strip():
        return TARGET_UID.strip()
    # 有些登录态 Cookie 里带 uid；否则从 SUBPID/其他无法可靠取，需手动填
    m = re.search(r"(?:^|;\s*)uid=(\d+)", cookie)
    if m:
        return m.group(1)
    sys.exit("无法自动确定 uid，请在 TARGET_UID 手动填写你自己的数字 uid（主页 weibo.com/u/后面的数字）")


def parse_created_at(s: str):
    """返回 datetime(带北京时区) 或 None。相对时间视为当前时间。"""
    if not s:
        return None
    m = re.match(r"^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4})\s+(\d{4})$", s)
    if m and m.group(1) in MONTHS:
        mon, day, hh, mm, ss, tz, year = m.groups()
        tz_iso = tz[:3] + ":" + tz[3:]
        try:
            return datetime.fromisoformat(f"{year}-{MONTHS[mon]:02d}-{int(day):02d}T{hh}:{mm}:{ss}{tz_iso}")
        except ValueError:
            pass
    if re.search(r"刚刚|秒前|分钟前|小时前|今天|昨天", s):
        return datetime.now(CST)
    return None


def build_session(cookie: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Referer": "https://weibo.com/",
        "x-requested-with": "XMLHttpRequest",
        "Cookie": cookie,
    })
    m = re.search(r"(?:^|;\s*)XSRF-TOKEN=([^;]+)", cookie)
    if m:
        from urllib.parse import unquote
        s.headers["x-xsrf-token"] = unquote(m.group(1))
    return s


def fetch_page(s, uid, page, since_id):
    params = {"uid": uid, "page": page, "feature": 0}
    if since_id:
        params["since_id"] = since_id
    r = s.get("https://weibo.com/ajax/statuses/mymblog", params=params, timeout=20)
    r.raise_for_status()
    return r.json()


def set_visible(s, mid, visible):
    r = s.post("https://weibo.com/ajax/statuses/modifyVisible",
               data=json.dumps({"id": str(mid), "visible": visible}),
               headers={"content-type": "application/json"}, timeout=20)
    try:
        j = r.json()
    except Exception:
        j = {}
    return (j.get("ok") == 1), r.status_code, j


def preview(mb):
    text = re.sub(r"<[^>]+>", "", mb.get("text_raw") or mb.get("text") or "")[:50]
    return f"{mb.get('id')} | {mb.get('created_at')} | {text}"


def main():
    cookie = load_cookie()
    uid = get_uid(cookie)
    s = build_session(cookie)
    cutoff = datetime.strptime(CUTOFF_DATE, "%Y-%m-%d").replace(tzinfo=CST)

    print(f"[微博批量] uid={uid}  截止={CUTOFF_DATE}(之前)  visible={TARGET_VISIBLE}  DRY_RUN={DRY_RUN}")
    if DRY_RUN:
        print("[微博批量] 试运行：只预览不修改。核对无误后把 DRY_RUN 改为 False。")

    page, since_id = 1, 0
    matched = done = failed = 0
    while page <= MAX_PAGES:
        try:
            data = fetch_page(s, uid, page, since_id)
        except Exception as e:
            print(f"[微博批量] 第 {page} 页拉取失败，终止：{e}")
            break
        lst = (data.get("data") or {}).get("list") or []
        if not lst:
            print("[微博批量] 已到最后一页。")
            break

        stop = False
        for mb in lst:
            dt = parse_created_at(mb.get("created_at"))
            if dt is None or dt >= cutoff:
                continue
            matched += 1
            if DRY_RUN:
                print("[试运行命中] " + preview(mb))
                if TEST_ONE:
                    stop = True
                    break
                continue

            ok, status, raw = set_visible(s, mb.get("id"), TARGET_VISIBLE)
            if ok:
                done += 1
                print("[已修改] " + preview(mb))
            else:
                failed += 1
                print(f"[失败] {preview(mb)} => HTTP {status} {raw}")
            if TEST_ONE:
                print("[微博批量] TEST_ONE 完成，请刷新页面确认该条是否已变为仅自己可见。")
                stop = True
                break
            time.sleep(DELAY)

        if stop:
            break
        since_id = (data.get("data") or {}).get("since_id") or 0
        page += 1
        time.sleep(DELAY)

    tail = "（试运行，未修改）" if DRY_RUN else f"，成功 {done} 条，失败 {failed} 条。"
    print(f"[微博批量] 结束。命中 {matched} 条{tail}")


if __name__ == "__main__":
    main()
