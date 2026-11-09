'use strict';
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fa = (n) => Number(n).toLocaleString('fa-IR');
  const GB = 1024 ** 3;
  function fmt(b) {
    if (!b) return '۰';
    const u = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت', 'ترابایت'];
    let i = 0, v = b;
    while (v >= 1024 && i < 4) { v /= 1024; i++; }
    return v.toLocaleString('fa-IR', { maximumFractionDigits: i >= 3 ? 2 : 0 }) + ' ' + u[i];
  }
  const dateFa = (ms) => (ms ? new Date(ms).toLocaleDateString('fa-IR-u-ca-persian') : 'نامحدود');
  const daysLeft = (ms) => (ms ? Math.ceil((ms - Date.now()) / 86400000) : null);
  const STATUS = {
    active: 'فعال', disabled: 'غیرفعال', expired: 'منقضی', limited: 'اتمام حجم',
    nat_limited: 'اتمام حجم نت ملی', intl_limited: 'اتمام حجم بین‌الملل',
  };

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 2200);
  }
  async function api(path, opt = {}) {
    const r = await fetch('/api' + path, {
      method: opt.method || 'GET',
      headers: opt.body ? { 'content-type': 'application/json' } : {},
      body: opt.body ? JSON.stringify(opt.body) : undefined,
      credentials: 'same-origin',
    });
    let d = null;
    try { d = await r.json(); } catch (_) { /* خالی */ }
    if (!r.ok) { const e = new Error((d && d.error) || 'خطا'); e.status = r.status; throw e; }
    return d;
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); } catch (_) {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      document.execCommand('copy'); t.remove();
    }
    toast('کپی شد');
  }

  /* ------------------------------ حجم‌ها ------------------------------ */
  function meter(kind, d) {
    const cls = kind === 'national' ? 'nat' : 'intl';
    const pct = d.quota ? Math.min(100, (d.used / d.quota) * 100) : 0;
    return `<div class="cell">
      <div class="bar ${cls} ${pct >= 100 ? 'full' : ''}"><i style="width:${d.quota ? pct : 0}%"></i></div>
      <small>${fmt(d.used)} / ${d.quota ? fmt(d.quota) : 'نامحدود'}</small></div>`;
  }

  /* ------------------------------ صفحه عمومی ------------------------------ */
  async function publicPage(token) {
    const app = $('#app');
    try {
      const u = await api('/public/' + encodeURIComponent(token));
      const dl = daysLeft(u.expireAt);
      app.innerHTML = `<div class="wrap" style="max-width:520px">
        <div class="brand">Ar<span>ses</span></div>
        <div class="card mt">
          <div class="row sp"><b>${esc(u.name)}</b><span class="badge ${u.status}">${STATUS[u.status]}</span></div>
          <p class="muted">انقضا: ${dateFa(u.expireAt)}${dl !== null ? ` (${dl > 0 ? fa(dl) + ' روز مانده' : 'تمام شده'})` : ''}</p>
          <label>🇮🇷 نت ملی</label>${meter('national', u.national)}
          <label class="mt">🌐 نت بین‌الملل</label>${meter('international', u.international)}
        </div></div>`;
    } catch (e) {
      app.innerHTML = `<div class="wrap"><div class="card login"><p class="err">${esc(e.message)}</p></div></div>`;
    }
  }

  /* ------------------------------ ورود ------------------------------ */
  function loginView() {
    $('#app').innerHTML = `<div class="login card">
      <div class="brand" style="text-align:center;margin-bottom:12px">Ar<span>ses</span> Panel</div>
      <form id="lf">
        <div class="fld"><label>نام کاربری</label><input name="username" autocomplete="username" required></div>
        <div class="fld"><label>رمز عبور</label><input name="password" type="password" autocomplete="current-password" required></div>
        <div class="err" id="le"></div>
        <button class="btn pri" style="width:100%">ورود</button>
      </form></div>`;
    $('#lf').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api('/login', { method: 'POST', body: { username: f.get('username'), password: f.get('password') } });
        start();
      } catch (er) { $('#le').textContent = er.message; }
    };
  }

  /* ------------------------------ وضعیت ------------------------------ */
  const S = { tab: 'dash', users: [], stats: null, settings: null, probes: { national: [], international: [] }, hist: {}, q: '' };

  async function loadAll() {
    [S.users, S.stats, S.settings] = await Promise.all([api('/users'), api('/stats'), api('/settings')]);
  }

  async function probeOne(t) {
    const c = new AbortController();
    const to = setTimeout(() => c.abort(), 5000);
    const s = performance.now();
    try {
      await fetch(t.url + (t.url.includes('?') ? '&' : '?') + '_=' + Date.now(), { mode: 'no-cors', cache: 'no-store', signal: c.signal });
      return { ...t, ok: true, ms: Math.round(performance.now() - s) };
    } catch (_) { return { ...t, ok: false, ms: null }; } finally { clearTimeout(to); }
  }
  async function runProbes() {
    if (!S.settings) return;
    const t = S.settings.targets;
    const [n, i] = await Promise.all([Promise.all(t.national.map(probeOne)), Promise.all(t.international.map(probeOne))]);
    S.probes = { national: n, international: i };
    for (const r of [...n, ...i]) {
      const h = S.hist[r.url] || (S.hist[r.url] = []);
      h.push(r.ok ? r.ms : null);
      if (h.length > 24) h.shift();
    }
    if (S.tab === 'dash' || S.tab === 'mon') renderTab();
  }
  function linkMode() {
    const p = S.probes;
    if (!p.national.length && !p.international.length) return { t: 'در حال بررسی…', c: '' };
    const n = p.national.some((x) => x.ok), i = p.international.some((x) => x.ok);
    if (n && i) return { t: 'اتصال کامل: نت ملی + بین‌الملل', c: 'ok' };
    if (n) return { t: 'فقط نت ملی فعال است (بین‌الملل قطع)', c: 'warn' };
    if (i) return { t: 'فقط بین‌الملل فعال است (نت ملی قطع)', c: 'warn' };
    return { t: 'اتصال قطع است', c: 'down' };
  }

  /* ------------------------------ نما ------------------------------ */
  function shell() {
    $('#app').innerHTML = `<div class="wrap">
      <div class="top">
        <div class="brand">Ar<span>ses</span> Panel</div>
        <div class="tabs">
          ${[['dash', 'داشبورد'], ['users', 'کاربران'], ['mon', 'مانیتورینگ'], ['set', 'تنظیمات']]
            .map(([k, l]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
          <button class="tab" data-act="logout">خروج</button>
        </div>
      </div><div id="content"></div></div>`;
    renderTab();
  }
  function renderTab() {
    document.querySelectorAll('.tab[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
    const el = $('#content');
    if (!el) return;
    el.innerHTML = { dash, users, mon, set }[S.tab]();
  }

  function probeRows(list) {
    if (!list.length) return '<p class="muted">در حال بررسی…</p>';
    return list.map((r) => {
      const h = S.hist[r.url] || [];
      const max = Math.max(1, ...h.filter(Boolean));
      return `<div class="row sp" style="padding:5px 0;border-top:1px solid var(--line)">
        <span><span class="dot ${r.ok ? 'ok' : 'down'}"></span>${esc(r.name)}</span>
        <span class="row"><span class="spark">${h.map((v) => (v === null ? '<i class="d"></i>' : `<i style="height:${Math.max(3, (v / max) * 18)}px"></i>`)).join('')}</span>
        <span class="muted mono" style="min-width:56px;text-align:left">${r.ok ? fa(r.ms) + ' ms' : 'قطع'}</span></span></div>`;
    }).join('');
  }

  function dash() {
    const s = S.stats, m = linkMode();
    const max = Math.max(1, ...s.days.flatMap((d) => [d.national, d.international]));
    return `
      <div class="card"><h3>وضعیت اتصال این دستگاه</h3>
        <div class="mode" style="color:var(--${m.c === 'ok' ? 'nat' : m.c === 'down' ? 'bad' : m.c === 'warn' ? 'warn' : 'muted'})">${m.t}</div></div>
      <div class="grid mt">
        <div class="card"><h3>کل کاربران</h3><div class="big">${fa(s.users)}</div></div>
        <div class="card"><h3>فعال</h3><div class="big" style="color:var(--nat)">${fa(s.active)}</div></div>
        <div class="card"><h3>منقضی / محدود / غیرفعال</h3><div class="big" style="color:var(--bad)">${fa(s.expired + s.limited + s.disabled)}</div></div>
        <div class="card"><h3>🇮🇷 مصرف کل نت ملی</h3><div class="big" style="color:var(--nat)">${fmt(s.national)}</div></div>
        <div class="card"><h3>🌐 مصرف کل بین‌الملل</h3><div class="big" style="color:var(--intl)">${fmt(s.international)}</div></div>
      </div>
      <div class="card mt"><h3>مصرف ۱۴ روز اخیر</h3>
        <div class="chart">${s.days.map((d) => `<div title="${d.date}">
          <i class="i" style="height:${(d.international / max) * 100}%"></i><i class="n" style="height:${(d.national / max) * 100}%"></i></div>`).join('')}</div>
        <div class="legend muted mt"><span><i class="sw" style="background:var(--nat)"></i>نت ملی</span><span><i class="sw" style="background:var(--intl)"></i>بین‌الملل</span></div>
      </div>`;
  }

  function users() {
    const q = S.q.trim().toLowerCase();
    const list = S.users.filter((u) => !q || u.name.toLowerCase().includes(q) || (u.note || '').toLowerCase().includes(q));
    return `<div class="row sp"><input id="q" placeholder="جستجو…" value="${esc(S.q)}" style="max-width:260px">
      <button class="btn pri" data-act="new">+ کاربر جدید</button></div>
      <div class="card mt tblwrap"><table class="tbl"><thead><tr>
        <th>کاربر</th><th>وضعیت</th><th>🇮🇷 نت ملی</th><th>🌐 بین‌الملل</th><th>انقضا</th><th></th></tr></thead><tbody>
        ${list.map((u) => { const dl = daysLeft(u.expireAt); return `<tr>
          <td><b>${esc(u.name)}</b><div class="muted">${esc(u.note)}</div></td>
          <td><span class="badge ${u.status}">${STATUS[u.status]}</span></td>
          <td>${meter('national', u.national)}</td><td>${meter('international', u.international)}</td>
          <td>${dateFa(u.expireAt)}${dl !== null ? `<div class="muted">${dl > 0 ? fa(dl) + ' روز' : 'تمام'}</div>` : ''}</td>
          <td class="row" style="flex-wrap:nowrap">
            <button class="btn sm" data-act="link" data-id="${u.id}">لینک</button>
            <button class="btn sm" data-act="edit" data-id="${u.id}">ویرایش</button>
            <button class="btn sm" data-act="reset" data-id="${u.id}">صفر</button>
            <button class="btn sm bad" data-act="del" data-id="${u.id}">حذف</button></td></tr>`; }).join('')
          || '<tr><td colspan="6" class="muted">کاربری وجود ندارد.</td></tr>'}
      </tbody></table></div>`;
  }

  function mon() {
    const m = linkMode();
    return `<div class="card"><div class="row sp"><div class="mode">${m.t}</div>
      <button class="btn" data-act="probe">بررسی مجدد</button></div>
      <p class="muted">بررسی از داخل مرورگر شما انجام می‌شود (هر ۱۵ ثانیه)، پس وضعیت واقعی اینترنت همین دستگاه را نشان می‌دهد.</p></div>
      <div class="grid mt" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
        <div class="card"><h3>🇮🇷 نت ملی</h3>${probeRows(S.probes.national)}</div>
        <div class="card"><h3>🌐 نت بین‌الملل</h3>${probeRows(S.probes.international)}</div></div>`;
  }

  function set() {
    const t = S.settings.targets;
    const toTxt = (a) => a.map((x) => `${x.name} | ${x.url}`).join('\n');
    const origin = location.origin;
    return `<div class="card"><h3>هدف‌های مانیتورینگ (هر خط: نام | آدرس)</h3>
        <div class="f2"><div><label>🇮🇷 نت ملی</label><textarea id="tn" rows="6" dir="ltr">${esc(toTxt(t.national))}</textarea></div>
        <div><label>🌐 بین‌الملل</label><textarea id="ti" rows="6" dir="ltr">${esc(toTxt(t.international))}</textarea></div></div>
        <button class="btn pri mt" data-act="savetargets">ذخیره</button></div>
      <div class="card mt"><h3>API ثبت مصرف (برای سرویس/ایجنت شما)</h3>
        <label>API Key</label><div class="row"><input readonly value="${esc(S.settings.apiKey)}" dir="ltr" id="ak"><button class="btn" data-act="copykey">کپی</button></div>
        <p class="muted">مصرف نت ملی و بین‌الملل را (به بایت) جدا گزارش کنید. مقدارها به مصرف فعلی اضافه می‌شوند:</p>
<pre>curl -X POST ${esc(origin)}/api/agent/report \\
  -H "x-api-key: YOUR_API_KEY" -H "content-type: application/json" \\
  -d '{"user":"ali","national":10485760,"international":52428800}'

# ثبت چند کاربر در یک درخواست:  {"items":[{"user":"ali",...},{"token":"...",...}]}
# لیست کاربران و وضعیت (برای قطع/وصل کردن):
curl ${esc(origin)}/api/agent/users -H "x-api-key: YOUR_API_KEY"</pre></div>`;
  }

  /* ------------------------------ فرم کاربر ------------------------------ */
  function userModal(u) {
    const dl = u ? daysLeft(u.expireAt) : 30;
    const el = document.createElement('div');
    el.className = 'modalbg';
    el.innerHTML = `<form class="modal">
      <h3 style="margin-top:0">${u ? 'ویرایش کاربر' : 'کاربر جدید'}</h3>
      <div class="fld"><label>نام</label><input name="name" required maxlength="64" value="${esc(u ? u.name : '')}"></div>
      <div class="fld"><label>توضیح</label><input name="note" maxlength="300" value="${esc(u ? u.note : '')}"></div>
      <div class="f2">
        <div class="fld"><label>🇮🇷 حجم نت ملی (گیگابایت، ۰ = نامحدود)</label><input name="nq" type="number" min="0" step="any" value="${u ? +(u.national.quota / GB).toFixed(3) : 0}"></div>
        <div class="fld"><label>🌐 حجم بین‌الملل (گیگابایت، ۰ = نامحدود)</label><input name="iq" type="number" min="0" step="any" value="${u ? +(u.international.quota / GB).toFixed(3) : 10}"></div>
        ${u ? `<div class="fld"><label>مصرف نت ملی (گیگابایت)</label><input name="nu" type="number" min="0" step="any" value="${+(u.national.used / GB).toFixed(3)}"></div>
        <div class="fld"><label>مصرف بین‌الملل (گیگابایت)</label><input name="iu" type="number" min="0" step="any" value="${+(u.international.used / GB).toFixed(3)}"></div>` : ''}
        <div class="fld"><label>انقضا (روز از امروز؛ خالی = نامحدود)</label><input name="days" type="number" min="0" value="${dl !== null ? Math.max(0, dl) : ''}"></div>
        <div class="fld"><label>&nbsp;</label><label style="color:var(--text);font-size:14px"><input type="checkbox" name="en" ${!u || u.enabled ? 'checked' : ''}> فعال</label></div>
      </div>
      <div class="err" id="me"></div>
      <div class="row sp"><button class="btn pri">ذخیره</button><button type="button" class="btn" data-close>انصراف</button></div></form>`;
    document.body.appendChild(el);
    el.onclick = (e) => { if (e.target === el || e.target.hasAttribute('data-close')) el.remove(); };
    $('form', el).onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const body = {
        name: f.get('name'), note: f.get('note'), enabled: f.get('en') === 'on',
        nationalQuotaGB: f.get('nq'), internationalQuotaGB: f.get('iq'),
        expireDays: f.get('days') === '' ? null : f.get('days'),
      };
      if (u) { body.nationalUsedGB = f.get('nu'); body.internationalUsedGB = f.get('iu'); }
      try {
        await api(u ? '/users/' + u.id : '/users', { method: u ? 'PUT' : 'POST', body });
        el.remove(); await refresh(); toast('ذخیره شد');
      } catch (er) { $('#me', el).textContent = er.message; }
    };
  }

  async function refresh() {
    [S.users, S.stats] = await Promise.all([api('/users'), api('/stats')]);
    renderTab();
  }

  /* ------------------------------ رویدادها ------------------------------ */
  function parseTargets(txt) {
    return txt.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const i = l.indexOf('|');
      return i < 0 ? { name: l, url: l } : { name: l.slice(0, i).trim(), url: l.slice(i + 1).trim() };
    });
  }
  document.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { S.tab = tab.dataset.tab; renderTab(); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const u = S.users.find((x) => x.id === b.dataset.id);
    try {
      switch (b.dataset.act) {
        case 'logout': await api('/logout', { method: 'POST' }); location.reload(); break;
        case 'new': userModal(null); break;
        case 'edit': userModal(u); break;
        case 'link': copy(`${location.origin}/u/${u.token}`); break;
        case 'reset':
          if (confirm(`مصرف «${u.name}» صفر شود؟`)) { await api(`/users/${u.id}/reset`, { method: 'POST' }); await refresh(); toast('صفر شد'); }
          break;
        case 'del':
          if (confirm(`کاربر «${u.name}» حذف شود؟`)) { await api('/users/' + u.id, { method: 'DELETE' }); await refresh(); toast('حذف شد'); }
          break;
        case 'probe': runProbes(); break;
        case 'copykey': copy(S.settings.apiKey); break;
        case 'savetargets':
          S.settings = await api('/settings', { method: 'PUT', body: { targets: { national: parseTargets($('#tn').value), international: parseTargets($('#ti').value) } } });
          S.hist = {}; toast('ذخیره شد'); runProbes(); break;
      }
    } catch (er) { toast(er.message); }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'q') {
      S.q = e.target.value; const pos = e.target.selectionStart; renderTab();
      const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos);
    }
  });

  /* ------------------------------ شروع ------------------------------ */
  let timer = null;
  async function start() {
    try {
      await api('/me');
      await loadAll();
    } catch (e) { return loginView(); }
    shell();
    runProbes();
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) runProbes(); }, 15000);
  }

  const pm = /^\/u\/([a-f0-9]+)\/?$/.exec(location.pathname);
  if (pm) publicPage(pm[1]); else start();
})();
