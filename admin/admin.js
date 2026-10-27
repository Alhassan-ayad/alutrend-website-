'use strict';
/* Alutrend dashboard. All DOM is built with h() (no innerHTML), so stored text can never inject markup. */

/* ---------- tiny helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}
const clone = o => JSON.parse(JSON.stringify(o));
const url = p => '../' + encodeURI(p);                       // site-relative path -> URL from /admin/
const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB';

let toastTimer;
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

async function api(method, path, body, extra) {
  const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'dashboard' } };
  if (body !== undefined) {
    if (body instanceof Blob) { opts.body = body; Object.assign(opts.headers, extra || {}); }
    else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  }
  const res = await fetch('/api' + path, opts);
  let data = {}; try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && path !== '/login') { showLogin(); throw new Error('Signed out'); }
  if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
  return data;
}

/* ---------- state ---------- */
const S = {
  content: { images: {} }, saved: '', defaults: null, scan: null, library: null,
  page: 'all', q: '', replacedOnly: false, savedAt: null
};

// Content as it would be stored: team/footer only when they differ from the site's built-in defaults
function effective(c) {
  const out = { images: {} };
  for (const [k, v] of Object.entries(c.images || {})) if (v && v !== k) out.images[k] = v;
  if (c.team && JSON.stringify(c.team) !== JSON.stringify(S.defaults.team)) out.team = c.team;
  if (c.footer && JSON.stringify(c.footer) !== JSON.stringify(S.defaults.footer)) out.footer = c.footer;
  return out;
}
const isDirty = () => JSON.stringify(effective(S.content)) !== S.saved;
function touch() { $('#savebar').hidden = !isDirty(); }

function loadContent(c) {
  S.content = { images: Object.assign({}, c.images), team: c.team ? clone(c.team) : null, footer: c.footer ? clone(c.footer) : null };
  S.saved = JSON.stringify(effective(S.content));
  touch();
}

async function save() {
  const btn = $('#save'); btn.disabled = true;
  try {
    const r = await api('PUT', '/content', effective(S.content));
    loadContent(r.content); S.savedAt = new Date();
    toast('Saved - the website is updated'); render();
  } catch (e) { toast(e.message, true); } finally { btn.disabled = false; }
}

/* ---------- uploads + library ---------- */
async function prepareImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 800 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file), max = 2400;
    if (bmp.width <= max && file.size < 3 * 1048576) return file;
    const scale = Math.min(1, max / bmp.width);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const png = file.type === 'image/png';
    const blob = await new Promise(r => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.9));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, png ? '.png' : '.jpg'), { type: blob.type }) : file;
  } catch { return file; }
}

