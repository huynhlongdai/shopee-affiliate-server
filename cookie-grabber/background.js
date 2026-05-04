/* ────────────────────────────────────────────────────────────
   Shopee Affiliate Cookie Sync — Background Service Worker
   Proxies batchGetCustomLink calls for the web app.

   CRITICAL: Shopee affiliate uses anti-bot tokens (af-ac-enc-dat,
   af-ac-enc-sz-token, x-sap-ri, x-sap-sec) computed by JS on the
   page.  We CANNOT reproduce them in a background fetch.

   SOLUTION: Inject a script directly into an open
   affiliate.shopee.vn tab.  The injected script runs inside the
   page context (same origin) so fetch() automatically carries
   cookies + all anti-bot headers computed by the page.
   ──────────────────────────────────────────────────────────── */

const SERVER_URLS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

/* ── Tab-injection convert ── */

async function convertLinksViaTab(links, subIds) {
  const uniqueLinks = Array.from(new Set((links || []).filter(Boolean)));
  if (!uniqueLinks.length) throw new Error('Không có link nào.');

  const cleanedSubIds = (subIds || [])
    .map(s => (s || '').trim())
    .filter(Boolean)
    .slice(0, 5);

  /* 1. Find an open affiliate.shopee.vn tab */
  const tabs = await chrome.tabs.query({ url: '*://affiliate.shopee.vn/*' });
  if (!tabs || !tabs.length) {
    throw new Error('Không tìm thấy tab affiliate.shopee.vn. Hãy mở trang affiliate.shopee.vn và đăng nhập trước.');
  }
  const tab = tabs[0];

  /* 2. Inject the fetch call directly into the page */
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (linksArg, subIdsArg) => {
      return new Promise((resolve, reject) => {
        const query = `query batchGetCustomLink($linkParams: [CustomLinkParam!], $sourceCaller: SourceCaller){
          batchCustomLink(linkParams: $linkParams, sourceCaller: $sourceCaller){
            shortLink
            longLink
            failCode
          }
        }`;
        const cleanedSubIds = (subIdsArg || [])
          .map(s => (s || '').trim())
          .filter(Boolean)
          .slice(0, 5);
        const linkParams = linksArg.map(link => {
          const advancedLinkParams = {};
          cleanedSubIds.forEach((value, index) => {
            advancedLinkParams['subId' + (index + 1)] = value;
          });
          return { originalLink: link, advancedLinkParams };
        });
        const body = {
          operationName: 'batchGetCustomLink',
          query,
          variables: { linkParams, sourceCaller: 'CUSTOM_LINK_CALLER' }
        };
        fetch('https://affiliate.shopee.vn/api/v3/gql?q=batchCustomLink', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify(body)
        })
        .then(r => {
          if (!r.ok) {
            return r.text().then(t => { throw new Error('HTTP ' + r.status + ': ' + t.substring(0, 200)); });
          }
          return r.json();
        })
        .then(json => {
          if (json && json.error) {
            throw new Error('Shopee error ' + json.error + ' (action_type=' + json.action_type + ')');
          }
          const list = ((json.data || {}).batchCustomLink) || [];
          const mapping = {};
          linksArg.forEach((link, idx) => {
            const item = list[idx];
            if (item && item.failCode === 0 && item.shortLink) {
              mapping[link] = { shortLink: item.shortLink, longLink: item.longLink, failCode: 0 };
            } else {
              mapping[link] = { error: true, failCode: item ? item.failCode : -1 };
            }
          });
          resolve(mapping);
        })
        .catch(reject);
      });
    },
    args: [uniqueLinks, cleanedSubIds]
  });

  if (!results || !results[0]) {
    throw new Error('Không nhận được kết quả từ tab injection.');
  }
  if (results[0].error) {
    throw new Error(results[0].error.message || String(results[0].error));
  }
  return results[0].result;
}

/* ── External message handler (from web app at localhost) ── */

chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (!message) return false;

  if (message.type === 'PING') {
    sendResponse({ type: 'PONG', ok: true });
    return false;
  }

  if (message.type !== 'CONVERT_LINKS') return false;

  convertLinksViaTab(message.links || [], message.subIds || [])
    .then(mapping  => sendResponse({ ok: true,  mapping }))
    .catch(err     => sendResponse({ ok: false, error: String(err.message || err) }));

  return true; // async
});

/* ── Register extension ID with local server ── */

async function registerWithServer() {
  const id = chrome.runtime.id;
  for (const base of SERVER_URLS) {
    try {
      await fetch(`${base}/api/ext/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extensionId: id })
      });
      console.log('[CookieSync BG] Registered with', base, '— ID:', id);
      return;
    } catch { /* server might not be running, ignore */ }
  }
}

chrome.runtime.onInstalled.addListener(registerWithServer);
chrome.runtime.onStartup.addListener(registerWithServer);

// Also handle explicit register request from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'REGISTER_WITH_SERVER') {
    registerWithServer().then(() => sendResponse({ ok: true }));
    return true;
  }
});
