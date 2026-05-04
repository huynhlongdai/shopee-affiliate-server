import { chromium } from 'playwright';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(join(__dirname, 'public')));

const GQL_ENDPOINT = 'https://affiliate.shopee.vn/api/v3/gql?q=batchCustomLink';
const JWT_SECRET = process.env.JWT_SECRET || 'shopee-affiliate-secret-2025';

// In-memory user store (in production, use DB)
const users = new Map();
const defaultUser = {
  username: 'admin',
  passwordHash: null, // will be set
  mfaSecret: null,
  mfaEnabled: false
};

// Initialize default admin user — password from env or hardcoded default
async function initDefaultUser() {
  const password = process.env.APP_PASSWORD || 'a]7$bj[lymTN}SUp';
  const hash = await bcrypt.hash(password, 10);
  const secret = speakeasy.generateSecret({ name: 'Shopee Affiliate Server', issuer: 'ShopeeAffiliate' });
  users.set('admin', {
    ...defaultUser,
    passwordHash: hash,
    mfaSecret: secret.base32,
    mfaEnabled: false
  });
  console.log('[Auth] Admin user ready.');
}

// JWT middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ ok: false, error: 'Missing token' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ ok: false, error: 'Invalid token' });
    req.user = user;
    next();
  });
}

/* ── Playwright headless browser ── */

let browser = null;
let browserReady = false;

async function initBrowser() {
  if (browser) return;
  console.log('[Playwright] Đang khởi động headless Chromium...');
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    browserReady = true;
    console.log('[Playwright] Browser sẵn sàng.');
  } catch (err) {
    console.error('[Playwright] Khởi động thất bại:', err.message);
    browserReady = false;
  }
}

function parseCookieString(cookieStr, url) {
  const hostname = new URL(url).hostname;
  return cookieStr
    .split(';')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      const eq = p.indexOf('=');
      if (eq === -1) return null;
      const name = p.substring(0, eq).trim();
      const value = p.substring(eq + 1).trim();
      if (!name) return null;
      return { name, value, domain: hostname, path: '/', httpOnly: false, secure: true, sameSite: 'Lax' };
    })
    .filter(Boolean);
}

/* ── Product Info + Commission via external API ── */

const PRODUCT_DATA_API = 'https://data.addlivetag.com/product-data/product-data.php';

async function fetchProductInfo(shopeeUrl) {
  try {
    const apiUrl = `${PRODUCT_DATA_API}?url=${encodeURIComponent(shopeeUrl)}`;
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.status !== 'success' || !json.productInfo) return null;
    const p = json.productInfo;
    const commissionRate = p.price > 0 ? ((p.commission / p.price) * 100).toFixed(1) : null;
    return {
      name:              p.productName || null,
      price:             p.price       || null,
      image:             p.imageUrl    || null,
      shopName:          p.shopName    || null,
      rating:            p.rating      || null,
      sales:             p.sales       || null,
      commission:        p.commission  || null,
      commissionRate:    commissionRate ? `${commissionRate}%` : null,
      sellerCommission:  p.sellerComFinal || null,
      shopeeCommission:  p.shopeeComFinal || null,
      isXtra:            p.isXtra      || false,
      cap:               p.cap         || null,
      productLink:       p.productLink || shopeeUrl,
    };
  } catch (err) {
    console.warn(`[ProductAPI] Failed for ${shopeeUrl}:`, err.message);
    return null;
  }
}

async function fetchProductInfoParallel(links) {
  const results = await Promise.allSettled(links.map(link => fetchProductInfo(link)));
  const map = {};
  links.forEach((link, i) => {
    map[link] = results[i].status === 'fulfilled' ? results[i].value : null;
  });
  return map;
}