async function uploadFile(file) {
  if (!file) return null;
  if (!/^image\//.test(file.type)) { toast('Please choose an image file', true); return null; }
  const prepared = await prepareImage(file);
  toast('Uploading ' + file.name + '...');
  try {
    const r = await api('POST', '/upload', prepared, { 'X-Filename': encodeURIComponent(prepared.name), 'Content-Type': 'application/octet-stream' });
    S.library = null; return r.path;
  } catch (e) { toast(e.message, true); return null; }
}

function pickFile(cb) {
  const inp = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  inp.addEventListener('change', async () => { const p = await uploadFile(inp.files[0]); inp.remove(); if (p) cb(p); });
  document.body.append(inp); inp.click();
}

async function ensureLibrary() { if (!S.library) S.library = await api('GET', '/library'); return S.library; }

function openLibrary(cb) {
  const root = $('#modal-root'); let tab = 'uploads', q = '';
  const close = () => { root.textContent = ''; document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const body = h('div', { class: 'body' });
  const tabs = h('div', { class: 'chips' });
  async function draw() {
    const lib = await ensureLibrary();
    tabs.textContent = '';
    for (const [id, label] of [['uploads', 'My uploads (' + lib.uploads.length + ')'], ['site', 'Site images (' + lib.site.length + ')']]) {
      tabs.append(h('button', { class: 'chip' + (tab === id ? ' on' : ''), onclick: () => { tab = id; draw(); } }, label));
    }
    const items = lib[tab].filter(i => i.path.toLowerCase().includes(q));
    body.textContent = '';
    body.append(items.length ? h('div', { class: 'lib-grid' }, items.map(i =>
      h('button', { class: 'lib-item', title: i.path, onclick: () => { close(); cb(i.path); } },
        h('div', { class: 't' }, h('img', { src: url(i.path), loading: 'lazy', alt: '' })),
        h('div', { class: 'n' }, i.path.split('/').slice(1).join('/')))
    )) : h('div', { class: 'empty' }, tab === 'uploads' ? 'Nothing uploaded yet - use "Upload new".' : 'No images match.'));
  }
  root.append(h('div', { class: 'modal-back', onclick: e => { if (e.target.classList.contains('modal-back')) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Choose an image' },
      h('header', null, h('h3', null, 'Choose an image'), tabs,
        h('input', { type: 'search', placeholder: 'Search...', style: 'max-width:180px', oninput: e => { q = e.target.value.toLowerCase(); draw(); } }),
        h('button', { class: 'btn primary sm', onclick: () => pickFile(p => { close(); cb(p); }) }, 'Upload new'),
        h('button', { class: 'btn sm', onclick: close }, 'Close')),
      body)));
  draw();
}

/* ---------- views ---------- */
const VIEWS = { overview: viewOverview, images: viewImages, team: viewTeam, footer: viewFooter, library: viewLibrary, settings: viewSettings };

function head(title, sub, ...actions) {
  return h('div', { class: 'page-head' }, h('div', null, h('h2', null, title), sub && h('p', null, sub)), h('span', { class: 'spacer' }), ...actions);
}

/* Overview */
function viewOverview() {
  const replaced = Object.keys(effective(S.content).images).length;
  const total = uniqueImages().length;
  const team = (S.content.team || S.defaults.team).members.length;
  const customFooter = !!effective(S.content).footer;
  const pages = [['Home', ''], ['About', 'about.html'], ['Services', 'services.html'], ['Portfolio', 'portfolio-2.html'], ['Contact', 'contact.html']];
  return h('div', null,
    head('Overview', 'Everything you change here is applied to all pages of the website.'),
    h('div', { class: 'grid stats' },
      stat(total, 'images found on the site'), stat(replaced, 'images replaced'),
      stat(team, 'team members'), stat(customFooter ? 'Custom' : 'Default', 'footer')),
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'card' }, h('h3', null, 'Quick actions'),
        h('div', { class: 'quick' },
          h('a', { class: 'btn', href: '#/images' }, 'Replace images'),
          h('a', { class: 'btn', href: '#/team' }, 'Edit team'),
          h('a', { class: 'btn', href: '#/footer' }, 'Edit footer'),
          h('a', { class: 'btn', href: '#/library' }, 'Media library'))),
      h('div', { class: 'card' }, h('h3', null, 'Preview pages'),
        h('div', { class: 'quick' }, pages.map(([l, f]) => h('a', { class: 'btn', href: '../' + f, target: '_blank', rel: 'noopener' }, l + ' ↗')))),
      h('div', { class: 'card' }, h('h3', null, 'How it works'),
        h('div', { class: 'stack muted' },
          h('div', null, '1. Change things in Images, Team or Footer.'),
          h('div', null, '2. Click "Save & publish" in the bar that appears at the top.'),
          h('div', null, '3. Refresh the website - changes show on every page. Originals are never overwritten, so "Reset" always brings them back.')))));
}
const stat = (v, l) => h('div', { class: 'card stat' }, h('b', null, String(v)), h('span', null, l));

/* Images */
function uniqueImages() {
  const map = new Map();
  for (const p of (S.scan ? S.scan.pages : [])) for (const it of p.items) {
    if (!map.has(it.src)) map.set(it.src, { src: it.src, missing: it.missing, usages: [] });
    const e = map.get(it.src); let u = e.usages.find(x => x.page === p.id && x.section === it.section);
    if (!u) e.usages.push(u = { page: p.id, label: p.label, section: it.section, count: 0 });
    u.count++;
  }
  return [...map.values()];
}

