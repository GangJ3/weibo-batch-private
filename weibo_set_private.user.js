// ==UserScript==
// @name         微博批量设为仅自己可见（按日期）
// @namespace    local.weibo.batch-private
// @version      1.0.0
// @description  把某个日期之前发布的微博批量改为“仅自己可见”，支持试运行/单条测试
// @match        https://weibo.com/*
// @match        https://www.weibo.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

/*
 * 用法一（最简单，推荐）：浏览器打开并登录 weibo.com，进入你自己的个人主页，
 *   按 F12 -> Console，把本文件全部内容粘贴进去回车即可（会先按下面的 CONFIG 执行）。
 * 用法二（油猴）：安装 Tampermonkey，新建脚本粘贴本文件保存，刷新微博页面后右下角出现按钮。
 *
 * 接口依据（微博官方开放平台 statuses 文档）：
 *   visible: 0=公开, 1=仅自己可见, 2=密友可见, 3=指定分组
 */

// ================== 配置区（改这里） ==================
const CONFIG = {
  // 把“发布日期 早于 该日期”的微博设为仅自己可见。格式 YYYY-MM-DD，按北京时间 00:00 为界。
  CUTOFF_DATE: '2020-01-01',

  // 目标可见性：1=仅自己可见（默认）。2=密友可见，0=恢复公开。
  TARGET_VISIBLE: 1,

  // true=试运行：只打印将被修改的微博，不真正调用接口。强烈建议先跑一次核对日期筛选。
  DRY_RUN: true,

  // true=只处理第一条匹配的微博，用于验证接口是否生效（需先把 DRY_RUN 设为 false）。
  TEST_ONE: false,

  // 每条之间的间隔毫秒，太快可能触发风控。1000~2000 较稳。
  DELAY_MS: 1200,

  // 目标 uid，留空则自动从当前页面检测（请先打开你自己的主页）。
  TARGET_UID: '',

  // 翻页安全上限，防止死循环。
  MAX_PAGES: 500,
};
// =====================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getXsrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function resolveUid() {
  if (CONFIG.TARGET_UID) return String(CONFIG.TARGET_UID);
  const cfg = window.$CONFIG || {};
  if (cfg.oid) return String(cfg.oid);
  if (cfg.uid) return String(cfg.uid);
  let m = location.pathname.match(/\/u\/(\d+)/) || location.pathname.match(/^\/(\d{5,})/);
  if (m) return m[1];
  m = location.href.match(/[?&]uid=(\d+)/);
  if (m) return m[1];
  return '';
}

// 解析微博 created_at。支持完整格式 "Wed Oct 09 12:34:56 +0800 2024" 和相对时间。
function parseWeiboDate(str) {
  if (!str) return null;
  const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const m = str.match(/^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4})\s+(\d{4})$/);
  if (m && MON[m[1]] !== undefined) {
    const iso = `${m[7]}-${String(MON[m[1]] + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}T${m[3]}:${m[4]}:${m[5]}${m[6].slice(0, 3)}:${m[6].slice(3)}`;
    const t = Date.parse(iso);
    if (!isNaN(t)) return t;
  }
  // 相对时间（刚刚 / x分钟前 / 今天 / x小时前 / 昨天 / MM-DD）都属于近期，视为“现在”，不会被旧日期筛选命中
  if (/刚刚|秒前|分钟前|小时前|今天|昨天|分钟前/.test(str)) return Date.now();
  const d = Date.parse(str);
  return isNaN(d) ? null : d;
}

async function fetchPage(uid, page, sinceId) {
  let url = `https://weibo.com/ajax/statuses/mymblog?uid=${uid}&page=${page}&feature=0`;
  if (sinceId) url += `&since_id=${sinceId}`;
  const headers = { 'x-requested-with': 'XMLHttpRequest' };
  const xsrf = getXsrfToken();
  if (xsrf) headers['x-xsrf-token'] = xsrf;
  const res = await fetch(url, { credentials: 'include', headers });
  if (!res.ok) throw new Error(`列表接口 HTTP ${res.status}`);
  return res.json();
}

