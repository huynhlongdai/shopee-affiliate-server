/* ────────────────────────────────────────────────────────────
   Constants
   ──────────────────────────────────────────────────────────── */

const REQUIRED_COOKIES = ['SPC_EC', 'SPC_F', 'SPC_ST', 'SPC_U'];
// Query from multiple URLs so both affiliate-specific and .shopee.vn cookies are captured
const QUERY_URLS = [
  'https://affiliate.shopee.vn',
  'https://shopee.vn',
  'https://s.shopee.vn'
];

/* ────────────────────────────────────────────────────────────
   DOM
   ──────────────────────────────────────────────────────────── */

const serverUrlInput   = document.getElementById('serverUrl');
const accountNameInput = document.getElementById('accountName');
const syncBtn          = document.getElementById('syncBtn');
const syncBtnIcon      = document.getElementById('syncBtnIcon');
const syncBtnText      = document.getElementById('syncBtnText');
const statusEl         = document.getElementById('status');
const cookieStatusEl   = document.getElementById('cookieStatus');
const previewDetails   = document.getElementById('previewDetails');
const cookiePreview    = document.getElementById('cookiePreview');
const copyBtn          = document.getElementById('copyBtn');

/* ────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────── */

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + (type || '');
}

function setSyncing(active) {
  syncBtn.disabled = active;
  syncBtnIcon.textContent = active ? '⏳' : '🔄';
  syncBtnText.textContent = active ? 'Đang xử lý...' : 'Lấy cookie & Gửi tới Server';
}

function cookiesToString(cookies) {
  return cookies
    .filter(c => c.name && typeof c.value === 'string')
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}

/* ────────────────────────────────────────────────────────────
   Cookie API wrapper (handles lastError)
   ──────────────────────────────────────────────────────────── */

function getCookiesByUrl(url) {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ url }, cookies => {
      if (chrome.runtime.lastError) {
        console.warn('[CookieSync] getAll error for', url, chrome.runtime.lastError.message);
        resolve([]);
      } else {
        resolve(cookies || []);
      }
    });
  });
}

/* ────────────────────────────────────────────────────────────
   Multi-source cookie collection
   Merges cookies from all QUERY_URLS, deduplicates by name
   (first occurrence wins — affiliate-specific takes priority).
   ──────────────────────────────────────────────────────────── */

async function collectAllCookies() {
  const seen = new Set();
  const merged = [];
  const counts = {};

  for (const url of QUERY_URLS) {
    const cookies = await getCookiesByUrl(url);
    counts[url] = cookies.length;
    for (const c of cookies) {
      if (!seen.has(c.name)) {
        seen.add(c.name);
        merged.push(c);
      }
    }
  }

  console.log('[CookieSync] counts per URL:', counts, '→ merged unique:', merged.length);
  return { cookies: merged, counts };
}

/* ────────────────────────────────────────────────────────────
   Fallback: extract document.cookie from active affiliate tab
   (captures non-httpOnly cookies when the API returns nothing)
   ──────────────────────────────────────────────────────────── */

async function getCookieFromActiveTab() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id || !/affiliate\.shopee\.vn/.test(tab.url || '')) {
        resolve(null);
        return;
      }
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => document.cookie
        });
        const val = results && results[0] && results[0].result;
        resolve(typeof val === 'string' && val.trim() ? val.trim() : null);
      } catch (e) {
        console.warn('[CookieSync] scripting fallback error:', e.message);
        resolve(null);
      }
    });
  });
}

/* ────────────────────────────────────────────────────────────
   Status indicator
   ──────────────────────────────────────────────────────────── */

async function checkCookieStatus() {
  const { cookies, counts } = await collectAllCookies();
  const found   = REQUIRED_COOKIES.filter(n => cookies.some(c => c.name === n));
  const missing = REQUIRED_COOKIES.filter(n => !cookies.some(c => c.name === n));

  // Build debug line
  const debugLine = Object.entries(counts)
    .map(([url, n]) => `${url.replace('https://', '')}: ${n}`)
    .join(' | ');

  cookieStatusEl.classList.remove('hidden', 'ok', 'warn', 'error');

  if (found.length === REQUIRED_COOKIES.length) {
    cookieStatusEl.innerHTML = `✅ Đủ cookie (${cookies.length} tổng)<br><small style="opacity:.7">${debugLine}</small>`;
    cookieStatusEl.classList.add('ok');
  } else if (found.length > 0) {
    cookieStatusEl.innerHTML = `⚠️ ${cookies.length} cookie — thiếu: <b>${missing.join(', ')}</b><br><small style="opacity:.7">${debugLine}</small>`;
    cookieStatusEl.classList.add('warn');
  } else if (cookies.length > 0) {
    cookieStatusEl.innerHTML = `⚠️ ${cookies.length} cookie nhưng thiếu hết key affiliate<br><small style="opacity:.7">${debugLine}</small>`;
    cookieStatusEl.classList.add('warn');
  } else {
    cookieStatusEl.innerHTML = `❌ Không lấy được cookie (0 từ tất cả URL)<br>
      <small style="opacity:.7">${debugLine}</small><br>
      <small>→ Xóa extension rồi Load unpacked lại để cấp lại quyền</small>`;
    cookieStatusEl.classList.add('error');
  }

  return cookies;
}

