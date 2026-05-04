/* ─────────────────────────────────────────────
   Auth Check
   ───────────────────────────────────────────── */

const API_BASE = window.location.origin;
let authToken = localStorage.getItem('shopeeAffiliateToken');

if (!authToken) {
  window.location.href = '/login.html';
}

// Helper to call API with token
async function apiCall(url, options = {}) {
  const res = await fetch(API_BASE + url, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + authToken,
      ...options.headers
    },
    ...options
  });
  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem('shopeeAffiliateToken');
    window.location.href = '/login.html';
    return;
  }
  return res;
}

/* ─────────────────────────────────────────────
   Utility: Link Extraction & Normalization
   ───────────────────────────────────────────── */

function normalizeShopeeLink(link) {
  if (!link) return link;
  link = link.trim();
  if (/^(?:www\.)?(?:s\.)?shopee\.vn/.test(link) && !/^https?:\/\//i.test(link)) {
    return 'https://' + link;
  }
  return link;
}

function getOriginalLinkFromText(text, normalizedLink) {
  const patterns = [
    normalizedLink,
    normalizedLink.replace(/^https?:\/\//i, ''),
    normalizedLink.replace(/^https?:\/\/(?:www\.)?/i, '')
  ];
  for (const pattern of patterns) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    if (regex.test(text)) {
      const match = text.match(regex);
      if (match) return match[0];
    }
  }
  return normalizedLink;
}

function extractShopeeLinks(text) {
  const links = [];
  const rawToNormalized = {};
  const regex = /(?:https?:\/\/)?(?:www\.)?(?:s\.)?[^\s"']*shopee\.vn[^\s"']*/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const rawLink = match[0];
    const normalizedLink = normalizeShopeeLink(rawLink);
    rawToNormalized[rawLink] = normalizedLink;
    links.push({ raw: rawLink, normalized: normalizedLink });
  }
  const normalizedLinks = links.map(l => l.normalized);
  const unique = Array.from(new Set(normalizedLinks));
  const trimmed = (text || '').trim();
  if (!trimmed) return { links: unique, rawToNormalized: {}, mode: 'none' };
  const tokens = trimmed.split(/\s+/);
  const isPlainLinks = tokens.length === links.length &&
    links.every(l => tokens.some(t => t === l.raw || t.includes(l.raw) || l.raw.includes(t)));
  return { links: unique, rawToNormalized, mode: isPlainLinks ? 'plain-links' : 'text' };
}

function replaceLinksInText(text, mapping) {
  let result = text;
  const entries = Object.entries(mapping)
    .filter(([, data]) => data && data.shortLink)
    .sort((a, b) => b[0].length - a[0].length);
  entries.forEach(([orig, data]) => {
    const originalLinkInText = getOriginalLinkFromText(result, orig);
    if (originalLinkInText && originalLinkInText !== orig && result.includes(originalLinkInText)) {
      result = result.split(originalLinkInText).join(data.shortLink);
    } else {
      result = result.split(orig).join(data.shortLink);
    }
  });
  return result;
}

/* ─────────────────────────────────────────────
   Storage helpers (localStorage)
   ───────────────────────────────────────────── */

const KEYS = {
  accounts: 'sa_accounts',
  currentId: 'sa_currentAccountId',
  subIds: 'sa_subIds',
  lastInput: 'sa_lastInput',
  lastOutput: 'sa_lastOutput',
  history: 'sa_history'
};

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

/* ─────────────────────────────────────────────
   Cookie helpers
   ───────────────────────────────────────────── */

function cookieArrayToString(arr) {
  if (!Array.isArray(arr)) return '';
  return arr
    .filter(c => c && c.name && typeof c.value === 'string')
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}

/**
 * Normalize cookie input: accepts either
 *   - a plain cookie string  "name=val; name2=val2"
 *   - a JSON array of cookie objects [{name, value, ...}, ...]
 * Returns a cookie string in both cases.
 */
function normalizeCookieInput(raw) {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const converted = cookieArrayToString(arr);
      if (converted) return converted;
    } catch { /* not JSON, fall through */ }
  }
  return trimmed;
}

/* ─────────────────────────────────────────────
   App State
   ───────────────────────────────────────────── */

let accounts = lsGet(KEYS.accounts, []);
let currentAccountId = lsGet(KEYS.currentId, '');

/* ─────────────────────────────────────────────
   DOM References
   ───────────────────────────────────────────── */

