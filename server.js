'use strict';
/**
 * Alutrend site + dashboard server (zero dependencies).
 *   node server.js            -> http://127.0.0.1:3000   (site)
 *                                http://127.0.0.1:3000/admin  (dashboard)
 *
 * Edits are saved to data/content.json and uploaded images to uploads/.
 * Both are plain static files, so the folder can be deployed to any static host.
 */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;
const DATA = path.join(ROOT, 'data');
const BACKUPS = path.join(DATA, 'backups');
const UPLOADS = path.join(ROOT, 'uploads');
const PRIVATE = path.join(ROOT, 'server-data');
const CONTENT_FILE = path.join(DATA, 'content.json');
const AUTH_FILE = path.join(PRIVATE, 'auth.json');
const DEFAULT_PASSWORD = 'alutrend2025';
const MAX_UPLOAD = 25 * 1024 * 1024;
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif', '.ico']);

const PAGES = [
  { id: 'index', label: 'Home', file: 'index.html' },
  { id: 'about', label: 'About', file: 'about.html' },
  { id: 'services', label: 'Services', file: 'services.html' },
  { id: 'portfolio', label: 'Portfolio', file: 'portfolio-2.html' },
  { id: 'contact', label: 'Contact', file: 'contact.html' }
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject', '.txt': 'text/plain; charset=utf-8'
};

/* What the site looks like before any customization (mirrors the current markup). */
const DEFAULTS = {
  team: {
    visible: false,
    heading: 'Meet thee Team',
    members: [
      { name: 'Aly Ayad', role: 'Founder', image: 'images/resource/team-7.png', socials: {} },
      { name: 'Abdelaziz Ayad', role: 'General Manager', image: 'images/resource/team-8.png', socials: {} },
      { name: 'Alhassan Ayad', role: 'Brand Development', image: 'images/resource/team-9.png', socials: {} }
    ]
  },
  footer: {
    contactTitle: 'General Contact',
    phones: ['+20 111 817 4053', '+20 112 815 5434'],
    email: 'alutrend.designs@gmail.com',
    hoursTitle: 'Working days',
    hours: ['Saturday-Thursday: 8 AM - 11 PM', 'Friday: Closed'],
    socials: [
      { label: 'WhatsApp', icon: 'images/main-slider/whatsapp.png', url: 'https://wa.me/201118174053' },
      { label: 'TikTok', icon: 'images/main-slider/tiktok.png', url: 'https://www.tiktok.com/@alutrend_designs' },
      { label: 'Facebook', icon: 'images/resource/facebook.svg', url: 'https://www.facebook.com/share/1Aj3zSfwL3/?mibextid=wwXIfr' },
      { label: 'Instagram', icon: 'images/resource/instagram.svg', url: 'https://www.instagram.com/alutrend_designs?igsh=YTUwbnVsaDljdXVt' }
    ],
    branchTitle: 'EGYPT , 6 OCTOBER',
    address: 'Industrial Zone, 6 October, Giza, Egypt',
    branchPhone: '+20 111 817 4053',
    branchEmail: 'alutrend.designs@gmail.com',
    copyright: '©2025 Alutrend'
  }
};

/* ---------- helpers ---------- */
const exists = async p => { try { await fsp.access(p); return true; } catch { return false; } };