/* ────────────────────────────────────────────────────────────
   Init: restore settings + check status
   ──────────────────────────────────────────────────────────── */

chrome.storage.local.get({ serverUrl: 'http://localhost:3000', accountName: '' }, data => {
  if (data.serverUrl) serverUrlInput.value = data.serverUrl;
  if (data.accountName) accountNameInput.value = data.accountName;
});

checkCookieStatus();

// Trigger background SW to re-register with server (in case SW was idle)
chrome.runtime.sendMessage({ type: 'REGISTER_WITH_SERVER' }).catch(() => {});

serverUrlInput.addEventListener('change', () => {
  chrome.storage.local.set({ serverUrl: serverUrlInput.value.trim() });
});
accountNameInput.addEventListener('change', () => {
  chrome.storage.local.set({ accountName: accountNameInput.value.trim() });
});

/* ────────────────────────────────────────────────────────────
   Main: Sync button
   ──────────────────────────────────────────────────────────── */

syncBtn.addEventListener('click', async () => {
  const serverUrl  = (serverUrlInput.value || 'http://localhost:3000').replace(/\/$/, '');
  const accountName = accountNameInput.value.trim() || 'Affiliate';

  setSyncing(true);
  setStatus('Đang lấy cookie...', '');

  try {
    // Step 1: collect from cookies API (multi-URL)
    let { cookies, counts } = await collectAllCookies();
    let source = 'api';

    // Step 2: if API returns nothing, fallback to document.cookie from active tab
    if (cookies.length === 0) {
      setStatus('Cookie API trả về rỗng — thử fallback qua tab đang mở...', 'warn');
      const tabCookieStr = await getCookieFromActiveTab();
      if (tabCookieStr) {
        // Convert "k1=v1; k2=v2" string into array of mock cookie objects
        cookies = tabCookieStr.split(';').map(pair => {
          const idx = pair.indexOf('=');
          if (idx < 1) return null;
          return { name: pair.slice(0, idx).trim(), value: pair.slice(idx + 1).trim() };
        }).filter(Boolean);
        source = 'tab-document.cookie (non-httpOnly only)';
      }
    }

    if (cookies.length === 0) {
      setStatus(
        '❌ Không lấy được cookie từ bất kỳ nguồn nào.\n' +
        '→ Xóa extension khỏi Chrome rồi Load unpacked lại để cấp lại quyền mới.',
        'error'
      );
      return;
    }

    const cookieString = cookiesToString(cookies);

    // Show preview
    cookiePreview.value = cookieString;
    previewDetails.classList.remove('hidden');

    setStatus(`Lấy được ${cookies.length} cookie (nguồn: ${source}). Đang gửi tới server...`, '');

    // Step 3: send to server
    let resp;
    try {
      resp = await fetch(`${serverUrl}/api/sync-cookie`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie: cookieString, accountName })
      });
    } catch {
      setStatus(`❌ Không kết nối được server tại ${serverUrl}. Kiểm tra server đang chạy.`, 'error');
      return;
    }

    if (!resp.ok) {
      setStatus(`❌ Server lỗi: HTTP ${resp.status}`, 'error');
      return;
    }

    const result = await resp.json();
    if (!result.ok) {
      setStatus('❌ Server: ' + (result.error || 'không rõ'), 'error');
      return;
    }

    chrome.storage.local.set({ accountName, serverUrl });
    setStatus(`✅ Đã gửi ${cookies.length} cookie! Vào web app → ⚙️ Cài đặt → Đồng bộ từ Extension.`, 'success');

  } finally {
    setSyncing(false);
    checkCookieStatus();
  }
});

/* ────────────────────────────────────────────────────────────
   Copy cookie string
   ──────────────────────────────────────────────────────────── */

copyBtn.addEventListener('click', () => {
  const text = cookiePreview.value;
  if (!text) return;
  navigator.clipboard.writeText(text).then(
    () => { copyBtn.textContent = '✅ Đã copy!'; setTimeout(() => { copyBtn.textContent = '📋 Copy cookie string'; }, 1800); },
    () => { copyBtn.textContent = '❌ Lỗi copy'; }
  );
});