const inputEl         = document.getElementById('inputText');
const outputEl        = document.getElementById('outputText');
const productCard     = document.getElementById('productCard');
const productList     = document.getElementById('productList');
const statusEl        = document.getElementById('status');
const convertBtn      = document.getElementById('convertBtn');
const copyOutputBtn   = document.getElementById('copyOutputBtn');
const clearInputBtn   = document.getElementById('clearInputBtn');
const addSubIdBtn     = document.getElementById('addSubIdBtn');
const subIdContainer  = document.getElementById('subIdContainer');
const settingsBtn     = document.getElementById('settingsBtn');
const syncLocalBtn     = document.getElementById('syncLocalBtn');
const logoutBtn        = document.getElementById('logoutBtn');
const settingsPanel   = document.getElementById('settingsPanel');
const closeSettingsBtn= document.getElementById('closeSettingsBtn');
const accountSelect   = document.getElementById('accountSelect');
const accountStatusDot = document.getElementById('accountStatusDot');
const extStatus        = document.getElementById('extStatus');
const accountNameInput= document.getElementById('accountName');
const cookieInput     = document.getElementById('cookieInput');
const cookieHelpBtn   = document.getElementById('cookieHelpBtn');
const cookieHelp      = document.getElementById('cookieHelp');
const settingsAddSubIdBtn    = document.getElementById('settingsAddSubIdBtn');
const settingsSubIdContainer = document.getElementById('settingsSubIdContainer');
const saveAccountBtn  = document.getElementById('saveAccountBtn');
const exportAccountBtn= document.getElementById('exportAccountBtn');
const importAccountBtn= document.getElementById('importAccountBtn');
const importAccountFile = document.getElementById('importAccountFile');
const deleteAccountBtn= document.getElementById('deleteAccountBtn');
const syncFromExtBtn  = document.getElementById('syncFromExtBtn');
const deleteConfirm   = document.getElementById('deleteConfirm');
const confirmDeleteBtn= document.getElementById('confirmDeleteBtn');
const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
const historyContainer= document.getElementById('historyContainer');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

/* ─────────────────────────────────────────────
   Status & Account Dot
   ───────────────────────────────────────────── */

function setStatus(msg, isError = false) {
  statusEl.textContent = msg || '';
  statusEl.className = 'status-msg' + (isError ? ' error' : ' success');
}

function setAccountStatus(status) {
  accountStatusDot.className = 'status-dot';
  if (status === 'active') {
    accountStatusDot.classList.add('status-active');
    accountStatusDot.title = 'Phiên đang hoạt động';
  } else if (status === 'inactive') {
    accountStatusDot.classList.add('status-inactive');
    accountStatusDot.title = 'Phiên có thể đã hết hạn';
  } else {
    accountStatusDot.classList.add('status-unknown');
    accountStatusDot.title = 'Chưa xác định trạng thái phiên';
  }
}

/* ─────────────────────────────────────────────
   Extension Proxy Detection
   ───────────────────────────────────────────── */

let detectedExtensionId = null;

async function detectExtension() {
  // Step 1: ask server for registered extension ID
  try {
    const resp = await fetch('/api/ext/id', { cache: 'no-store' });
    const data = await resp.json();
    if (data.ok && data.extensionId) {
      // Step 2: ping extension to verify it's alive
      const isAlive = await pingExtension(data.extensionId);
      if (isAlive) {
        detectedExtensionId = data.extensionId;
        extStatus.classList.remove('hidden');
        return;
      }
    }
  } catch (e) {
    // server not running
  }
  detectedExtensionId = null;
  extStatus.classList.add('hidden');
}

function pingExtension(extId) {
  return new Promise(resolve => {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      resolve(false);
      return;
    }
    try {
      chrome.runtime.sendMessage(extId, { type: 'PING' }, reply => {
        const ok = !!reply && reply.type === 'PONG';
        resolve(ok);
      });
      // timeout fallback
      setTimeout(() => resolve(false), 1500);
    } catch {
      resolve(false);
    }
  });
}

async function convertViaExtension(links, subIds) {
  if (!detectedExtensionId) throw new Error('Extension chưa sẵn sàng.');
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      detectedExtensionId,
      { type: 'CONVERT_LINKS', links, subIds },
      result => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!result || !result.ok) {
          reject(new Error(result && result.error ? result.error : 'Extension trả về lỗi.'));
          return;
        }
        resolve(result.mapping || {});
      }
    );
    setTimeout(() => reject(new Error('Extension không phản hồi trong 10s.')), 10000);
  });
}