async function setVisible(id, visible) {
  const headers = {
    'content-type': 'application/x-www-form-urlencoded',
    'accept': 'application/json, text/plain, */*',
    'x-requested-with': 'XMLHttpRequest',
    'client-version': 'v1.1.251',
    'server-version': 'v2026.10.12.1',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  };
  const xsrf = getXsrfToken();
  if (xsrf) headers['x-xsrf-token'] = xsrf;
  const res = await fetch('https://weibo.com/ajax/statuses/modifyVisible', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: new URLSearchParams({ ids: String(id), visible: String(visible) }),
  });
  const j = await res.json().catch(() => ({}));
  return { ok: j.ok === 1, raw: j, status: res.status };
}

function preview(mb) {
  const text = (mb.text_raw || mb.text || '').replace(/<[^>]+>/g, '').slice(0, 50);
  return `${mb.id} | ${mb.created_at} | ${text}`;
}

async function startWeiboPrivate() {
  const uid = resolveUid();
  if (!uid) {
    console.error('[微博批量] 未能自动检测到 uid。请打开你自己的微博主页再运行，或在 CONFIG.TARGET_UID 手动填写。');
    return;
  }
  const cutoff = Date.parse(`${CONFIG.CUTOFF_DATE}T00:00:00+08:00`);
  if (isNaN(cutoff)) {
    console.error('[微博批量] CUTOFF_DATE 格式错误，应为 YYYY-MM-DD');
    return;
  }

  console.log(`%c[微博批量] uid=${uid}  截止日期=${CONFIG.CUTOFF_DATE}(之前)  目标visible=${CONFIG.TARGET_VISIBLE}  DRY_RUN=${CONFIG.DRY_RUN}`, 'color:#e67e22;font-weight:bold');
  if (CONFIG.DRY_RUN) console.log('%c[微博批量] 试运行模式：只预览，不会真正修改。确认无误后把 DRY_RUN 改为 false 再跑。', 'color:#27ae60');

  let page = 1, sinceId = 0, matched = 0, done = 0, failed = 0, stop = false;

  while (!stop && page <= CONFIG.MAX_PAGES) {
    let json;
    try {
      json = await fetchPage(uid, page, sinceId);
    } catch (e) {
      console.error(`[微博批量] 第 ${page} 页拉取失败，终止：`, e.message);
      break;
    }
    const list = (json && json.data && json.data.list) || [];
    if (!list.length) { console.log('[微博批量] 已到最后一页。'); break; }

    for (const mb of list) {
      const t = parseWeiboDate(mb.created_at);
      if (t === null) continue;
      if (t >= cutoff) continue; // 截止日期之后的，跳过

      matched++;
      if (CONFIG.DRY_RUN) {
        console.log('[试运行命中] ' + preview(mb));
        if (CONFIG.TEST_ONE) { stop = true; break; }
        continue;
      }

      const r = await setVisible(mb.id, CONFIG.TARGET_VISIBLE);
      if (r.ok) { done++; console.log('[已修改] ' + preview(mb)); }
      else { failed++; console.warn('[失败] ' + preview(mb) + ' => HTTP ' + r.status + ' ' + JSON.stringify(r.raw)); }

      if (CONFIG.TEST_ONE) {
        console.log('%c[微博批量] TEST_ONE 完成。请去页面刷新确认这条是否已变为“仅自己可见”。确认无误后把 TEST_ONE 改为 false 再全量执行。', 'color:#2980b9;font-weight:bold');
        stop = true; break;
      }
      await sleep(CONFIG.DELAY_MS);
    }

    sinceId = (json.data && json.data.since_id) || 0;
    page++;
    await sleep(CONFIG.DELAY_MS);
  }

  console.log(`%c[微博批量] 结束。命中 ${matched} 条` + (CONFIG.DRY_RUN ? '（试运行，未修改）' : `，成功 ${done} 条，失败 ${failed} 条。`), 'color:#e67e22;font-weight:bold');
}

// 油猴模式：注入按钮；控制台粘贴模式：直接运行。
(function () {
  const isUserscript = typeof GM_info !== 'undefined';
  if (!isUserscript) { startWeiboPrivate(); return; }
  const btn = document.createElement('button');
  btn.textContent = '微博批量设为仅自己可见';
  btn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;padding:10px 14px;background:#e67e22;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.3)';
  btn.onclick = () => { btn.disabled = true; btn.textContent = '运行中…'; startWeiboPrivate().finally(() => { btn.disabled = false; btn.textContent = '微博批量设为仅自己可见'; }); };
  const mount = () => document.body ? document.body.appendChild(btn) : setTimeout(mount, 300);
  mount();
})();
