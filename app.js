/* Personal bookmark dashboard.
 *
 * Source of truth: a private GitHub gist holding one file, GIST_FILE.
 * The gist id is never hard-coded — it is found by filename through the
 * authenticated /gists listing, so nothing in this public repo points at
 * your data. The token lives only in this browser's localStorage.
 */
(() => {
  'use strict';

  const GIST_FILE = 'personal-bookmarks.json';
  const GIST_DESC = 'Personal bookmark dashboard — data file. Do not rename the file.';
  const API = 'https://api.github.com';
  const K_TOKEN = 'pb:token';
  const K_GIST = 'pb:gist';
  const K_CACHE = 'pb:cache';
  const K_THEME = 'pb:theme';

  const $ = (s, r = document) => r.querySelector(s);
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
    del: k => { try { localStorage.removeItem(k); } catch {} },
  };

  let token = ls.get(K_TOKEN) || '';
  let gistId = ls.get(K_GIST) || '';
  let data = { version: 1, categories: [], bookmarks: [] };
  let query = '';
  let cursor = -1;          // index into the currently rendered card list
  let cards = [];
  let saveTimer = null;
  let editingId = null;

  /* -------------------------------------------------------------- helpers */

  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const uid = p =>
    p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

  // Only absolute web URLs have a host worth showing; the bundled /tools/
  // pages are relative and get a letter badge instead.
  function host(url) {
    if (!/^https?:\/\//i.test(url)) return '';
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return ''; }
  }

  function normalizeUrl(u) {
    u = u.trim();
    if (!u) return '';
    if (/^(https?:)?\/\//i.test(u) || /^[a-z]+:/i.test(u) || u.startsWith('tools/')) return u;
    return 'https://' + u;
  }

  function hue(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }
  const dotColor = s => `hsl(${hue(s)} 62% 55%)`;

  function slug(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid('c');
  }

  const catById = id => data.categories.find(c => c.id === id);
  const countIn = id => data.bookmarks.filter(b => b.cat === id).length;

  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('bad', !!bad);
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }

  function sync(state) {
    const el = $('#sync');
    el.dataset.state = state || '';
    el.title = { busy: 'Saving…', error: 'Save failed', '': 'Saved' }[state || ''];
  }

  /* -------------------------------------------------------------- gist api */

  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...opts.headers,
      },
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch {}
      const err = new Error(detail || `GitHub API ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  // Find the data gist by filename, or create it on first run.
  async function findGist() {
    for (let page = 1; page <= 4; page++) {
      const list = await api(`/gists?per_page=100&page=${page}`);
      const hit = list.find(g => g.files && g.files[GIST_FILE]);
      if (hit) return hit.id;
      if (list.length < 100) break;
    }
    const made = await api('/gists', {
      method: 'POST',
      body: JSON.stringify({
        description: GIST_DESC,
        public: false,
        files: { [GIST_FILE]: { content: JSON.stringify(blank(), null, 2) } },
      }),
    });
    return made.id;
  }

  const blank = () => ({
    version: 1,
    categories: [{ id: 'general', name: 'General', desc: '' }],
    bookmarks: [],
  });

  async function pull() {
    if (!gistId) {
      gistId = await findGist();
      ls.set(K_GIST, gistId);
    }
    const g = await api('/gists/' + gistId);
    const file = g.files && g.files[GIST_FILE];
    if (!file) throw new Error(`Gist ${gistId} has no ${GIST_FILE}`);
    const text = file.truncated ? await (await fetch(file.raw_url)).text() : file.content;
    return normalize(JSON.parse(text));
  }

  async function push() {
    data.updated = new Date().toISOString();
    await api('/gists/' + gistId, {
      method: 'PATCH',
      body: JSON.stringify({
        files: { [GIST_FILE]: { content: JSON.stringify(data, null, 2) } },
      }),
    });
  }

  function normalize(d) {
    const out = {
      version: 1,
      updated: d.updated || '',
      categories: Array.isArray(d.categories) ? d.categories : [],
      bookmarks: Array.isArray(d.bookmarks) ? d.bookmarks : [],
    };
    out.categories = out.categories
      .filter(c => c && c.name)
      .map(c => ({ id: String(c.id || slug(c.name)), name: String(c.name), desc: String(c.desc || '') }));
    if (!out.categories.length) out.categories = blank().categories;
    const ids = new Set(out.categories.map(c => c.id));
    const fallback = out.categories[0].id;
    out.bookmarks = out.bookmarks
      .filter(b => b && b.url)
      .map(b => ({
        id: String(b.id || uid('b')),
        title: String(b.title || host(b.url) || b.url),
        url: String(b.url),
        desc: String(b.desc || ''),
        cat: ids.has(b.cat) ? b.cat : fallback,
        group: String(b.group || ''),
      }));
    return out;
  }

  // Optimistic save: UI updates now, gist catches up, cache covers reloads.
  function save(msg) {
    ls.set(K_CACHE, JSON.stringify(data));
    sync('busy');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await push();
        sync('');
        if (msg) toast(msg);
      } catch (e) {
        sync('error');
        toast('Not saved: ' + e.message, true);
      }
    }, 400);
  }

  /* -------------------------------------------------------------- search */

  // Cached outside `data` so nothing derived is ever written to the gist.
  const hay = new Map();
  const dropHay = () => hay.clear();

  function haystack(b) {
    let s = hay.get(b.id);
    if (s === undefined) {
      const c = catById(b.cat);
      s = [b.title, b.url, host(b.url), b.desc, c ? c.name : '', b.group]
        .join(' ').toLowerCase();
      hay.set(b.id, s);
    }
    return s;
  }

  function search(q) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return null;
    const hits = [];
    for (const b of data.bookmarks) {
      const text = haystack(b);
      if (!terms.every(t => text.includes(t))) continue;
      const title = b.title.toLowerCase();
      const h = host(b.url);
      let score = 0;
      for (const t of terms) {
        if (title.startsWith(t)) score += 100;
        else if (title.includes(t)) score += 60;
        else if (h.includes(t)) score += 40;
        else score += 10;
      }
      hits.push({ b, score });
    }
    hits.sort((x, y) => y.score - x.score || x.b.title.localeCompare(y.b.title));
    return hits.map(h => h.b);
  }

  function highlight(text, terms) {
    let out = esc(text);
    for (const t of terms) {
      if (!t) continue;
      const re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      out = out.replace(re, '<mark>$1</mark>');
    }
    return out;
  }

  /* -------------------------------------------------------------- render */

  function cardHtml(b, terms) {
    const h = host(b.url);
    const sub = b.desc || h || 'local';
    const external = /^https?:/i.test(b.url);
    const letter = esc((b.title.trim()[0] || '?').toUpperCase());
    const icon = h
      ? `<img class="fav" alt="" loading="lazy" data-letter="${letter}"
             data-tint="${dotColor(b.title)}"
             src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(h)}&sz=64">`
      : `<span class="badge" style="background:${dotColor(b.title)}">${letter}</span>`;
    return `<a class="card" href="${esc(b.url)}" data-id="${b.id}"
       ${external ? 'target="_blank" rel="noopener noreferrer"' : ''}>
      ${icon}
      <span class="tx">
        <span class="t">${terms ? highlight(b.title, terms) : esc(b.title)}</span>
        <span class="d">${terms ? highlight(sub, terms) : esc(sub)}</span>
      </span>
      <button class="edit" type="button" data-edit="${b.id}" title="Edit" aria-label="Edit ${esc(b.title)}">
        <svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z"/></svg>
      </button>
    </a>`;
  }

  function render() {
    const main = $('#main');
    const results = search(query);

    if (results) {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      main.innerHTML = results.length
        ? `<section class="section">
             <div class="sec-head"><h2>Results</h2><span class="n">${results.length}</span></div>
             <p class="sec-desc">Enter opens the highlighted result · Esc clears</p>
             <div class="grid">${results.map(b => cardHtml(b, terms)).join('')}</div>
           </section>`
        : `<div class="empty">
             <h3>No matches for “${esc(query)}”</h3>
             <p>Try fewer words — terms are combined with AND.</p>
             <button class="btn primary" type="button" id="add-from-empty">Add a bookmark</button>
           </div>`;
    } else {
      const parts = [];
      for (const c of data.categories) {
        const mine = data.bookmarks.filter(b => b.cat === c.id);
        if (!mine.length) continue;
        const groups = new Map();
        for (const b of mine) {
          const g = b.group || '';
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g).push(b);
        }
        const inner = [...groups.entries()].map(([g, items]) =>
          `<div class="group">
             ${g ? `<h3 class="group-head">${esc(g)}</h3>` : ''}
             <div class="grid">${items.map(b => cardHtml(b)).join('')}</div>
           </div>`).join('');
        parts.push(
          `<section class="section" id="c-${esc(c.id)}" data-cat="${esc(c.id)}">
             <div class="sec-head"><h2>${esc(c.name)}</h2><span class="n">${mine.length}</span></div>
             ${c.desc ? `<p class="sec-desc">${esc(c.desc)}</p>` : '<div style="height:8px"></div>'}
             ${inner}
           </section>`);
      }
      main.innerHTML = parts.length ? parts.join('') : `
        <div class="empty">
          <h3>No bookmarks yet</h3>
          <p>Add your first one to get started.</p>
          <button class="btn primary" type="button" id="add-from-empty">Add a bookmark</button>
        </div>`;
    }

    cards = [...main.querySelectorAll('.card')];
    cursor = -1;
    renderSidebar();
    observe();
  }

  function renderSidebar() {
    const nav = $('#sidebar');
    const total = data.bookmarks.length;
    const rows = data.categories
      .filter(c => countIn(c.id) > 0)
      .map(c => `<a class="side-link" href="#c-${esc(c.id)}" data-nav="${esc(c.id)}">
          <span class="dot" style="background:${dotColor(c.id)}"></span>
          <span class="nm">${esc(c.name)}</span>
          <span class="ct">${countIn(c.id)}</span>
        </a>`).join('');
    nav.innerHTML = `<p class="side-head">Categories</p>
      <a class="side-link" href="#top" data-nav="">
        <span class="dot" style="background:var(--text-3)"></span>
        <span class="nm">All bookmarks</span><span class="ct">${total}</span>
      </a>${rows}`;
  }

  let io;
  function observe() {
    if (io) io.disconnect();
    if (query) return;
    io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = e.target.dataset.cat;
        for (const a of $('#sidebar').querySelectorAll('.side-link'))
          a.classList.toggle('on', a.dataset.nav === id);
      }
    }, { rootMargin: '-72px 0px -72% 0px' });
    for (const s of $('#main').querySelectorAll('.section')) io.observe(s);
  }

  function moveCursor(step) {
    if (!cards.length) return;
    if (cursor >= 0) cards[cursor].classList.remove('sel');
    cursor = (cursor + step + cards.length + (cursor < 0 && step < 0 ? 1 : 0)) % cards.length;
    const el = cards[cursor];
    el.classList.add('sel');
    el.scrollIntoView({ block: 'nearest' });
  }

  /* -------------------------------------------------------------- editor */

  function fillCatSelect(selected) {
    $('#mark-cat').innerHTML = data.categories
      .map(c => `<option value="${esc(c.id)}"${c.id === selected ? ' selected' : ''}>${esc(c.name)}</option>`)
      .join('');
    const groups = [...new Set(data.bookmarks.map(b => b.group).filter(Boolean))].sort();
    $('#groups').innerHTML = groups.map(g => `<option value="${esc(g)}">`).join('');
  }

  function openEditor(id) {
    const dlg = $('#dlg-mark');
    // `form.elements` is used throughout: `form.title` would resolve to the
    // element's own title attribute, not the input named "title".
    const f = $('#form-mark').elements;
    editingId = id || null;
    const b = id ? data.bookmarks.find(x => x.id === id) : null;
    $('#mark-title').textContent = b ? 'Edit bookmark' : 'Add bookmark';
    $('#mark-delete').hidden = !b;
    fillCatSelect(b ? b.cat : data.categories[0] && data.categories[0].id);
    f.url.value = b ? b.url : '';
    f.title.value = b ? b.title : '';
    f.desc.value = b ? b.desc : '';
    f.group.value = b ? b.group : '';
    dlg.showModal();
    setTimeout(() => (b ? f.title : f.url).focus(), 30);
  }

  function submitEditor(e) {
    e.preventDefault();
    const f = $('#form-mark').elements;
    const url = normalizeUrl(f.url.value);
    if (!url) return;
    const fields = {
      url,
      title: f.title.value.trim() || host(url) || url,
      desc: f.desc.value.trim(),
      cat: f.cat.value,
      group: f.group.value.trim(),
    };
    if (editingId) Object.assign(data.bookmarks.find(x => x.id === editingId), fields);
    else data.bookmarks.push({ id: uid('b'), ...fields });
    dropHay();
    $('#dlg-mark').close();
    render();
    save(editingId ? 'Bookmark updated' : 'Bookmark added');
  }

  function confirmThen(title, text, okLabel, fn) {
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    const ok = $('#confirm-ok');
    ok.textContent = okLabel;
    const dlg = $('#dlg-confirm');
    const handler = () => { ok.removeEventListener('click', handler); dlg.close(); fn(); };
    ok.addEventListener('click', handler);
    dlg.addEventListener('close', () => ok.removeEventListener('click', handler), { once: true });
    dlg.showModal();
  }

  /* -------------------------------------------------------------- categories */

  function renderCats() {
    $('#catlist').innerHTML = data.categories.map(c =>
      `<li data-id="${esc(c.id)}">
         <span class="dot" style="background:${dotColor(c.id)}"></span>
         <input value="${esc(c.name)}" aria-label="Category name">
         <span class="ct">${countIn(c.id)}</span>
         <button class="rm" type="button" title="Delete category" aria-label="Delete ${esc(c.name)}">
           <svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>
         </button>
       </li>`).join('');
  }

  function wireCats() {
    const list = $('#catlist');

    list.addEventListener('change', e => {
      const input = e.target.closest('input');
      if (!input) return;
      const id = input.closest('li').dataset.id;
      const name = input.value.trim();
      const c = catById(id);
      if (!name || !c) { input.value = c ? c.name : ''; return; }
      c.name = name;
      dropHay();
      render();
      save('Category renamed');
    });

    list.addEventListener('click', e => {
      if (!e.target.closest('.rm')) return;
      const id = e.target.closest('li').dataset.id;
      const c = catById(id);
      const n = countIn(id);
      if (data.categories.length === 1) return toast('Keep at least one category', true);
      confirmThen(
        `Delete “${c.name}”?`,
        n ? `${n} bookmark${n > 1 ? 's' : ''} in this category will be deleted too. Export a backup first if unsure.`
          : 'This category is empty.',
        'Delete', () => {
          data.categories = data.categories.filter(x => x.id !== id);
          data.bookmarks = data.bookmarks.filter(b => b.cat !== id);
          dropHay();
          renderCats();
          render();
          save('Category deleted');
        });
    });

    $('#form-cat').addEventListener('submit', e => {
      e.preventDefault();
      const input = e.target.elements.name;
      const name = input.value.trim();
      if (!name) return;
      let id = slug(name);
      while (catById(id)) id = slug(name) + '-' + Math.random().toString(36).slice(2, 5);
      data.categories.push({ id, name, desc: '' });
      input.value = '';
      renderCats();
      render();
      save('Category added');
    });
  }

  /* -------------------------------------------------------------- backup */

  function exportBackup() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bookmarks-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Backup downloaded');
  }

  function importBackup(file) {
    const r = new FileReader();
    r.onload = () => {
      let parsed;
      try { parsed = normalize(JSON.parse(r.result)); }
      catch { return toast('That file is not valid JSON', true); }
      confirmThen('Replace all bookmarks?',
        `The backup holds ${parsed.bookmarks.length} bookmarks in ${parsed.categories.length} categories. ` +
        'This replaces what is in the gist now.',
        'Replace', () => {
          data = parsed;
          dropHay();
          render();
          save('Backup imported');
        });
    };
    r.readAsText(file);
  }

  /* -------------------------------------------------------------- boot */

  async function start() {
    const cached = ls.get(K_CACHE);
    if (cached) {                       // paint instantly, then refresh
      try { data = normalize(JSON.parse(cached)); dropHay(); show(); render(); } catch {}
    }
    try {
      sync('busy');
      data = await pull();
      dropHay();
      ls.set(K_CACHE, JSON.stringify(data));
      sync('');
      show();
      render();
    } catch (e) {
      sync('error');
      if (e.status === 401) {           // bad or revoked token — back to setup
        ls.del(K_TOKEN);
        token = '';
        gate('That token was rejected by GitHub. Create a new one and paste it again.');
        return;
      }
      if (!cached) { gate('Could not reach GitHub: ' + e.message); return; }
      toast('Offline — showing the last saved copy', true);
    }
  }

  function show() {
    $('#setup').hidden = true;
    $('#app').hidden = false;
  }

  function gate(msg) {
    $('#app').hidden = true;
    $('#setup').hidden = false;
    const m = $('#setup-msg');
    m.textContent = msg || '';
    m.className = 'setup-msg';
    setTimeout(() => $('#token').focus(), 30);
  }

  /* -------------------------------------------------------------- events */

  // search
  $('#q').addEventListener('input', e => {
    query = e.target.value.trim();
    $('#clear').hidden = !query;
    render();
    if (query) moveCursor(1);
  });

  $('#clear').addEventListener('click', () => {
    $('#q').value = '';
    query = '';
    $('#clear').hidden = true;
    render();
    $('#q').focus();
  });

  // cards
  $('#main').addEventListener('click', e => {
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      e.preventDefault();
      openEditor(edit.dataset.edit);
      return;
    }
    if (e.target.closest('#add-from-empty')) openEditor(null);
  });

  // Favicon fetch failed — swap in a coloured letter badge. Image `error`
  // events do not bubble, so listen on the capture phase.
  $('#main').addEventListener('error', e => {
    const img = e.target;
    if (!img.classList || !img.classList.contains('fav')) return;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = img.dataset.letter || '?';
    badge.style.background = img.dataset.tint || 'var(--text-3)';
    img.replaceWith(badge);
  }, true);

  // toolbar
  $('#add').addEventListener('click', () => openEditor(null));
  $('#theme').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    ls.set(K_THEME, next);
  });

  const menu = $('#menu');
  $('#menu-btn').addEventListener('click', e => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', () => { menu.hidden = true; });

  menu.addEventListener('click', e => {
    const act = e.target.dataset.act;
    if (!act) return;
    menu.hidden = true;
    if (act === 'categories') { renderCats(); $('#dlg-cats').showModal(); }
    if (act === 'export') exportBackup();
    if (act === 'import') $('#import-file').click();
    if (act === 'reload') start().then(() => toast('Reloaded from gist'));
    if (act === 'signout') {
      confirmThen('Sign out of this browser?',
        'The token and the local copy are cleared. Your gist keeps every bookmark.',
        'Sign out', () => {
          ls.del(K_TOKEN); ls.del(K_CACHE); ls.del(K_GIST);
          location.reload();
        });
    }
  });

  $('#import-file').addEventListener('change', e => {
    if (e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = '';
  });

  // dialogs
  $('#form-mark').addEventListener('submit', submitEditor);
  $('#mark-delete').addEventListener('click', () => {
    const b = data.bookmarks.find(x => x.id === editingId);
    if (!b) return;
    $('#dlg-mark').close();
    confirmThen(`Delete “${b.title}”?`, 'This removes it from the gist.', 'Delete', () => {
      data.bookmarks = data.bookmarks.filter(x => x.id !== editingId);
      dropHay();
      render();
      save('Bookmark deleted');
    });
  });
  document.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
  });
  wireCats();

  // sidebar
  $('#sidebar').addEventListener('click', e => {
    const link = e.target.closest('.side-link');
    if (!link) return;
    if (query) {                       // leave search mode so the anchor exists
      $('#q').value = '';
      query = '';
      $('#clear').hidden = true;
      render();
    }
    if (!link.dataset.nav) {
      e.preventDefault();
      scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      e.preventDefault();
      const target = document.getElementById('c-' + link.dataset.nav);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  // setup
  $('#setup-form').addEventListener('submit', async e => {
    e.preventDefault();
    const value = $('#token').value.trim();
    if (!value) return;
    const msg = $('#setup-msg');
    const go = $('#setup-go');
    msg.textContent = 'Connecting…';
    msg.className = 'setup-msg busy';
    go.disabled = true;
    token = value;
    gistId = '';
    try {
      data = await pull();
      dropHay();
      ls.set(K_TOKEN, token);
      ls.set(K_GIST, gistId);
      ls.set(K_CACHE, JSON.stringify(data));
      msg.textContent = 'Connected.';
      msg.className = 'setup-msg ok';
      $('#token').value = '';
      show();
      render();
      sync('');
    } catch (err) {
      token = '';
      msg.textContent = err.status === 401
        ? 'GitHub rejected that token. Check it was copied whole and has the gist scope.'
        : err.message;
      msg.className = 'setup-msg';
    } finally {
      go.disabled = false;
    }
  });

  // keyboard
  document.addEventListener('keydown', e => {
    const q = $('#q');
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    const inDialog = !!document.querySelector('dialog[open]');

    if (e.key === 'Escape' && !inDialog) {
      if (q.value) {
        q.value = ''; query = ''; $('#clear').hidden = true; render();
      } else q.blur();
      return;
    }
    if (inDialog) return;

    if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key === 'k')) {
      e.preventDefault();
      q.focus();
      q.select();
      return;
    }
    if (e.key === 'n' && !typing) { e.preventDefault(); openEditor(null); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveCursor(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveCursor(-1); return; }
    if (e.key === 'Enter' && cursor >= 0 && cards[cursor]) {
      e.preventDefault();
      cards[cursor].click();
    }
  });

  // go
  if (token) start(); else gate('');
})();