// Detect on load and every 15s
detectExtension();
setInterval(detectExtension, 15000);

/* ─────────────────────────────────────────────
   SubID Management
   ───────────────────────────────────────────── */

function createSubIdRow(value, index, container, onRemove) {
  const row = document.createElement('div');
  row.className = 'subid-row';

  const label = document.createElement('span');
  label.className = 'subid-label';
  label.textContent = 'SubID ' + (index + 1);

  const input = document.createElement('input');
  input.className = 'subid-input';
  input.type = 'text';
  input.value = value || '';
  input.placeholder = 'VD: tiktok_10_2025';
  input.addEventListener('input', () => {
    if (onRemove === null) saveSubIds(); // main container
  });

  const removeBtn = document.createElement('button');
  removeBtn.className = 'subid-remove';
  removeBtn.textContent = '×';
  removeBtn.title = 'Xóa SubID này';
  removeBtn.addEventListener('click', () => {
    container.removeChild(row);
    syncLabels(container);
    if (onRemove === null) saveSubIds();
  });

  row.appendChild(label);
  row.appendChild(input);
  row.appendChild(removeBtn);
  return row;
}

function syncLabels(container) {
  container.querySelectorAll('.subid-label').forEach((label, idx) => {
    label.textContent = 'SubID ' + (idx + 1);
  });
}

function renderSubIds(container, subIds) {
  container.innerHTML = '';
  const list = (subIds && subIds.length ? subIds : ['']).slice(0, 5);
  list.forEach((value, idx) => {
    const row = createSubIdRow(value, idx, container, null);
    container.appendChild(row);
  });
  syncLabels(container);
}

function getSubIdsFromContainer(container) {
  return Array.from(container.querySelectorAll('.subid-input')).map(i => i.value || '');
}

function saveSubIds() {
  lsSet(KEYS.subIds, getSubIdsFromContainer(subIdContainer));
}

function addSubIdToContainer(container) {
  const current = container.querySelectorAll('.subid-row').length;
  if (current >= 5) { setStatus('Tối đa 5 SubID.', true); return; }
  const row = createSubIdRow('', current, container, null);
  container.appendChild(row);
  syncLabels(container);
}

addSubIdBtn.addEventListener('click', () => {
  addSubIdToContainer(subIdContainer);
  saveSubIds();
});

settingsAddSubIdBtn.addEventListener('click', () => {
  addSubIdToContainer(settingsSubIdContainer);
});

/* ─────────────────────────────────────────────
   Settings Panel
   ───────────────────────────────────────────── */

function openSettings() {
  settingsPanel.classList.add('open');
  // Sync current account data into settings fields
  const acc = accounts.find(a => a.id === currentAccountId);
  if (acc) {
    accountNameInput.value = acc.name || '';
    cookieInput.value = acc.cookie || '';
    renderSubIds(settingsSubIdContainer, acc.subIds || ['']);
  } else {
    accountNameInput.value = '';
    cookieInput.value = '';
    renderSubIds(settingsSubIdContainer, ['']);
  }
}

function closeSettings() {
  settingsPanel.classList.remove('open');
}

settingsBtn.addEventListener('click', openSettings);
closeSettingsBtn.addEventListener('click', closeSettings);

cookieHelpBtn.addEventListener('click', () => {
  cookieHelp.classList.toggle('hidden');
});

/* ─────────────────────────────────────────────
   Account Management
   ───────────────────────────────────────────── */

function persistAccounts() {
  lsSet(KEYS.accounts, accounts);
  lsSet(KEYS.currentId, currentAccountId);
}

function renderAccountSelect() {
  accountSelect.innerHTML = '<option value="">(Chưa chọn tài khoản)</option>';
  accounts.forEach(acc => {
    const opt = document.createElement('option');
    opt.value = acc.id;
    opt.textContent = acc.name || acc.id || 'Không tên';
    accountSelect.appendChild(opt);
  });
  if (currentAccountId) accountSelect.value = currentAccountId;
}

function applyAccount(account) {
  if (!account) return;
  const subIds = account.subIds && account.subIds.length ? account.subIds : [''];
  renderSubIds(subIdContainer, subIds);
  lsSet(KEYS.subIds, subIds);
  setAccountStatus('unknown');
}