function viewImages() {
  const pages = S.scan.pages;
  const all = uniqueImages();
  const q = S.q.toLowerCase();
  const match = e => (!q || e.src.toLowerCase().includes(q) || e.usages.some(u => u.section.toLowerCase().includes(q))) &&
    (!S.replacedOnly || S.content.images[e.src]);

  const toolbar = h('div', { class: 'toolbar' },
    h('div', { class: 'chips' },
      h('button', { class: 'chip' + (S.page === 'all' ? ' on' : ''), onclick: () => { S.page = 'all'; render(); } }, 'All pages (' + all.length + ')'),
      pages.map(p => h('button', { class: 'chip' + (S.page === p.id ? ' on' : ''), onclick: () => { S.page = p.id; render(); } },
        p.label + ' (' + new Set(p.items.map(i => i.src)).size + ')'))),
    h('input', { type: 'search', placeholder: 'Search images or sections...', value: S.q, oninput: e => { S.q = e.target.value; clearTimeout(viewImages.t); viewImages.t = setTimeout(() => { render(); const i = $('.toolbar input'); i.focus(); i.setSelectionRange(99, 99); }, 250); } }),
    h('label', { class: 'row small', style: 'font-weight:500' }, h('input', { type: 'checkbox', checked: S.replacedOnly || null, onchange: e => { S.replacedOnly = e.target.checked; render(); } }), 'Replaced only'));

  let content;
  if (S.page === 'all') {
    const list = all.filter(match);
    content = list.length ? h('div', { class: 'cards' }, list.map(e => imageCard(e))) : h('div', { class: 'empty' }, 'No images match.');
  } else {
    const pg = pages.find(p => p.id === S.page);
    const bySection = new Map();
    for (const it of pg.items) {
      if (!bySection.has(it.section)) bySection.set(it.section, new Map());
      const m = bySection.get(it.section);
      if (!m.has(it.src)) m.set(it.src, { src: it.src, missing: it.missing, usages: [{ page: pg.id, label: pg.label, section: it.section, count: 0 }] });
      m.get(it.src).usages[0].count++;
    }
    content = h('div', null, [...bySection].map(([section, m]) => {
      const list = [...m.values()].filter(match);
      return list.length ? h('div', null, h('div', { class: 'section-title' }, section), h('div', { class: 'cards' }, list.map(e => imageCard(e)))) : null;
    }));
  }
  return h('div', null,
    head('Images', 'Every image on the website. Replace one and it changes everywhere it is used.'), toolbar, content);
}

function imageCard(e) {
  const repl = S.content.images[e.src];
  const dims = h('span', { class: 'muted small' }, '');
  const used = e.usages.map(u => u.label + (u.count > 1 ? ' ×' + u.count : '')).join(' · ');
  const img = h('img', { src: url(repl || e.src), alt: '', loading: 'lazy' });
  img.addEventListener('load', () => { dims.textContent = img.naturalWidth + ' × ' + img.naturalHeight + ' px'; });
  const setImg = p => { S.content.images[e.src] = p; touch(); render(); };
  return h('div', { class: 'img-card' + (repl ? ' replaced' : '') },
    h('div', { class: 'thumb' }, img,
      repl && h('span', { class: 'badge' }, 'Replaced'),
      e.missing && !repl && h('span', { class: 'badge warn' }, 'File missing'),
      repl && h('div', { class: 'orig', title: 'Original' }, h('img', { src: url(e.src), alt: '', style: 'max-width:100%;max-height:100%' }))),
    h('div', { class: 'img-meta' },
      h('code', null, e.src), dims,
      h('div', { class: 'small muted' }, 'Used on: ' + used),
      e.usages[0].section && S.page === 'all' && h('div', { class: 'small muted' }, 'Section: ' + [...new Set(e.usages.map(u => u.section))].join(', '))),
    h('div', { class: 'img-actions' },
      h('button', { class: 'btn primary sm', onclick: () => pickFile(setImg) }, 'Upload'),
      h('button', { class: 'btn sm', onclick: () => openLibrary(setImg) }, 'Library'),
      repl && h('button', { class: 'btn sm danger', onclick: () => { delete S.content.images[e.src]; touch(); render(); } }, 'Reset')));
}