async function convertWithPlaywright(links, subIds, cookieString) {
  if (!browserReady || !browser) {
    console.log('[Playwright] Browser chưa sẵn sàng, thử khởi động lại...');
    await initBrowser();
    if (!browserReady || !browser) {
      throw new Error('Browser khởi động thất bại. Kiểm tra log server.');
    }
  }

  const csrfToken = extractCsrfToken(cookieString);

  const cleanedSubIds = (subIds || [])
    .map(s => (s || '').trim())
    .filter(Boolean)
    .slice(0, 5);

  const query = `query batchGetCustomLink($linkParams: [CustomLinkParam!], $sourceCaller: SourceCaller){
    batchCustomLink(linkParams: $linkParams, sourceCaller: $sourceCaller){
      shortLink
      longLink
      failCode
    }
  }`;

  const linkParams = links.map(link => {
    const advancedLinkParams = {};
    cleanedSubIds.forEach((value, index) => {
      advancedLinkParams['subId' + (index + 1)] = value;
    });
    return { originalLink: link, advancedLinkParams };
  });

  const gqlBody = JSON.stringify({
    operationName: 'batchGetCustomLink',
    query,
    variables: { linkParams, sourceCaller: 'CUSTOM_LINK_CALLER' }
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });

  try {
    const cookies = parseCookieString(cookieString, 'https://affiliate.shopee.vn');
    if (cookies.length) await context.addCookies(cookies);

    // Navigate to affiliate dashboard to establish session & let Shopee set session cookies
    const page = await context.newPage();
    try {
      await page.goto('https://affiliate.shopee.vn/dashboard', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      const currentUrl = page.url();
      console.log('[Playwright] URL sau goto:', currentUrl);
      if (currentUrl.includes('/login') || currentUrl.includes('accounts.shopee')) {
        throw new Error('Cookie hết hạn hoặc không hợp lệ — bị redirect sang trang đăng nhập Shopee.');
      }
      await page.waitForTimeout(2000);
    } finally {
      await page.close();
    }

    // Use context.request (Chrome TLS fingerprint, context cookies, no page needed)
    console.log(`[Playwright] Gọi Shopee GQL qua context.request (${links.length} link)...`);
    const resp = await context.request.post(GQL_ENDPOINT, {
      headers: {
        'Content-Type': 'application/json',
        'x-csrftoken': csrfToken,
        'x-shopee-language': 'vi',
        'x-affiliate-source-type': '1',
        'Referer': 'https://affiliate.shopee.vn/dashboard',
        'Origin': 'https://affiliate.shopee.vn'
      },
      data: gqlBody
    });

    const json = await resp.json();

    if (json && json.error) {
      throw new Error(`Shopee error ${json.error} (action_type=${json.action_type})`);
    }
    if (!resp.ok()) {
      throw new Error(`HTTP ${resp.status()}: Shopee trả về lỗi không xác định.`);
    }

    const list = ((json.data || {}).batchCustomLink) || [];
    const mapping = {};
    links.forEach((link, idx) => {
      const item = list[idx];
      if (item && item.failCode === 0 && item.shortLink) {
        mapping[link] = { shortLink: item.shortLink, longLink: item.longLink, failCode: 0 };
      } else {
        mapping[link] = { error: true, failCode: item ? item.failCode : -1 };
      }
    });

    return mapping;
  } finally {
    await context.close();
  }
}

// In-memory store for cookie synced from the Chrome extension
let syncedCookie = null; // { cookie, accountName, syncedAt }

/* ── Auth endpoints ── */

// Login with password only (username always 'admin')
app.post('/api/auth/login', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ ok: false, error: 'Password required' });
  const user = users.get('admin');
  if (!user) return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(401).json({ ok: false, error: 'Invalid credentials' });

  if (user.mfaEnabled) {
    // Return temp token requiring MFA
    const tempToken = jwt.sign({ username: 'admin', mfaRequired: true }, JWT_SECRET, { expiresIn: '5m' });
    return res.json({ ok: true, mfaRequired: true, tempToken });
  }

  const token = jwt.sign({ username: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ ok: true, token, mfaRequired: false });
});

// Verify TOTP code and return final JWT
app.post('/api/auth/verify-mfa', (req, res) => {
  const { tempToken, code } = req.body;
  if (!tempToken || !code) return res.status(400).json({ ok: false, error: 'tempToken and code required' });

  let decoded;
  try {
    decoded = jwt.verify(tempToken, JWT_SECRET);
    if (!decoded.mfaRequired) return res.status(400).json({ ok: false, error: 'Invalid temp token' });
  } catch {
    return res.status(403).json({ ok: false, error: 'Invalid or expired temp token' });
  }

  const user = users.get(decoded.username);
  if (!user || !user.mfaEnabled) return res.status(400).json({ ok: false, error: 'MFA not enabled' });

  const verified = speakeasy.totp.verify({
    secret: user.mfaSecret,
    encoding: 'base32',
    token: code,
    window: 2
  });

  if (!verified) return res.status(401).json({ ok: false, error: 'Invalid 2FA code' });

  const token = jwt.sign({ username: decoded.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ ok: true, token });
});

// Get 2FA setup QR code
app.get('/api/auth/2fa/setup', authenticateToken, (req, res) => {
  const user = users.get(req.user.username);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
  if (user.mfaEnabled) return res.status(400).json({ ok: false, error: '2FA already enabled' });

  const secret = speakeasy.generateSecret({ name: 'Shopee Affiliate Server', issuer: 'ShopeeAffiliate', user: req.user.username });
  QRCode.toDataURL(secret.otpauth_url, (err, dataUrl) => {
    if (err) return res.status(500).json({ ok: false, error: 'Failed to generate QR' });
    res.json({ ok: true, secret: secret.base32, qrCode: dataUrl });
  });
});

// Enable 2FA
app.post('/api/auth/2fa/enable', authenticateToken, (req, res) => {
  const { secret, code } = req.body;
  if (!secret || !code) return res.status(400).json({ ok: false, error: 'secret and code required' });

  const verified = speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: code,
    window: 2
  });

  if (!verified) return res.status(401).json({ ok: false, error: 'Invalid 2FA code' });

  const user = users.get(req.user.username);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });

  user.mfaSecret = secret;
  user.mfaEnabled = true;
  res.json({ ok: true, message: '2FA enabled' });
});