function applyAccountById(id, showStatus = true) {
  const account = accounts.find(a => a.id === id);
  if (!account) return;
  currentAccountId = id;
  renderAccountSelect();
  applyAccount(account);
  persistAccounts();
  if (showStatus) setStatus('Đã chuyển tài khoản: ' + (account.name || ''), false);
}

accountSelect.addEventListener('change', () => {
  const id = accountSelect.value;
  if (!id) {
    currentAccountId = '';
    setAccountStatus('unknown');
    persistAccounts();
    return;
  }
  applyAccountById(id, true);
});

// Save account from settings panel
saveAccountBtn.addEventListener('click', () => {
  const name = accountNameInput.value.trim();
  const cookie = normalizeCookieInput(cookieInput.value);
  const subIds = getSubIdsFromContainer(settingsSubIdContainer);

  if (!cookie) {
    setStatus('Vui lòng nhập cookie xác thực trước khi lưu.', true);
    cookieInput.focus();
    return;
  }

  // Write back normalized cookie so textarea shows clean string
  cookieInput.value = cookie;

  const id = currentAccountId || Date.now().toString();
  const payload = { id, name: name || id, cookie, subIds };

  const existingIdx = accounts.findIndex(a => a.id === id);
  if (existingIdx >= 0) {
    accounts[existingIdx] = payload;
  } else {
    accounts.push(payload);
  }
  currentAccountId = id;
  persistAccounts();

  // Also sync SubIDs to main container
  renderSubIds(subIdContainer, subIds);
  lsSet(KEYS.subIds, subIds);

  renderAccountSelect();
  accountSelect.value = currentAccountId;
  setAccountStatus('unknown');
  setStatus('Đã lưu tài khoản "' + payload.name + '".', false);
  closeSettings();
});

// Export account as JSON (compatible with Chrome extension format)
exportAccountBtn.addEventListener('click', () => {
  const acc = accounts.find(a => a.id === currentAccountId);
  if (!acc) {
    setStatus('Chưa chọn tài khoản để xuất.', true);
    return;
  }
  const payload = {
    accountName: acc.name || '',
    subIds: acc.subIds || [],
    cookie: acc.cookie || '',
    exportedFrom: 'shopee-affiliate-server'
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'shopee-affiliate-account.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus('Đã xuất JSON tài khoản.', false);
});

// Import account from JSON
importAccountBtn.addEventListener('click', () => importAccountFile.click());

importAccountFile.addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result || '{}');
      const accountName = typeof data.accountName === 'string' ? data.accountName : '';
      const subIds = Array.isArray(data.subIds) && data.subIds.length ? data.subIds.slice(0, 5) : [''];

      // Support both cookie string and cookies array (from Chrome extension export)
      let cookie = '';
      if (typeof data.cookie === 'string' && data.cookie.trim()) {
        cookie = normalizeCookieInput(data.cookie);
      } else if (Array.isArray(data.cookies) && data.cookies.length) {
        cookie = cookieArrayToString(data.cookies);
      }

      if (!cookie) {
        setStatus('File JSON không chứa cookie hợp lệ.', true);
        return;
      }

      const newAccount = {
        id: Date.now().toString(),
        name: accountName || ('Account ' + new Date().toLocaleDateString('vi-VN')),
        cookie,
        subIds
      };

      accounts.push(newAccount);
      currentAccountId = newAccount.id;
      persistAccounts();
      renderAccountSelect();
      accountSelect.value = currentAccountId;
      applyAccount(newAccount);

      // Update settings fields
      accountNameInput.value = newAccount.name;
      cookieInput.value = cookie;
      renderSubIds(settingsSubIdContainer, subIds);

      setStatus('Đã nhập JSON tài khoản "' + newAccount.name + '".', false);
    } catch {
      setStatus('File JSON không hợp lệ.', true);
    } finally {
      importAccountFile.value = '';
    }
  };
  reader.readAsText(file);
});

// Delete account
deleteAccountBtn.addEventListener('click', () => deleteConfirm.classList.remove('hidden'));
cancelDeleteBtn.addEventListener('click', () => deleteConfirm.classList.add('hidden'));

