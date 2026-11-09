'use strict';
/*
 * Arses Panel - پنل مدیریت نت ملی و نت بین‌الملل
 * بدون هیچ وابستگی خارجی (فقط Node.js 18+)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = __dirname;
const STATIC = new Set(['/index.html', '/style.css', '/app.js']);
const GB = 1024 ** 3;
const DAY = 86400000;

fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'arses.json');

/* ---------------------------- دیتابیس (JSON) ---------------------------- */
const defaults = () => ({
  users: [],
  history: {},
  admin: null,
  apiKey: null,
  secret: null,
  settings: {
    targets: {
      national: [
        { name: 'آپارات', url: 'https://www.aparat.com' },
        { name: 'دیوار', url: 'https://divar.ir' },
        { name: 'دیجی‌کالا', url: 'https://www.digikala.com' },
      ],
      international: [
        { name: 'Google', url: 'https://www.google.com' },
        { name: 'Cloudflare', url: 'https://www.cloudflare.com' },
        { name: 'GitHub', url: 'https://github.com' },
      ],
    },
  },
});

let db = defaults();
try {
  db = Object.assign(defaults(), JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
} catch (_) { /* اولین اجرا */ }

let saveTimer = null;
function flush() {
  clearTimeout(saveTimer);
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 200);
}
process.on('SIGTERM', () => { flush(); process.exit(0); });
process.on('SIGINT', () => { flush(); process.exit(0); });

/* ----------------------------- احراز هویت ------------------------------ */
const rand = (n = 24) => crypto.randomBytes(n).toString('hex');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
let ADMIN_PASS = process.env.ADMIN_PASS;
if (!ADMIN_PASS) {
  if (!db.admin || !db.admin.generated) {
    ADMIN_PASS = rand(6);
    db.admin = { generated: ADMIN_PASS };
    console.log('\n[Arses] ADMIN_PASS تنظیم نشده؛ رمز تصادفی ساخته شد:');
    console.log(`[Arses] user=${ADMIN_USER}  pass=${ADMIN_PASS}\n`);
  } else {
    ADMIN_PASS = db.admin.generated;
  }
}
const SECRET = process.env.SECRET || db.secret || (db.secret = rand(32));
const API_KEY = process.env.API_KEY || db.apiKey || (db.apiKey = rand(20));
flush();

const safeEq = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
function makeSession() {
  const p = Buffer.from(JSON.stringify({ u: ADMIN_USER, exp: Date.now() + 7 * DAY })).toString('base64url');
  return p + '.' + sign(p);
}
function readSession(req) {
  const m = /(?:^|;\s*)arses_session=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const [p, s] = m[1].split('.');
  if (!p || !s || !safeEq(sign(p), s)) return null;
  try {
    const d = JSON.parse(Buffer.from(p, 'base64url').toString());
    return d.exp > Date.now() ? d : null;
  } catch (_) { return null; }
}
const fails = new Map(); // ip -> [timestamps]
function tooMany(ip) {
  const now = Date.now();
  const arr = (fails.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  fails.set(ip, arr);
  return arr.length >= 10;
}

/* ------------------------------ منطق کاربر ----------------------------- */
function statusOf(u) {
  if (!u.enabled) return 'disabled';
  if (u.expireAt && u.expireAt < Date.now()) return 'expired';
  const n = u.national.quota && u.national.used >= u.national.quota;
  const i = u.international.quota && u.international.used >= u.international.quota;
  if (n && i) return 'limited';
  if (i) return 'intl_limited';
  if (n) return 'nat_limited';
  return 'active';
}
const view = (u) => ({ ...u, status: statusOf(u) });
const publicView = (u) => ({
  name: u.name,
  status: statusOf(u),
  expireAt: u.expireAt,
  national: u.national,
  international: u.international,
});
const num = (v, d = 0) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);