// Disable 2FA
app.post('/api/auth/2fa/disable', authenticateToken, (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ ok: false, error: '2FA code required' });

  const user = users.get(req.user.username);
  if (!user || !user.mfaEnabled) return res.status(400).json({ ok: false, error: '2FA not enabled' });

  const verified = speakeasy.totp.verify({
    secret: user.mfaSecret,
    encoding: 'base32',
    token: code,
    window: 2
  });

  if (!verified) return res.status(401).json({ ok: false, error: 'Invalid 2FA code' });

  user.mfaEnabled = false;
  res.json({ ok: true, message: '2FA disabled' });
});

/* ── Cookie sync endpoints ── */

// Extension POSTs cookie here
app.post('/api/sync-cookie', (req, res) => {
  const { cookie, accountName } = req.body || {};
  if (!cookie || typeof cookie !== 'string' || !cookie.trim()) {
    return res.status(400).json({ ok: false, error: 'Thiếu cookie.' });
  }
  syncedCookie = {
    cookie: cookie.trim(),
    accountName: (accountName || 'Affiliate').trim(),
    syncedAt: new Date().toISOString()
  };
  console.log(`[sync] Cookie nhận từ extension — tài khoản: "${syncedCookie.accountName}", lúc: ${syncedCookie.syncedAt}`);
  res.json({ ok: true, accountName: syncedCookie.accountName, syncedAt: syncedCookie.syncedAt });
});

// Web app polls here to pick up synced cookie
app.get('/api/sync-cookie', (_req, res) => {
  if (!syncedCookie) {
    return res.json({ ok: false, error: 'Chưa có cookie nào được sync.' });
  }
  res.json({ ok: true, ...syncedCookie });
});

// Quick sync cookie from local machine (no auth for convenience)
app.post('/api/sync-cookie-local', (req, res) => {
  const { cookie, accountName } = req.body || {};
  if (!cookie || typeof cookie !== 'string' || !cookie.trim()) {
    return res.status(400).json({ ok: false, error: 'Thiếu cookie.' });
  }
  syncedCookie = {
    cookie: cookie.trim(),
    accountName: (accountName || 'Local Sync').trim(),
    syncedAt: new Date().toISOString()
  };
  console.log(`[sync-local] Cookie nhận từ local — tài khoản: "${syncedCookie.accountName}", lúc: ${syncedCookie.syncedAt}`);
  res.json({ ok: true, accountName: syncedCookie.accountName, syncedAt: syncedCookie.syncedAt });
});

/* ── Extension proxy registration ── */

let registeredExtensionId = null;

// Extension background SW calls this on startup so web app can find its ID
app.post('/api/ext/register', (req, res) => {
  const { extensionId } = req.body || {};
  if (!extensionId || typeof extensionId !== 'string') {
    return res.status(400).json({ ok: false, error: 'extensionId required.' });
  }
  registeredExtensionId = extensionId.trim();
  console.log('[ext] Extension registered — ID:', registeredExtensionId);
  res.json({ ok: true });
});

// Web app calls this to get the extension ID for chrome.runtime.sendMessage
app.get('/api/ext/id', (_req, res) => {
  res.json({ ok: !!registeredExtensionId, extensionId: registeredExtensionId });
});

function extractCsrfToken(cookieString) {
  if (!cookieString) return '';
  const match = cookieString.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? match[1].trim() : '';
}

app.post('/api/convert', authenticateToken, async (req, res) => {
  try {
    const { links, subIds } = req.body;
    let { cookie } = req.body;

    if (!links || !Array.isArray(links) || links.length === 0) {
      return res.status(400).json({ ok: false, error: 'Không có link để convert.' });
    }

    // Auto-fallback to server-side synced cookie if client didn't send one
    if (!cookie || typeof cookie !== 'string' || !cookie.trim()) {
      if (syncedCookie && syncedCookie.cookie) {
        cookie = syncedCookie.cookie;
        console.log(`[convert] Dùng cookie đã sync từ extension (${syncedCookie.accountName || 'unknown'})`);
      } else {
        return res.status(400).json({
          ok: false,
          error: 'Thiếu cookie. Vui lòng sync cookie từ extension hoặc thiết lập trong Cài đặt.'
        });
      }
    }

    const uniqueLinks = Array.from(new Set(links.filter(Boolean)));

    let mapping;
    try {
      mapping = await convertWithPlaywright(uniqueLinks, subIds, cookie.trim());
    } catch (pwErr) {
      console.error('[Convert] Failed:', pwErr.message);
      return res.status(502).json({
        ok: false,
        error: pwErr.message || String(pwErr)
      });
    }

    // ── Fetch product info + commission from external API ──
    const productInfos = await fetchProductInfoParallel(uniqueLinks);
    Object.keys(mapping).forEach(link => {
      if (mapping[link] && !mapping[link].error && productInfos[link]) {
        mapping[link].product = productInfos[link];
      }
    });

    res.json({ ok: true, mapping });
  } catch (err) {
    console.error('[ShopeeAffiliate] /api/convert error:', err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, browserReady, timestamp: new Date().toISOString() });
});

app.listen(PORT, async () => {
  console.log(`\n🚀 Shopee Affiliate Server đang chạy tại: http://localhost:${PORT}\n`);
  await initDefaultUser();
  initBrowser();
});