confirmDeleteBtn.addEventListener('click', () => {
  if (currentAccountId) {
    accounts = accounts.filter(a => a.id !== currentAccountId);
    currentAccountId = '';
  }
  persistAccounts();
  renderAccountSelect();
  accountNameInput.value = '';
  cookieInput.value = '';
  renderSubIds(settingsSubIdContainer, ['']);
  renderSubIds(subIdContainer, ['']);
  lsSet(KEYS.subIds, ['']);
  setAccountStatus('unknown');
  deleteConfirm.classList.add('hidden');
  setStatus('Đã xóa tài khoản.', false);
  closeSettings();
});

/* ─────────────────────────────────────────────
   Convert
   ───────────────────────────────────────────── */

let serverSyncedCookie = null; // cached from /api/sync-cookie poll

async function pollSyncedCookie() {
  try {
    const res = await apiCall('/api/sync-cookie');
    if (!res) return;
    const data = await res.json();
    if (data.ok && data.cookie) {
      if (!serverSyncedCookie || serverSyncedCookie.cookie !== data.cookie) {
        serverSyncedCookie = data;
        setStatus(`Cookie đã được sync tự động từ extension (${data.accountName || ''}).`, false);
      }
    }
  } catch { /* silent */ }
}

// Poll every 30s
pollSyncedCookie();
setInterval(pollSyncedCookie, 30000);

function getCurrentCookie() {
  const acc = accounts.find(a => a.id === currentAccountId);
  return (acc && acc.cookie) || (serverSyncedCookie && serverSyncedCookie.cookie) || '';
}

function evaluateConversionStatus(mapping, requestedLinks) {
  let successCount = 0, failCount = 0;
  (requestedLinks || []).forEach(lnk => {
    const data = mapping && mapping[lnk];
    if (data && data.shortLink) successCount++;
    else failCount++;
  });
  const total = (requestedLinks || []).length;
  return { successCount, failCount, total, allFailed: total > 0 && successCount === 0 };
}

function renderProductInfo(mapping, links) {
  if (!productList || !productCard) return;
  productList.innerHTML = '';
  let hasAny = false;

  (links || []).forEach(link => {
    const data = mapping && mapping[link];
    if (!data || !data.shortLink || !data.product) return;
    const p = data.product;
    hasAny = true;

    const card = document.createElement('div');
    card.className = 'product-card';

    const img = p.image
      ? `<img src="${escapeHtml(p.image)}" class="product-img" alt="" loading="lazy" onerror="this.style.display='none'">`
      : `<div class="product-img-placeholder">📦</div>`;

    const priceStr = p.price != null
      ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(p.price)
      : '';

    card.innerHTML = `
      ${img}
      <div class="product-body">
        <div class="product-name" title="${escapeHtml(p.name || '')}">${escapeHtml(p.name || 'Sản phẩm Shopee')}</div>
        ${p.shopName ? `<div class="product-shop">🏪 ${escapeHtml(p.shopName)}</div>` : ''}
        ${priceStr ? `<div class="product-price">${priceStr}</div>` : ''}
        <a href="${escapeHtml(data.shortLink)}" class="product-link" target="_blank" rel="noopener">🔗 ${escapeHtml(data.shortLink)}</a>
      </div>
    `;
    productList.appendChild(card);
  });

  productCard.style.display = hasAny ? 'block' : 'none';
}