/* Team */
function ensureTeam() {
  if (!S.content.team) S.content.team = clone(S.defaults.team);
  S.content.team.visible = S.content.team.visible === true;
  return S.content.team;
}

function viewTeam() {
  const t = ensureTeam();
  const swap = (i, d) => { const j = i + d; if (j < 0 || j >= t.members.length) return; [t.members[i], t.members[j]] = [t.members[j], t.members[i]]; touch(); render(); };
  const field = (label, get, set, type = 'text', ph) => h('label', null, label,
    h('input', { type, value: get(), placeholder: ph || '', oninput: e => { set(e.target.value); touch(); } }));

  const cards = t.members.map((m, i) => {
    const photo = h('img', { src: url(m.image), alt: '' });
    return h('div', { class: 'card member' },
      h('div', { class: 'photo' }, photo),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', onclick: () => pickFile(p => { m.image = p; touch(); render(); }) }, 'Upload photo'),
        h('button', { class: 'btn sm', onclick: () => openLibrary(p => { m.image = p; touch(); render(); }) }, 'Library')),
      field('Name', () => m.name, v => { m.name = v; }),
      field('Role', () => m.role, v => { m.role = v; }),
      h('details', { open: Object.keys(m.socials || {}).length ? true : null }, h('summary', null, 'Social links (optional)'),
        h('div', { class: 'stack' }, ['linkedin', 'twitter', 'facebook', 'instagram'].map(k =>
          field(k[0].toUpperCase() + k.slice(1), () => (m.socials && m.socials[k]) || '', v => { m.socials = m.socials || {}; if (v) m.socials[k] = v; else delete m.socials[k]; }, 'url', 'https://...')))),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', disabled: i === 0 || null, onclick: () => swap(i, -1), title: 'Move earlier' }, '←'),
        h('button', { class: 'btn sm', disabled: i === t.members.length - 1 || null, onclick: () => swap(i, 1), title: 'Move later' }, '→'),
        h('span', { class: 'spacer', style: 'flex:1' }),
        h('button', { class: 'btn sm danger', onclick: () => { t.members.splice(i, 1); touch(); render(); } }, 'Remove')));
  });

  return h('div', null,
    head('Team', 'Shown in the "Meet the Team" carousel on the About page.',
      h('button', { class: 'btn', onclick: () => { S.content.team = clone(S.defaults.team); touch(); render(); } }, 'Reset to original'),
      h('button', { class: 'btn primary', onclick: () => { t.members.push({ name: 'New member', role: 'Role', image: 'images/resource/team-7.png', socials: {} }); touch(); render(); } }, '+ Add member')),
    h('div', { class: 'card stack', style: 'margin-bottom:16px;max-width:520px' },
      h('label', { class: 'row', style: 'font-size:14px;cursor:pointer' },
        h('input', { type: 'checkbox', checked: t.visible || null, style: 'width:18px;height:18px;margin:0', onchange: e => { t.visible = e.target.checked; touch(); render(); } }),
        'Show the team section on the About page'),
      h('div', { class: 'small', style: 'color:' + (t.visible ? 'var(--ok)' : 'var(--danger)') },
        t.visible ? 'The team section is visible to visitors.' : 'The team section is hidden. You can still edit members below, then switch it on when ready.'),
      field('Section heading', () => t.heading, v => { t.heading = v; })),
    t.members.length ? h('div', { class: 'team-grid' }, cards) : h('div', { class: 'empty' }, 'No team members. Add one to show the section.'));
}

