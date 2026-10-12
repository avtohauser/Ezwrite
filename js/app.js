/* EzWrite — интерфейс: настройки, превью, библиотека, экспорт */
(function () {
  const EZ = window.EZ;
  const $ = (id) => document.getElementById(id);
  const LS_SETTINGS = 'ezwrite.settings.v1';
  const LS_TEXT = 'ezwrite.text.v1';

  const DEFAULT_TEXT =
    'Привет! Это EzWrite — инструмент, который превращает напечатанный текст в рукописный.\n' +
    'Выберите почерк, вставьте свой текст и настройте бумагу и ручку. Можно нарисовать собственный почерк по буквам или загрузить чужой — от друга или в виде шрифта.\n' +
    'Съешь же ещё этих мягких французских булок, да выпей чаю.';

  const PRESETS = {
    neat: { sizeVar: 4, baselineVar: 1, rotateVar: 1.5, wobble: 10, spacingVar: 8, lineDrift: 8, inkVar: 8, slant: 0 },
    normal: { sizeVar: 8, baselineVar: 2, rotateVar: 3, wobble: 25, spacingVar: 15, lineDrift: 20, inkVar: 15, slant: 0 },
    hurry: { sizeVar: 12, baselineVar: 3.5, rotateVar: 5, wobble: 45, spacingVar: 25, lineDrift: 40, inkVar: 25, slant: 8 },
    messy: { sizeVar: 18, baselineVar: 5, rotateVar: 8, wobble: 70, spacingVar: 35, lineDrift: 65, inkVar: 35, slant: 4 },
  };

  const DEFAULTS = {
    hwId: 'font:Caveat',
    fallbackFont: 'Caveat',
    paper: 'lined',
    paperSize: 'a4',
    margin: true,
    indent: true,
    scan: false,
    paperColor: '#fdfdf8',
    size: 26,
    lineHeight: 60,
    ink: '#1a3b8c',
    penWidth: 2.4,
    pressure: 35,
    letterSpacing: 0,
    wordSpacing: 100,
    seed: 20241,
    ...PRESETS.normal,
  };

  let S = { ...DEFAULTS };
  try {
    S = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}') };
  } catch (e) {}
  let pages = [];

  const saveSettings = () => {
    try {
      localStorage.setItem(LS_SETTINGS, JSON.stringify(S));
    } catch (e) {}
  };

  // ---------- уведомления ----------
  let toastTimer;
  EZ.toast = function (msg, isError) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = 'toast'), isError ? 6000 : 3000);
  };

  // ---------- навигация ----------
  function show(view) {
    document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== 'view-' + view));
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    if (view === 'library') renderLibrary();
    if (view === 'write') scheduleRender();
    window.scrollTo(0, 0);
  }

  // ---------- выбор почерка ----------
  function currentHw() {
    return EZ.store.get(S.hwId) || EZ.store.get(DEFAULTS.hwId);
  }

  function fillHwSelect() {
    const sel = $('hw-select');
    sel.innerHTML = '';
    const groups = [
      ['Мои нарисованные почерки', EZ.store.user.filter((h) => h.type === 'strokes')],
      ['Загруженные шрифты', EZ.store.user.filter((h) => h.type === 'font')],
      ['Встроенные почерки', EZ.BUILTIN_FONTS],
    ];
    for (const [label, list] of groups) {
      if (!list.length) continue;
      const og = document.createElement('optgroup');
      og.label = label;
      for (const h of list) {
        const o = document.createElement('option');
        o.value = h.id;
        o.textContent = h.type === 'strokes' ? `${h.name} (${EZ.glyphCount(h)} букв)` : h.note ? `${h.name} — ${h.note}` : h.name;
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
    if (!EZ.store.get(S.hwId)) S.hwId = DEFAULTS.hwId;
    sel.value = S.hwId;
    updateHwHint();
  }

  function updateHwHint() {
    const hw = currentHw();
    const isStrokes = hw.type === 'strokes';
    $('fallback-row').hidden = !isStrokes;
    $('hw-edit').hidden = !isStrokes;
  }

  function useHandwriting(id) {
    S.hwId = id;
    saveSettings();
    fillHwSelect();
    show('write');
  }

  // ---------- элементы управления ----------
  function syncControls() {
    document.querySelectorAll('[data-s]').forEach((el) => {
      const k = el.dataset.s;
      if (el.type === 'checkbox') el.checked = !!S[k];
      else if (el.type === 'radio') el.checked = el.value === S[k];
      else el.value = S[k];
    });
    document.querySelectorAll('output[data-for]').forEach((o) => {
      const k = o.dataset.for;
      o.textContent = S[k] + (o.dataset.unit || '');
    });
    document.querySelectorAll('[data-ink]').forEach((b) => b.classList.toggle('active', b.dataset.ink.toLowerCase() === String(S.ink).toLowerCase()));
    document.querySelectorAll('[data-preset]').forEach((b) => {
      const p = PRESETS[b.dataset.preset];
      b.classList.toggle('active', Object.keys(p).every((k) => S[k] === p[k]));
    });
  }

  function bindControls() {
    document.querySelectorAll('[data-s]').forEach((el) => {
      const ev = el.type === 'range' || el.tagName === 'TEXTAREA' || el.type === 'color' ? 'input' : 'change';
      el.addEventListener(ev, () => {
        const k = el.dataset.s;
        if (el.type === 'checkbox') S[k] = el.checked;
        else if (el.type === 'radio') {
          if (!el.checked) return;
          S[k] = el.value;
        } else if (el.type === 'range' || el.type === 'number') S[k] = Number(el.value);
        else S[k] = el.value;
        if (k === 'paper' && S.paper === 'grid' && S.lineHeight % 2) S.lineHeight += 1;
        if (k === 'hwId') updateHwHint();
        saveSettings();
        syncControls();
        scheduleRender();
      });
    });

    document.querySelectorAll('[data-ink]').forEach((b) =>
      b.addEventListener('click', () => {
        S.ink = b.dataset.ink;
        saveSettings();
        syncControls();
        scheduleRender();
      })
    );

    document.querySelectorAll('[data-preset]').forEach((b) =>
      b.addEventListener('click', () => {
        Object.assign(S, PRESETS[b.dataset.preset]);
        saveSettings();
        syncControls();
        scheduleRender();
      })
    );

    $('shuffle').onclick = () => {
      S.seed = Math.floor(Math.random() * 1e9);
      saveSettings();
      scheduleRender();
    };

    $('reset').onclick = () => {
      const keep = { hwId: S.hwId, fallbackFont: S.fallbackFont };
      S = { ...DEFAULTS, ...keep };
      saveSettings();
      syncControls();
      scheduleRender();
      EZ.toast('Настройки сброшены');
    };

    const ta = $('text');
    ta.value = localStorage.getItem(LS_TEXT) ?? DEFAULT_TEXT;
    const updateCount = () => ($('text-count').textContent = `${ta.value.length} символов`);
    updateCount();
    ta.addEventListener('input', () => {
      try {
        localStorage.setItem(LS_TEXT, ta.value);
      } catch (e) {}
      updateCount();
      scheduleRender();
    });

    $('hw-edit').onclick = () => openEditor(currentHw());
    $('hw-new').onclick = createHandwriting;
  }

  // ---------- рендер превью ----------
  let renderTimer,
    renderToken = 0;
  function scheduleRender() {
    clearTimeout(renderTimer);
    $('preview-status').textContent = 'Пишем…';
    renderTimer = setTimeout(render, 180);
  }

  async function render() {
    const tok = ++renderToken;
    const hw = currentHw();
    const res = await EZ.renderPages($('text').value, hw, S);
    if (tok !== renderToken) return;
    pages = res.canvases;
    const box = $('preview');
    box.innerHTML = '';
    pages.forEach((c, i) => {
      const fig = document.createElement('figure');
      fig.className = 'page';
      const cap = document.createElement('figcaption');
      cap.innerHTML = `<span>Страница ${i + 1} из ${pages.length}</span>`;
      const dl = document.createElement('button');
      dl.className = 'btn small ghost';
      dl.textContent = '⬇ PNG';
      dl.title = 'Скачать эту страницу картинкой';
      dl.onclick = () => downloadPng(i);
      cap.appendChild(dl);
      fig.append(cap, c);
      box.appendChild(fig);
    });
    $('preview-status').textContent = `${pages.length} ${plural(pages.length, 'страница', 'страницы', 'страниц')}`;
    const miss = $('missing');
    if (res.missing.length) {
      miss.hidden = false;
      miss.innerHTML = `В вашем почерке нет символов: <b>${escapeHtml(res.missing.join(' '))}</b> — они написаны шрифтом «${escapeHtml(S.fallbackFont)}». <a href="#" id="missing-fix">Дорисовать</a>`;
      $('missing-fix').onclick = (e) => {
        e.preventDefault();
        openEditor(hw, res.missing[0]);
      };
    } else miss.hidden = true;
  }

  const plural = (n, one, few, many) => {
    const m10 = n % 10,
      m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---------- экспорт ----------
  function downloadPng(i) {
    pages[i].toBlob((b) => EZ.downloadBlob(b, `ezwrite-${i + 1}.png`), 'image/png');
  }

  async function downloadAllPng() {
    for (let i = 0; i < pages.length; i++) {
      downloadPng(i);
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  async function downloadPdf() {
    const btn = $('dl-pdf');
    btn.disabled = true;
    try {
      if (!window.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
      const P = EZ.PAPERS[S.paperSize] || EZ.PAPERS.a4;
      const doc = new window.jspdf.jsPDF({ unit: 'mm', format: P.mm, orientation: 'portrait' });
      pages.forEach((c, i) => {
        if (i) doc.addPage(P.mm, 'portrait');
        doc.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, P.mm[0], P.mm[1]);
      });
      doc.save('ezwrite.pdf');
    } catch (e) {
      console.error(e);
      EZ.toast('Не удалось создать PDF (нужен интернет). Используйте «Печать» → «Сохранить как PDF».', true);
    } finally {
      btn.disabled = false;
    }
  }

  function printPages() {
    const area = $('print-area');
    area.innerHTML = '';
    const P = EZ.PAPERS[S.paperSize] || EZ.PAPERS.a4;
    let style = $('print-page-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'print-page-style';
      document.head.appendChild(style);
    }
    style.textContent = `@page { size: ${P.mm[0]}mm ${P.mm[1]}mm; margin: 0 }`;
    pages.forEach((c) => {
      const img = new Image();
      img.src = c.toDataURL('image/png');
      area.appendChild(img);
    });
    setTimeout(() => window.print(), 300);
  }

  // ---------- библиотека ----------
  async function renderLibrary() {
    const mine = $('lib-mine');
    const builtin = $('lib-builtin');
    mine.innerHTML = '';
    builtin.innerHTML = '';
    if (!EZ.store.user.length) {
      mine.innerHTML = '<p class="muted">Здесь появятся ваши почерки и почерки друзей. Нажмите «Создать свой почерк» или импортируйте файл.</p>';
    }
    const jobs = [];
    for (const hw of EZ.store.user) jobs.push(card(hw, mine));
    for (const hw of EZ.BUILTIN_FONTS) jobs.push(card(hw, builtin));
    await Promise.all(jobs);
  }

  async function card(hw, box) {
    const el = document.createElement('article');
    el.className = 'card' + (hw.id === S.hwId ? ' selected' : '');
    const kind = hw.type === 'strokes' ? `Нарисован от руки · ${EZ.glyphCount(hw)} символов` : hw.builtin ? hw.note : 'Загруженный шрифт';
    const author = hw.author ? ` · автор: ${escapeHtml(hw.author)}` : '';
    el.innerHTML = `<header><h4></h4><p class="muted">${escapeHtml(kind)}${author}</p></header>`;
    el.querySelector('h4').textContent = hw.name;
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 150;
    el.appendChild(c);
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const btn = (label, cls, fn, title) => {
      const b = document.createElement('button');
      b.className = 'btn small ' + cls;
      b.textContent = label;
      if (title) b.title = title;
      b.onclick = fn;
      actions.appendChild(b);
    };
    btn(hw.id === S.hwId ? '✓ Выбран' : 'Писать этим почерком', 'primary', () => useHandwriting(hw.id));
    if (hw.type === 'strokes') btn('✎ Дорисовать', 'ghost', () => openEditor(hw));
    if (!hw.builtin) {
      btn('⇪ Поделиться', 'ghost', () => EZ.store.exportHw(hw), 'Скачать файл почерка, чтобы отправить другу');
      btn('Удалить', 'ghost danger', () => {
        if (!confirm(`Удалить почерк «${hw.name}»? Это нельзя отменить (если нет экспортированного файла).`)) return;
        EZ.store.remove(hw.id);
        if (S.hwId === hw.id) S.hwId = DEFAULTS.hwId;
        saveSettings();
        fillHwSelect();
        renderLibrary();
      });
    }
    el.appendChild(actions);
    box.appendChild(el);
    await EZ.renderSample(c, 'Съешь ещё этих мягких булок, да выпей чаю!', hw, { ...S, size: 34, lineHeight: 64, top: 0, paperColor: '#ffffff', seed: 3 });
  }

  function createHandwriting() {
    const name = prompt('Как назвать почерк?', 'Мой почерк');
    if (name === null) return;
    const hw = EZ.store.createStrokes(name.trim() || 'Мой почерк');
    fillHwSelect();
    openEditor(hw);
  }

  function openEditor(hw, ch) {
    if (!hw || hw.type !== 'strokes') return;
    show('editor');
    EZ.editor.open(hw);
    if (ch) EZ.editor.select(ch);
  }

  function bindLibrary() {
    $('lib-new').onclick = createHandwriting;
    $('lib-import').onchange = async (e) => {
      for (const f of e.target.files) {
        try {
          const hw = await EZ.store.importJson(await f.text());
          EZ.toast(`Почерк «${hw.name}» добавлен`);
        } catch (err) {
          EZ.toast(err.message, true);
        }
      }
      e.target.value = '';
      fillHwSelect();
      renderLibrary();
    };
    $('lib-font').onchange = async (e) => {
      for (const f of e.target.files) {
        try {
          const hw = await EZ.store.addFontFile(f);
          EZ.toast(`Шрифт «${hw.name}» добавлен`);
        } catch (err) {
          EZ.toast(err.message, true);
        }
      }
      e.target.value = '';
      fillHwSelect();
      renderLibrary();
    };
  }

  // ---------- старт ----------
  async function start() {
    await EZ.store.init();
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
    bindControls();
    bindLibrary();
    fillHwSelect();
    syncControls();

    EZ.editor.init({
      getSettings: () => S,
      onChange: () => fillHwSelect(),
    });
    $('ed-use').onclick = () => useHandwriting(EZ.editor.hw.id);
    $('ed-export').onclick = () => EZ.store.exportHw(EZ.editor.hw);

    $('dl-png').onclick = () => (pages.length === 1 ? downloadPng(0) : downloadAllPng());
    $('dl-pdf').onclick = downloadPdf;
    $('dl-print').onclick = printPages;

    const help = $('help');
    $('help-open').onclick = () => help.showModal();
    $('help-close').onclick = () => help.close();
    try {
      if (!localStorage.getItem('ezwrite.seenHelp')) {
        $('welcome').hidden = false;
        $('welcome-close').onclick = () => {
          $('welcome').hidden = true;
          localStorage.setItem('ezwrite.seenHelp', '1');
        };
      }
    } catch (e) {}

    // Шрифты Google подгружаются асинхронно — перерисуем, когда загрузятся
    document.fonts.addEventListener('loadingdone', () => !$('view-write').hidden && scheduleRender());
    show('write');
  }

  start();
})();