convertBtn.addEventListener('click', async () => {
  try {
    const raw = inputEl.value || '';
    const trimmed = raw.trim();
    if (!trimmed) {
      setStatus('Vui lòng dán link Shopee hoặc văn bản chứa link.', true);
      return;
    }

    const cookie = getCurrentCookie();
    // Cookie is optional here — server will auto-use syncedCookie if not provided

    lsSet(KEYS.lastInput, raw);

    const { links, rawToNormalized, mode } = extractShopeeLinks(raw);
    if (!links.length) {
      setStatus('Không tìm thấy link Shopee nào trong nội dung.', true);
      return;
    }

    const subIds = getSubIdsFromContainer(subIdContainer);

    convertBtn.disabled = true;
    convertBtn.textContent = '⏳ Đang convert...';
    setStatus('Đang gửi tới Shopee Affiliate...', false);

    let response, usedExtension = false;
    if (detectedExtensionId) {
      try {
        response = await convertViaExtension(links, subIds);
        if (response && response.ok) {
          usedExtension = true;
        } else {
          throw new Error(response?.error || 'Extension proxy failed');
        }
      } catch (extErr) {
        console.warn('[Extension] Proxy failed, fallback to server:', extErr);
      }
    }

    if (!usedExtension) {
      const res = await apiCall('/api/convert', {
        method: 'POST',
        body: JSON.stringify({ links: links, subIds: subIds, cookie })
      });
      if (!res) return; // apiCall handles redirect on auth failure
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Server error');
      response = data;
    }

    const mapping = response.mapping;

    // Build raw → shortLink mapping for text replacement
    const rawMapping = {};
    Object.keys(rawToNormalized).forEach(rawLink => {
      const normalizedLink = rawToNormalized[rawLink];
      if (mapping[normalizedLink] && mapping[normalizedLink].shortLink) {
        rawMapping[rawLink] = mapping[normalizedLink];
        rawMapping[normalizedLink] = mapping[normalizedLink];
      }
    });

    let output;
    if (rawMapping && Object.keys(rawMapping).length > 0) {
      // Only links mode: just return converted links
      output = Object.values(rawMapping)
        .map(data => (data && data.shortLink) || normalizedLink)
        .join('\n');
    } else {
      output = replaceLinksInText(raw, rawMapping);
    }

    outputEl.value = output;
    lsSet(KEYS.lastOutput, output);

    // Render product info cards
    renderProductInfo(mapping, links);

    const { successCount, failCount, total, allFailed } = evaluateConversionStatus(mapping, links);
    const viaBadge = usedExtension ? ' [Extension]' : '';
    if (allFailed) {
      setStatus('Phiên đăng nhập có thể đã hết hạn. Cập nhật cookie trong ⚙️ Cài đặt rồi thử lại.', true);
      setAccountStatus('inactive');
    } else if (failCount > 0) {
      setStatus(`Đã convert ${successCount}/${total} link${viaBadge}. Một số link lỗi, hãy kiểm tra cookie/SubID.`, true);
      setAccountStatus('active');
    } else {
      setStatus('Đã convert ' + total + ' link thành công' + viaBadge + '.', false);
      setAccountStatus('active');
    }

    saveToHistory(raw, output, links.length);
  } catch (err) {
    setStatus('Lỗi: ' + (err.message || err), true);
    setAccountStatus('inactive');
  } finally {
    convertBtn.disabled = false;
    convertBtn.textContent = '⚡ Convert link';
  }
});

/* ─────────────────────────────────────────────
   Logout & Quick Sync
   ───────────────────────────────────────────── */

logoutBtn.addEventListener('click', () => {
  if (confirm('Đăng xuất?')) {
    localStorage.removeItem('shopeeAffiliateToken');
    window.location.href = '/login.html';
  }
});

syncLocalBtn.addEventListener('click', async () => {
  const cookie = prompt('Dán cookie từ local máy tính (SPC_EC=...; SPC_F=...; SPC_ST=...; SPC_U=...; csrftoken=...):');
  if (!cookie || !cookie.trim()) return;
  try {
    const res = await fetch(API_BASE + '/api/sync-cookie-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: cookie.trim(), accountName: 'Local Sync' })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Sync failed');
    setStatus('Đã sync cookie từ local!', false);
    // Refresh account list
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  } catch (e) {
    setStatus('Lỗi sync local: ' + e.message, true);
  }
});

/* ─────────────────────────────────────────────
   Copy Output
   ───────────────────────────────────────────── */

copyOutputBtn.addEventListener('click', () => {
  const text = outputEl.value || '';
  if (!text.trim()) { setStatus('Không có nội dung để copy.', true); return; }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => setStatus('Đã copy kết quả vào clipboard.', false))
      .catch(() => setStatus('Không copy được vào clipboard.', true));
  } else {
    outputEl.select();
    document.execCommand('copy');
    setStatus('Đã copy kết quả.', false);
  }
});

/* ─────────────────────────────────────────────
   Clear Input
   ───────────────────────────────────────────── */

clearInputBtn.addEventListener('click', () => {
  inputEl.value = '';
  lsSet(KEYS.lastInput, '');
  inputEl.focus();
  setStatus('Đã xóa nội dung đầu vào.', false);
});

/* ─────────────────────────────────────────────
   History
   ───────────────────────────────────────────── */

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function saveToHistory(input, output, linkCount) {
  const history = lsGet(KEYS.history, []);
  history.unshift({
    id: Date.now(),
    timestamp: new Date().toISOString(),
    input: input.substring(0, 200),
    output: output.substring(0, 200),
    fullInput: input,
    fullOutput: output,
    linkCount
  });
  lsSet(KEYS.history, history.slice(0, 10));
  renderHistory();
}