/* Footer */
const PRESET_ICONS = [
  ['WhatsApp', 'images/main-slider/whatsapp.png'], ['TikTok', 'images/main-slider/tiktok.png'],
  ['Facebook', 'images/resource/facebook.svg'], ['Instagram', 'images/resource/instagram.svg'],
  ['LinkedIn', 'images/resource/linkedin.svg'], ['Twitter / X', 'images/resource/twitter.svg']
];
function ensureFooter() { if (!S.content.footer) S.content.footer = clone(S.defaults.footer); return S.content.footer; }

function viewFooter() {
  const f = ensureFooter();
  const preview = h('div', { class: 'preview' });
  const drawPreview = () => {
    const li = arr => h('ul', null, arr.filter(Boolean).map(x => h('li', null, x)));
    preview.textContent = '';
    preview.append(
      h('div', null, h('h4', null, f.contactTitle), li([...f.phones.map(p => 'Contact: ' + p), f.email && 'Email: ' + f.email])),
      h('div', null, h('h4', null, f.hoursTitle), li(f.hours)),
      h('div', { class: 'soc' }, f.socials.map(s => h('img', { src: url(s.icon), alt: s.label, title: s.label }))),
      h('div', null, h('h4', null, f.branchTitle), li([f.address, f.branchPhone && 'Contact: ' + f.branchPhone, f.branchEmail && 'Email: ' + f.branchEmail])),
      h('div', { class: 'copy' }, f.copyright));
  };
  const text = (label, key, ph) => h('label', null, label, h('input', { type: 'text', value: f[key] || '', placeholder: ph || '', oninput: e => { f[key] = e.target.value; touch(); drawPreview(); } }));

  const listEditor = (label, key, ph) => {
    const wrap = h('div', { class: 'stack' });
    const draw = () => {
      wrap.textContent = '';
      wrap.append(h('div', { class: 'small', style: 'font-weight:600' }, label));
      f[key].forEach((v, i) => wrap.append(h('div', { class: 'list-item' },
        h('input', { type: 'text', value: v, placeholder: ph, 'aria-label': label + ' ' + (i + 1), oninput: e => { f[key][i] = e.target.value; touch(); drawPreview(); } }),
        h('button', { class: 'btn sm danger', title: 'Remove', onclick: () => { f[key].splice(i, 1); touch(); draw(); drawPreview(); } }, '×'))));
      wrap.append(h('div', null, h('button', { class: 'btn sm', onclick: () => { f[key].push(''); touch(); draw(); } }, '+ Add')));
    };
    draw(); return wrap;
  };

  const socialsWrap = h('div', { class: 'stack' });
  const drawSocials = () => {
    socialsWrap.textContent = '';
    f.socials.forEach((s, i) => {
      const isPreset = PRESET_ICONS.some(p => p[1] === s.icon);
      socialsWrap.append(h('div', { class: 'soc-item' },
        h('div', { class: 'ico' }, h('img', { src: url(s.icon), alt: '' })),
        h('div', { class: 'fields' },
          h('input', { type: 'text', value: s.label, placeholder: 'Name (e.g. Instagram)', 'aria-label': 'Name', oninput: e => { s.label = e.target.value; touch(); drawPreview(); } }),
          h('select', { 'aria-label': 'Icon', onchange: e => {
            if (e.target.value === '__upload') { pickFile(p => { s.icon = p; touch(); drawSocials(); drawPreview(); }); drawSocials(); }
            else { s.icon = e.target.value; touch(); drawSocials(); drawPreview(); }
          } },
            PRESET_ICONS.map(p => h('option', { value: p[1], selected: p[1] === s.icon || null }, p[0])),
            !isPreset && h('option', { value: s.icon, selected: true }, 'Custom icon'),
            h('option', { value: '__upload' }, 'Upload custom icon...')),
          h('input', { class: 'wide', type: 'url', value: s.url, placeholder: 'https://...', 'aria-label': 'Link', oninput: e => { s.url = e.target.value; touch(); } })),
        h('div', { class: 'stack' },
          h('button', { class: 'btn sm', disabled: i === 0 || null, title: 'Move up', onclick: () => { [f.socials[i - 1], f.socials[i]] = [f.socials[i], f.socials[i - 1]]; touch(); drawSocials(); drawPreview(); } }, '↑'),
          h('button', { class: 'btn sm danger', title: 'Remove', onclick: () => { f.socials.splice(i, 1); touch(); drawSocials(); drawPreview(); } }, '×'))));
    });
    socialsWrap.append(h('div', null, h('button', { class: 'btn sm', onclick: () => { f.socials.push({ label: 'Facebook', icon: 'images/resource/facebook.svg', url: '' }); touch(); drawSocials(); drawPreview(); } }, '+ Add social link')));
  };
  drawSocials(); drawPreview();

  return h('div', null,
    head('Footer', 'One footer, shared by every page.', h('button', { class: 'btn', onclick: () => { S.content.footer = clone(S.defaults.footer); touch(); render(); } }, 'Reset to original')),
    h('div', { class: 'footer-layout' },
      h('div', { class: 'stack' },
        h('div', { class: 'card stack' }, h('h3', null, 'Contact column'), text('Title', 'contactTitle'), listEditor('Phone numbers', 'phones', '+20 ...'), text('Email', 'email', 'name@example.com')),
        h('div', { class: 'card stack' }, h('h3', null, 'Working hours'), text('Title', 'hoursTitle'), listEditor('Lines', 'hours', 'Saturday-Thursday: 8 AM - 11 PM')),
        h('div', { class: 'card stack' }, h('h3', null, 'Social icons'), socialsWrap),
        h('div', { class: 'card stack' }, h('h3', null, 'Branch / address'), text('Title', 'branchTitle'), text('Address', 'address'), text('Phone', 'branchPhone'), text('Email', 'branchEmail')),
        h('div', { class: 'card stack' }, h('h3', null, 'Copyright line'), text('Text', 'copyright'))),
      h('div', null, h('div', { class: 'small muted', style: 'margin-bottom:8px' }, 'Live preview'), preview)));
}