function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  const payload = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, Object.assign({
    'Content-Type': isObj ? MIME['.json'] : MIME['.txt'],
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }, headers));
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 2 * 1024 * 1024) {
  const buf = await readBody(req, limit);
  try { return JSON.parse(buf.toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

/* ---------- auth ---------- */
function hashPassword(pw, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  return { salt: salt.toString('hex'), hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}

async function loadAuth() {
  try { return JSON.parse(await fsp.readFile(AUTH_FILE, 'utf8')); }
  catch {
    const a = hashPassword(DEFAULT_PASSWORD);
    await fsp.mkdir(PRIVATE, { recursive: true });
    await fsp.writeFile(AUTH_FILE, JSON.stringify(a));
    return a;
  }
}

function checkPassword(pw, auth) {
  const { hash } = hashPassword(String(pw), auth.salt);
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(auth.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const sessions = new Map();           // token -> expiry
const failures = new Map();           // ip -> { n, until }
const COOKIE = 'alutrend_admin';

function getCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? m[1] : null;
}
function isAuthed(req) {
  const t = getCookie(req, COOKIE);
  if (!t || !sessions.has(t)) return false;
  if (sessions.get(t) < Date.now()) { sessions.delete(t); return false; }
  return true;
}

/* ---------- content ---------- */
const str = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const safePath = v => {
  const s = str(v, 400).replace(/\\/g, '/').replace(/^\.?\//, '');
  return /^(uploads|images)\//.test(s) && !s.split('/').includes('..') ? s : '';
};

function sanitizeContent(raw) {
  const out = { images: {} };
  const imgs = raw && typeof raw.images === 'object' && raw.images ? raw.images : {};
  for (const [k, v] of Object.entries(imgs)) {
    const key = safePath(k), val = safePath(v);
    if (key && val && key !== val) out.images[key] = val;
  }
  if (raw && raw.team && Array.isArray(raw.team.members)) {
    out.team = {
      visible: raw.team.visible === true,
      heading: str(raw.team.heading, 120),
      members: raw.team.members.slice(0, 40).map(m => ({
        name: str(m && m.name, 120), role: str(m && m.role, 120),
        image: safePath(m && m.image) || 'images/resource/team-7.png',
        socials: ['linkedin', 'twitter', 'facebook', 'instagram'].reduce((o, k) => {
          const u = str(m && m.socials && m.socials[k], 400); if (u) o[k] = u; return o;
        }, {})
      }))
    };
  }
  if (raw && raw.footer && typeof raw.footer === 'object') {
    const f = raw.footer, list = (a, n) => (Array.isArray(a) ? a.slice(0, n).map(x => str(x, 200)).filter(Boolean) : []);
    out.footer = {
      contactTitle: str(f.contactTitle, 120), phones: list(f.phones, 10), email: str(f.email, 200),
      hoursTitle: str(f.hoursTitle, 120), hours: list(f.hours, 10),
      socials: (Array.isArray(f.socials) ? f.socials : []).slice(0, 12).map(s => ({
        label: str(s && s.label, 60), icon: safePath(s && s.icon), url: str(s && s.url, 600)
      })).filter(s => s.icon),
      branchTitle: str(f.branchTitle, 120), address: str(f.address, 300),
      branchPhone: str(f.branchPhone, 120), branchEmail: str(f.branchEmail, 200), copyright: str(f.copyright, 300)
    };
  }
  return out;
}

async function readContent() {
  try { return JSON.parse(await fsp.readFile(CONTENT_FILE, 'utf8')); } catch { return { images: {} }; }
}

async function writeContent(content) {
  await fsp.mkdir(BACKUPS, { recursive: true });
  if (await exists(CONTENT_FILE)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fsp.copyFile(CONTENT_FILE, path.join(BACKUPS, `content-${stamp}.json`));
    const files = (await fsp.readdir(BACKUPS)).filter(f => f.endsWith('.json')).sort();
    for (const old of files.slice(0, Math.max(0, files.length - 15))) await fsp.unlink(path.join(BACKUPS, old)).catch(() => {});
  }
  const tmp = CONTENT_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(content, null, 2));
  await fsp.rename(tmp, CONTENT_FILE);
}

/* ---------- site scan: every image reference in pages + stylesheets ---------- */
function normalizeSrc(raw, baseDir = '') {
  let s = String(raw || '').trim();
  if (!s || /^(data:|https?:|\/\/|#|javascript:)/i.test(s)) return null;
  s = s.split(/[?#]/)[0].replace(/\\/g, '/');
  try { s = decodeURIComponent(s); } catch { /* keep as is */ }
  s = path.posix.normalize(path.posix.join(baseDir, s)).replace(/^\.?\/+/, '');
  if (s.startsWith('..') || !IMG_EXT.has(path.posix.extname(s).toLowerCase())) return null;
  return s;
}

function maskComments(html) { return html.replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length)); }

function prettify(cls) {
  const t = (cls || '').split(/\s+/).filter(Boolean)[0] || 'page';
  if (/hidden-bar/.test(cls || '')) return 'Side menu';
  const clean = t.replace(/^main-/, '').replace(/[-_]+/g, ' ').trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

async function scanSite() {
  const result = [];
  for (const page of PAGES) {
    let html;
    try { html = maskComments(await fsp.readFile(path.join(ROOT, page.file), 'utf8')); } catch { continue; }
    const markers = [];
    const mre = /<(section|header|footer|aside)\b[^>]*class\s*=\s*["']([^"']*)["']|<div\b[^>]*class\s*=\s*["']([^"']*\b(?:hidden-bar|sidebar-cart|main-slider|banner)[^"']*)["']/gi;
    let m;
    while ((m = mre.exec(html))) markers.push({ at: m.index, label: m[1] === 'footer' ? 'Footer' : m[1] === 'header' ? 'Header' : prettify(m[2] || m[3]) });
    const sectionAt = i => { let l = 'Page'; for (const mk of markers) { if (mk.at <= i) l = mk.label; else break; } return l; };

    const items = [];
    const add = (raw, at, kind, alt) => {
      const src = normalizeSrc(raw);
      if (src) items.push({ src, kind, alt: alt || '', section: sectionAt(at), missing: !fs.existsSync(path.join(ROOT, src)) });
    };
    const ire = /<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gis;
    while ((m = ire.exec(html))) {
      const alt = (m[0].match(/\balt\s*=\s*(["'])(.*?)\1/i) || [])[2];
      add(m[2], m.index, 'image', alt);
    }
    const bre = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    while ((m = bre.exec(html))) add(m[2], m.index, 'background');
    result.push({ id: page.id, label: page.label, file: page.file, items });
  }

  // Stylesheet backgrounds (css/*.css)
  const cssItems = [];
  try {
    for (const f of (await fsp.readdir(path.join(ROOT, 'css'))).filter(f => f.endsWith('.css'))) {
      const css = await fsp.readFile(path.join(ROOT, 'css', f), 'utf8');
      const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi; let m;
      while ((m = re.exec(css))) {
        const src = normalizeSrc(m[2], 'css');
        // font files and jQuery-UI/owl UI sprites are not site artwork
        if (src && !/^(fonts|css)\//.test(src)) cssItems.push({ src, kind: 'background', section: f, alt: '', missing: !fs.existsSync(path.join(ROOT, src)) });
      }
    }
  } catch { /* no css dir */ }
  if (cssItems.length) result.push({ id: 'css', label: 'Stylesheets', file: 'css/', items: cssItems });
  return result;
}

async function walkImages(dir, base, out, depth = 0) {
  if (depth > 4 || out.length > 1500) return;
  let entries; try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const abs = path.join(dir, e.name), rel = base + '/' + e.name;
    if (e.isDirectory()) { if (e.name !== 'splashscreen video') await walkImages(abs, rel, out, depth + 1); }
    else if (IMG_EXT.has(path.extname(e.name).toLowerCase())) {
      const st = await fsp.stat(abs);
      out.push({ path: rel, size: st.size, mtime: st.mtimeMs });
    }
  }
}

/* ---------- API ---------- */
async function handleApi(req, res, url) {
  const route = url.pathname.replace(/^\/api/, '');
  const method = req.method;

  if (method === 'GET' && route === '/content') return send(res, 200, await readContent());
  if (method === 'GET' && route === '/session') return send(res, 200, { authenticated: isAuthed(req) });

  if (method === 'POST' && route === '/login') {
    const ip = req.socket.remoteAddress;
    const f = failures.get(ip);
    if (f && f.until > Date.now()) return send(res, 429, { error: 'Too many attempts. Try again in a minute.' });
    const body = await readJson(req, 10 * 1024);
    const auth = await loadAuth();
    if (!checkPassword(body.password || '', auth)) {
      const n = (f ? f.n : 0) + 1;
      failures.set(ip, { n, until: n >= 5 ? Date.now() + 60000 : 0 });
      return send(res, 401, { error: 'Wrong password' });
    }
    failures.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + 12 * 3600 * 1000);
    return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` });
  }

  // Everything below needs a session and the custom header (blocks cross-site requests)
  if (!isAuthed(req)) return send(res, 401, { error: 'Not signed in' });
  if (method !== 'GET' && req.headers['x-requested-with'] !== 'dashboard') return send(res, 403, { error: 'Forbidden' });

  if (method === 'POST' && route === '/logout') {
    sessions.delete(getCookie(req, COOKIE));
    return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
  }
  if (method === 'GET' && route === '/defaults') return send(res, 200, DEFAULTS);
  if (method === 'GET' && route === '/scan') return send(res, 200, { pages: await scanSite() });

  if (method === 'GET' && route === '/library') {
    const site = [], uploads = [];
    await walkImages(path.join(ROOT, 'images'), 'images', site);
    await walkImages(UPLOADS, 'uploads', uploads);
    uploads.sort((a, b) => b.mtime - a.mtime);
    return send(res, 200, { site, uploads });
  }

  if (method === 'PUT' && route === '/content') {
    const clean = sanitizeContent(await readJson(req));
    await writeContent(clean);
    return send(res, 200, { ok: true, content: clean });
  }

  if (method === 'POST' && route === '/upload') {
    let name = ''; try { name = decodeURIComponent(req.headers['x-filename'] || ''); } catch { /* ignore */ }
    const ext = path.extname(name).toLowerCase();
    if (!IMG_EXT.has(ext)) return send(res, 400, { error: 'Unsupported file type' });
    const buf = await readBody(req, MAX_UPLOAD);
    if (!buf.length) return send(res, 400, { error: 'Empty file' });
    const base = path.basename(name, ext).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image';
    const file = `${Date.now().toString(36)}-${base}${ext}`;
    await fsp.mkdir(UPLOADS, { recursive: true });
    await fsp.writeFile(path.join(UPLOADS, file), buf);
    return send(res, 200, { path: 'uploads/' + file, size: buf.length });
  }

  if (method === 'DELETE' && route === '/upload') {
    const name = path.basename(url.searchParams.get('name') || '');
    if (!name) return send(res, 400, { error: 'Missing name' });
    await fsp.unlink(path.join(UPLOADS, name)).catch(() => {});
    return send(res, 200, { ok: true });
  }

  if (method === 'GET' && route === '/backups') {
    let files = []; try { files = (await fsp.readdir(BACKUPS)).filter(f => f.endsWith('.json')).sort().reverse(); } catch { /* none */ }
    return send(res, 200, { backups: files });
  }
  if (method === 'POST' && route === '/restore') {
    const body = await readJson(req, 10 * 1024);
    const name = path.basename(String(body.name || ''));
    const file = path.join(BACKUPS, name);
    if (!/^content-.*\.json$/.test(name) || !(await exists(file))) return send(res, 404, { error: 'Backup not found' });
    const clean = sanitizeContent(JSON.parse(await fsp.readFile(file, 'utf8')));
    await writeContent(clean);
    return send(res, 200, { ok: true, content: clean });
  }

  if (method === 'POST' && route === '/password') {
    const body = await readJson(req, 10 * 1024);
    const auth = await loadAuth();
    if (!checkPassword(body.current || '', auth)) return send(res, 400, { error: 'Current password is wrong' });
    if (String(body.next || '').length < 6) return send(res, 400, { error: 'New password must be at least 6 characters' });
    await fsp.writeFile(AUTH_FILE, JSON.stringify(hashPassword(String(body.next))));
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'Not found' });
}

/* ---------- static files ---------- */
const DENY_TOP = new Set(['server-data', 'node_modules', 'server.js', 'start-dashboard.bat', 'package.json', 'package-lock.json']);

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad request'); }
  rel = path.posix.normalize('/' + rel.replace(/\\/g, '/'));
  let abs = path.resolve(ROOT, '.' + rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');
  const relNative = path.relative(ROOT, abs);
  const top = relNative.split(path.sep)[0];
  if (DENY_TOP.has(top) || top.startsWith('.') || relNative.startsWith(path.join('data', 'backups')) || path.extname(abs) === '.php') {
    return send(res, 404, 'Not found');
  }
  let st;
  try { st = await fsp.stat(abs); } catch { return send(res, 404, 'Not found'); }
  if (st.isDirectory()) {
    if (!pathname.endsWith('/')) return send(res, 301, '', { Location: pathname + '/' });
    abs = path.join(abs, 'index.html');
    try { st = await fsp.stat(abs); } catch { return send(res, 404, 'Not found'); }
  }
  const ext = path.extname(abs).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  };
  // Uploaded SVGs must never run script if opened directly
  if (relNative.split(path.sep)[0] === 'uploads') headers['Content-Security-Policy'] = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(abs).pipe(res);
}

/* ---------- server ---------- */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

const server = http.createServer(async (req, res) => {
  try {
    // Guard against DNS-rebinding when bound to loopback
    if (LOOPBACK.has(HOST)) {
      const h = String(req.headers.host || '').replace(/:\d+$/, '');
      if (!LOOPBACK.has(h)) return send(res, 403, 'Forbidden host');
    }
    const url = new URL(req.url, 'http://localhost');
    // Also accept the old "/alutrend-website-/..." address (when the parent folder used to be served)
    if (url.pathname === '/alutrend-website-') url.pathname = '/';
    else if (url.pathname.startsWith('/alutrend-website-/')) url.pathname = url.pathname.slice('/alutrend-website-'.length);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(req, res, url.pathname);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Server error' : err.message });
  }
});

(async () => {
  await fsp.mkdir(DATA, { recursive: true });
  await fsp.mkdir(UPLOADS, { recursive: true });
  const firstRun = !(await exists(AUTH_FILE));
  await loadAuth();
  server.listen(PORT, HOST, () => {
    console.log(`\n  Alutrend site      http://${HOST}:${PORT}/`);
    console.log(`  Alutrend dashboard http://${HOST}:${PORT}/admin/`);
    if (firstRun) console.log(`\n  First run - default password: ${DEFAULT_PASSWORD}  (change it in Settings)`);
    console.log('');
  });
})();