function applyUserInput(u, b, isNew) {
  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!name || name.length > 64) throw new HttpError(400, 'نام کاربر نامعتبر است');
    if (db.users.some((x) => x.id !== u.id && x.name.toLowerCase() === name.toLowerCase()))
      throw new HttpError(409, 'این نام قبلاً استفاده شده');
    u.name = name;
  } else if (isNew) throw new HttpError(400, 'نام کاربر لازم است');
  if (b.note !== undefined) u.note = String(b.note).slice(0, 300);
  if (b.enabled !== undefined) u.enabled = !!b.enabled;
  if (b.nationalQuotaGB !== undefined) u.national.quota = Math.round(num(b.nationalQuotaGB) * GB);
  if (b.internationalQuotaGB !== undefined) u.international.quota = Math.round(num(b.internationalQuotaGB) * GB);
  if (b.nationalUsedGB !== undefined) u.national.used = Math.round(num(b.nationalUsedGB) * GB);
  if (b.internationalUsedGB !== undefined) u.international.used = Math.round(num(b.internationalUsedGB) * GB);
  if (b.expireDays !== undefined) {
    u.expireAt = b.expireDays === null || b.expireDays === '' ? null : Date.now() + num(b.expireDays) * DAY;
  }
}

function addHistory(n, i) {
  const d = new Date().toISOString().slice(0, 10);
  const h = db.history[d] || (db.history[d] = { national: 0, international: 0 });
  h.national += n;
  h.international += i;
  const keys = Object.keys(db.history).sort();
  while (keys.length > 60) delete db.history[keys.shift()];
}

/* -------------------------------- HTTP -------------------------------- */
class HttpError extends Error {
  constructor(code, msg) { super(msg); this.code = code; }
}
function send(res, code, obj, headers = {}) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 1e6) { req.destroy(); reject(new HttpError(413, 'حجم درخواست زیاد است')); }
    });
    req.on('end', () => {
      try { resolve(s ? JSON.parse(s) : {}); } catch (_) { reject(new HttpError(400, 'JSON نامعتبر')); }
    });
    req.on('error', reject);
  });
}
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
function serveStatic(req, res, pathname) {
  if (pathname === '/' || pathname.startsWith('/u/')) pathname = '/index.html';
  const file = path.join(PUBLIC_DIR, pathname);
  if (!STATIC.has(pathname) || !fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  });
  fs.createReadStream(file).pipe(res);
}