/* Media library */
function viewLibrary() {
  const wrap = h('div', null);
  const used = new Set(Object.values(effective(S.content).images));
  ensureLibrary().then(lib => {
    const grid = h('div', { class: 'lib-grid' }, lib.uploads.map(i => {
      const inUse = used.has(i.path);
      return h('div', { class: 'card', style: 'padding:10px;display:grid;gap:8px' },
        h('div', { class: 't', style: 'height:110px;display:grid;place-items:center;background:#e9ebf0;border-radius:8px' }, h('img', { src: url(i.path), alt: '', style: 'max-width:100%;max-height:100%', loading: 'lazy' })),
        h('div', { class: 'small muted', style: 'word-break:break-all' }, i.path.replace('uploads/', ''), ' · ', fmtSize(i.size)),
        h('button', { class: 'btn sm danger', disabled: inUse || null, title: inUse ? 'In use - reset the image first' : '', onclick: async () => {
          try { await api('DELETE', '/upload?name=' + encodeURIComponent(i.path.replace('uploads/', ''))); S.library = null; render(); toast('Deleted'); } catch (e) { toast(e.message, true); }
        } }, inUse ? 'In use' : 'Delete'));
    }));
    wrap.append(lib.uploads.length ? grid : h('div', { class: 'empty' }, 'No uploads yet. Replace an image or upload one here.'));
  }).catch(e => wrap.append(h('div', { class: 'empty' }, e.message)));
  return h('div', null,
    head('Media library', 'Images you have uploaded. Unused ones can be deleted.',
      h('button', { class: 'btn primary', onclick: () => pickFile(() => { toast('Uploaded'); render(); }) }, 'Upload image')), wrap);
}