function renderHistory() {
  const history = lsGet(KEYS.history, []);
  if (!history.length) {
    historyContainer.innerHTML = '<div class="empty-state">Chưa có lịch sử</div>';
    return;
  }

  historyContainer.innerHTML = history.map(item => {
    const date = new Date(item.timestamp);
    const timeStr = date.toLocaleString('vi-VN', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    const inputPreview = item.input.length > 80 ? item.input.substring(0, 80) + '…' : item.input;
    const outputPreview = item.output.length > 80 ? item.output.substring(0, 80) + '…' : item.output;

    return `
      <div class="history-item" data-id="${item.id}">
        <div class="history-item-head">
          <span class="history-time">${timeStr}</span>
          <span class="history-badge">${item.linkCount} link</span>
          <button class="history-del" data-id="${item.id}" title="Xóa">×</button>
        </div>
        <div class="history-preview">
          <span class="history-label">In:</span> ${escapeHtml(inputPreview)}<br/>
          <span class="history-label">Out:</span> ${escapeHtml(outputPreview)}
        </div>
      </div>`;
  }).join('');

  historyContainer.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.classList.contains('history-del')) return;
      const id = parseInt(item.dataset.id, 10);
      const h = lsGet(KEYS.history, []).find(x => x.id === id);
      if (h) {
        inputEl.value = h.fullInput;
        outputEl.value = h.fullOutput;
        const date = new Date(h.timestamp);
        setStatus('Đã tải lại lịch sử ' + date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }), false);
      }
    });
  });

  historyContainer.querySelectorAll('.history-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id, 10);
      const history = lsGet(KEYS.history, []).filter(x => x.id !== id);
      lsSet(KEYS.history, history);
      renderHistory();
    });
  });
}

/* ─────────────────────────────────────────────
   Sync Cookie from Extension
   ───────────────────────────────────────────── */

syncFromExtBtn.addEventListener('click', async () => {
  syncFromExtBtn.disabled = true;
  const orig = syncFromExtBtn.textContent;
  syncFromExtBtn.textContent = '⏳ Đang lấy...';

  try {
    const resp = await fetch('/api/sync-cookie');
    const data = await resp.json();

    if (!data.ok || !data.cookie) {
      setStatus('Chưa có cookie từ extension. Mở extension Cookie Sync → nhấn "Lấy cookie & Gửi tới Server" trước.', true);
      return;
    }

    // Fill cookie into settings panel
    cookieInput.value = data.cookie;
    if (data.accountName && !accountNameInput.value) {
      accountNameInput.value = data.accountName;
    }

    const syncTime = new Date(data.syncedAt).toLocaleString('vi-VN', {
      hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit'
    });
    setStatus(`✅ Đã kéo cookie từ extension (sync lúc ${syncTime}). Nhấn 💾 Lưu tài khoản để áp dụng.`, false);
  } catch {
    setStatus('Không kết nối được server để lấy cookie.', true);
  } finally {
    syncFromExtBtn.disabled = false;
    syncFromExtBtn.textContent = orig;
  }
});

clearHistoryBtn.addEventListener('click', () => {
  if (confirm('Bạn có chắc chắn muốn xóa tất cả lịch sử?')) {
    lsSet(KEYS.history, []);
    renderHistory();
    setStatus('Đã xóa tất cả lịch sử.', false);
  }
});

/* ─────────────────────────────────────────────
   Init
   ───────────────────────────────────────────── */

(function init() {
  // Restore last input/output
  const lastInput = lsGet(KEYS.lastInput, '');
  const lastOutput = lsGet(KEYS.lastOutput, '');
  if (lastInput) inputEl.value = lastInput;
  if (lastOutput) outputEl.value = lastOutput;

  // Restore SubIDs
  const subIds = lsGet(KEYS.subIds, ['']);
  renderSubIds(subIdContainer, Array.isArray(subIds) ? subIds : ['']);

  // Restore accounts
  accounts = lsGet(KEYS.accounts, []);
  currentAccountId = lsGet(KEYS.currentId, '');

  renderAccountSelect();

  if (currentAccountId) {
    applyAccountById(currentAccountId, false);
    setAccountStatus('unknown');
  }

  renderHistory();
})();