async function handleApi(req, res, url) {
  const p = url.pathname.slice(4); // بعد از /api
  const m = req.method;
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const secure = req.headers['x-forwarded-proto'] === 'https';

  /* --- بدون نیاز به ورود --- */
  if (p === '/login' && m === 'POST') {
    if (tooMany(ip)) throw new HttpError(429, 'تلاش بیش از حد؛ ۱۰ دقیقه بعد دوباره امتحان کنید');
    const b = await readBody(req);
    if (safeEq(b.username || '', ADMIN_USER) && safeEq(b.password || '', ADMIN_PASS)) {
      return send(res, 200, { ok: true }, {
        'set-cookie': `arses_session=${makeSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 86400}${secure ? '; Secure' : ''}`,
      });
    }
    fails.get(ip).push(Date.now());
    throw new HttpError(401, 'نام کاربری یا رمز اشتباه است');
  }
  if (p === '/logout' && m === 'POST') {
    return send(res, 200, { ok: true }, { 'set-cookie': 'arses_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  let mm;
  if ((mm = /^\/public\/([a-f0-9]+)$/.exec(p)) && m === 'GET') {
    const u = db.users.find((x) => x.token === mm[1]);
    if (!u) throw new HttpError(404, 'کاربر پیدا نشد');
    return send(res, 200, publicView(u));
  }

  /* --- ایجنت‌ها با API key --- */
  if (p.startsWith('/agent/')) {
    if (!safeEq(req.headers['x-api-key'] || '', API_KEY)) throw new HttpError(401, 'API key نامعتبر');
    if (p === '/agent/users' && m === 'GET') {
      return send(res, 200, db.users.map((u) => ({ id: u.id, name: u.name, token: u.token, status: statusOf(u) })));
    }
    if (p === '/agent/report' && m === 'POST') {
      const b = await readBody(req);
      const items = Array.isArray(b.items) ? b.items : [b];
      const results = [];
      let tn = 0, ti = 0;
      for (const it of items) {
        const u = db.users.find((x) => (it.token && x.token === it.token) || (it.user && x.name === it.user));
        if (!u) { results.push({ user: it.user || it.token, error: 'not_found' }); continue; }
        const n = Math.round(num(it.national)), i = Math.round(num(it.international));
        u.national.used += n; u.international.used += i; tn += n; ti += i;
        results.push({ user: u.name, status: statusOf(u) });
      }
      addHistory(tn, ti);
      save();
      return send(res, 200, { ok: true, results });
    }
    throw new HttpError(404, 'پیدا نشد');
  }

  /* --- نیاز به ورود ادمین --- */
  if (!readSession(req)) throw new HttpError(401, 'ابتدا وارد شوید');
  if (p === '/me') return send(res, 200, { user: ADMIN_USER });

  if (p === '/users' && m === 'GET') return send(res, 200, db.users.map(view));
  if (p === '/users' && m === 'POST') {
    const u = {
      id: rand(6), token: rand(12), name: '', note: '', enabled: true, createdAt: Date.now(), expireAt: null,
      national: { quota: 0, used: 0 }, international: { quota: 0, used: 0 },
    };
    applyUserInput(u, await readBody(req), true);
    db.users.push(u);
    save();
    return send(res, 201, view(u));
  }
  if ((mm = /^\/users\/([a-f0-9]+)(\/reset)?$/.exec(p))) {
    const u = db.users.find((x) => x.id === mm[1]);
    if (!u) throw new HttpError(404, 'کاربر پیدا نشد');
    if (mm[2] && m === 'POST') {
      u.national.used = 0; u.international.used = 0;
      save();
      return send(res, 200, view(u));
    }
    if (!mm[2] && m === 'PUT') {
      applyUserInput(u, await readBody(req), false);
      save();
      return send(res, 200, view(u));
    }
    if (!mm[2] && m === 'DELETE') {
      db.users = db.users.filter((x) => x.id !== u.id);
      save();
      return send(res, 200, { ok: true });
    }
  }
  if (p === '/stats' && m === 'GET') {
    const s = { users: db.users.length, active: 0, disabled: 0, expired: 0, limited: 0, national: 0, international: 0 };
    for (const u of db.users) {
      const st = statusOf(u);
      if (st === 'active') s.active++;
      else if (st === 'disabled') s.disabled++;
      else if (st === 'expired') s.expired++;
      else s.limited++;
      s.national += u.national.used;
      s.international += u.international.used;
    }
    const days = [];
    for (let k = 13; k >= 0; k--) {
      const d = new Date(Date.now() - k * DAY).toISOString().slice(0, 10);
      days.push({ date: d, ...(db.history[d] || { national: 0, international: 0 }) });
    }
    return send(res, 200, { ...s, days });
  }
  if (p === '/settings' && m === 'GET') {
    return send(res, 200, { targets: db.settings.targets, apiKey: API_KEY });
  }
  if (p === '/settings' && m === 'PUT') {
    const b = await readBody(req);
    const clean = (arr) => (Array.isArray(arr) ? arr : []).slice(0, 10).map((t) => {
      const name = String(t.name || '').trim().slice(0, 40);
      const u = String(t.url || '').trim();
      if (!name || !/^https?:\/\/[^\s]+$/i.test(u)) throw new HttpError(400, 'آدرس یا نام هدف نامعتبر است');
      return { name, url: u };
    });
    db.settings.targets = { national: clean(b.targets && b.targets.national), international: clean(b.targets && b.targets.international) };
    save();
    return send(res, 200, { targets: db.settings.targets, apiKey: API_KEY });
  }
  throw new HttpError(404, 'پیدا نشد');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, decodeURIComponent(url.pathname));
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    console.error(e);
    return send(res, 500, { error: 'خطای داخلی سرور' });
  }
});
server.listen(PORT, '0.0.0.0', () => console.log(`[Arses] panel listening on :${PORT}  data=${DATA_DIR}`));