/* Settings */
function viewSettings() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' }), nw = h('input', { type: 'password', autocomplete: 'new-password' });
  const backups = h('div', { class: 'stack' }, h('span', { class: 'muted' }, 'Loading...'));
  api('GET', '/backups').then(r => {
    backups.textContent = '';
    if (!r.backups.length) backups.append(h('span', { class: 'muted' }, 'No backups yet - one is created every time you save.'));
    r.backups.slice(0, 10).forEach(b => {
      const when = b.replace(/^content-/, '').replace(/\.json$/, '').replace(/T(\d\d)-(\d\d)-(\d\d).*/, ' $1:$2:$3');
      backups.append(h('div', { class: 'list-item' }, h('span', { style: 'flex:1' }, when),
        h('button', { class: 'btn sm', onclick: async () => {
          try { const x = await api('POST', '/restore', { name: b }); loadContent(x.content); toast('Backup restored'); render(); } catch (e) { toast(e.message, true); }
        } }, 'Restore')));
    });
  }).catch(() => {});

  const importInp = h('input', { type: 'file', accept: 'application/json', style: 'display:none', onchange: async e => {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      loadContent({ images: data.images || {}, team: data.team, footer: data.footer });
      S.saved = ''; touch(); render(); toast('Imported - review and click "Save & publish"');
    } catch { toast('That file is not valid', true); }
  } });

  return h('div', null,
    head('Settings'),
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'card stack' }, h('h3', null, 'Change password'),
        h('label', null, 'Current password', cur), h('label', null, 'New password (6+ characters)', nw),
        h('div', null, h('button', { class: 'btn primary', onclick: async () => {
          try { await api('POST', '/password', { current: cur.value, next: nw.value }); cur.value = nw.value = ''; toast('Password changed'); } catch (e) { toast(e.message, true); }
        } }, 'Update password'))),
      h('div', { class: 'card stack' }, h('h3', null, 'Backups'), backups),
      h('div', { class: 'card stack' }, h('h3', null, 'Export / import'),
        h('div', { class: 'muted' }, 'Download your customizations as a file, or load one back in.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => {
            const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(effective(S.content), null, 2)], { type: 'application/json' })), download: 'alutrend-content.json' });
            document.body.append(a); a.click(); a.remove();
          } }, 'Export'),
          h('button', { class: 'btn', onclick: () => importInp.click() }, 'Import'), importInp)),
      h('div', { class: 'card stack' }, h('h3', null, 'Reset everything'),
        h('div', { class: 'muted' }, 'Clears all replaced images, team and footer edits (a backup is kept). Uploaded files stay in the media library.'),
        h('div', null, h('button', { class: 'btn danger', onclick: () => {
          S.content = { images: {}, team: null, footer: null }; touch(); render(); toast('Cleared - click "Save & publish" to apply, or "Discard" to undo');
        } }, 'Reset all customizations')))));
}

/* ---------- routing ---------- */
function render() {
  const name = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'overview';
  const view = VIEWS[name] ? name : 'overview';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  const root = $('#view'); const y = window.scrollY;
  root.textContent = ''; root.append(VIEWS[view]());
  window.scrollTo(0, y);
}
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });

function showLogin() { $('#app').hidden = true; $('#login').hidden = false; $('#login-pw').focus(); }

async function init() {
  const [content, defaults, scan] = await Promise.all([api('GET', '/content'), api('GET', '/defaults'), api('GET', '/scan')]);
  S.defaults = defaults; S.scan = scan; loadContent(content);
  $('#login').hidden = true; $('#app').hidden = false; render();
}

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault(); $('#login-error').textContent = '';
  try { await api('POST', '/login', { password: $('#login-pw').value }); $('#login-pw').value = ''; await init(); }
  catch (err) { $('#login-error').textContent = err.message; }
});
$('#logout').addEventListener('click', async () => { try { await api('POST', '/logout', {}); } catch { /* ignore */ } location.reload(); });
$('#save').addEventListener('click', save);
$('#discard').addEventListener('click', () => { loadContent(JSON.parse(S.saved)); render(); toast('Changes discarded'); });
window.addEventListener('beforeunload', e => { if (S.defaults && isDirty()) { e.preventDefault(); e.returnValue = ''; } });

(async () => {
  try { const s = await api('GET', '/session'); if (s.authenticated) await init(); else showLogin(); }
  catch { showLogin(); }
})();
