/* EzWrite — «мастерская почерка»: рисуем свои буквы */
(function () {
  const EZ = window.EZ;
  const G = EZ.GLYPH;
  const $ = (id) => document.getElementById(id);
  const r4 = (v) => Math.round(v * 10000) / 10000;
  const r2 = (v) => Math.round(v * 100) / 100;

  const ed = {
    hw: null,
    tab: 0,
    ch: 'а',
    strokes: [],
    cur: null,
    last: null,
    onChange: null, // колбэк для приложения
    getSettings: null,

    init(opts) {
      Object.assign(this, opts);
      const pad = (this.pad = $('ed-pad'));
      this.bindPad(pad, {
        start: (p) => {
          this.cur = [p];
          this.strokes.push(this.cur);
          this.redraw();
        },
        add: (p) => {
          this.cur.push(p);
          this.redraw();
        },
        end: () => (this.cur = null),
      });
      new ResizeObserver(() => this.resize()).observe($('ed-pad-wrap'));

      $('ed-undo').onclick = () => this.undo();
      $('ed-clear').onclick = () => this.clear();
      $('ed-save-stay').onclick = () => this.save(false);
      $('ed-save-next').onclick = () => this.save(true);
      $('ed-prev').onclick = () => this.step(-1);
      $('ed-skip').onclick = () => this.step(1);
      $('ed-ghost').onchange = () => {
        this.redraw();
        this.sizeSheet();
      };
      $('ed-name').oninput = (e) => {
        this.hw.name = e.target.value || 'Без названия';
        this.persist();
      };
      $('ed-author').oninput = (e) => {
        this.hw.author = e.target.value;
        this.persist();
      };
      $('ed-test-text').oninput = () => this.renderTest();
      $('ed-add-char').onclick = () => this.addChar();
      $('ed-extra').addEventListener('keydown', (e) => e.key === 'Enter' && this.addChar());

      // ---- режим «лист» (удобно на iPad) ----
      document.querySelectorAll('input[name=edmode]').forEach((r) =>
        r.addEventListener('change', () => r.checked && this.setMode(r.value))
      );
      $('ed-penonly').onchange = (e) => this.setPenOnly(e.target.checked);
      $('sh-new').onclick = () => {
        this.sheetActive = new Map();
        this.renderSheet();
        EZ.toast('Чистый лист: всё, что напишете, добавится новыми вариантами букв');
      };
      new ResizeObserver(() => this.sizeSheet()).observe($('sh-grid'));
      let mode = 'single';
      try {
        mode = localStorage.getItem('ezwrite.edmode') || (matchMedia('(pointer: coarse)').matches ? 'sheet' : 'single');
      } catch (e) {}
      this.mode = mode;

      document.addEventListener('keydown', (e) => {
        if ($('view-editor').hidden || !this.hw || this.mode !== 'single') return;
        if (e.target.closest('input, textarea, select')) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          this.save(!e.shiftKey);
        } else if ((e.key === 'z' && (e.ctrlKey || e.metaKey)) || e.key === 'Backspace') {
          e.preventDefault();
          this.undo();
        } else if (e.key === 'Escape' || e.key === 'Delete') {
          this.clear();
        } else if (e.key === 'ArrowRight') {
          this.step(1);
        } else if (e.key === 'ArrowLeft') {
          this.step(-1);
        }
      });
    },

    open(hw) {
      this.hw = hw;
      hw.glyphs = hw.glyphs || {};
      hw.extraChars = hw.extraChars || [];
      $('ed-name').value = hw.name || '';
      $('ed-author').value = hw.author || '';
      this.tab = 0;
      this.sheetActive = new Map();
      this.setMode(this.mode);
      const firstEmpty = EZ.CORE_CHARS.split('').find((c) => !(hw.glyphs[c] && hw.glyphs[c].length));
      this.select(firstEmpty || 'а');
      this.resize();
    },

    charsets() {
      const known = new Set(EZ.CHARSETS.map((c) => c.chars).join(''));
      const extra = Array.from(new Set([...this.hw.extraChars, ...Object.keys(this.hw.glyphs).filter((k) => !known.has(k))]));
      return [...EZ.CHARSETS, { id: 'extra', title: 'Свои', full: 'Свои символы', chars: extra.join('') }];
    },

    seq() {
      return this.charsets().flatMap((c) => Array.from(c.chars));
    },

    select(ch) {
      this.ch = ch;
      this.strokes = [];
      const sets = this.charsets();
      const ti = sets.findIndex((c) => Array.from(c.chars).includes(ch));
      if (ti >= 0) this.tab = ti;
      this.renderTabs();
      this.renderTiles();
      this.renderSheet();
      this.renderCurrent();
      this.redraw();
      this.renderTest();
    },

    setMode(mode) {
      this.mode = mode;
      try {
        localStorage.setItem('ezwrite.edmode', mode);
      } catch (e) {}
      document.querySelectorAll('input[name=edmode]').forEach((r) => (r.checked = r.value === mode));
      $('ed-single').hidden = mode !== 'single';
      $('ed-sheet').hidden = mode !== 'sheet';
      if (!this.hw) return;
      if (mode === 'sheet') this.renderSheet();
      else this.resize();
    },

    // ---------- лист с клетками для всех букв набора ----------
    renderSheet() {
      if (!this.hw || this.mode !== 'sheet') return;
      const grid = $('sh-grid');
      grid.innerHTML = '';
      this.cells = [];
      const chars = Array.from(this.charsets()[this.tab].chars);
      if (!chars.length) grid.innerHTML = '<p class="muted">Добавьте свои символы во вкладке «Свои» в режиме «По одной букве».</p>';
      chars.forEach((ch) => {
        const el = document.createElement('div');
        el.className = 'cell';
        const head = document.createElement('div');
        head.className = 'cell-head';
        const label = document.createElement('b');
        label.textContent = ch;
        const count = document.createElement('span');
        count.className = 'cell-count';
        const more = document.createElement('button');
        more.className = 'cell-btn';
        more.textContent = '+';
        more.title = 'Написать эту букву ещё раз (новый вариант)';
        const del = document.createElement('button');
        del.className = 'cell-btn';
        del.textContent = '×';
        del.title = 'Стереть то, что написано в этой клетке';
        head.append(label, count, more, del);
        const c = document.createElement('canvas');
        el.append(head, c);
        grid.appendChild(el);

        const cell = { ch, el, canvas: c, count, cur: null };
        this.cells.push(cell);
        const variants = () => (this.hw.glyphs[ch] = this.hw.glyphs[ch] || []);
        this.bindPad(c, {
          start: (p) => {
            let v = this.sheetActive.get(ch);
            if (!v || !variants().includes(v)) {
              v = { strokes: [] };
              variants().push(v);
              this.sheetActive.set(ch, v);
            }
            cell.cur = [p];
            v.strokes.push(cell.cur);
            this.drawCell(cell);
          },
          add: (p) => {
            cell.cur.push(p);
            this.drawCell(cell);
          },
          end: () => {
            const v = this.sheetActive.get(ch);
            if (v && v.strokes.length) v.strokes[v.strokes.length - 1] = cell.cur.map((p) => [r4(p[0]), r4(p[1]), r2(p[2])]);
            cell.cur = null;
            this.updateCellCount(cell);
            this.sheetSave();
          },
        });
        more.onclick = () => {
          this.sheetActive.delete(ch);
          this.drawCell(cell);
        };
        del.onclick = () => {
          const v = this.sheetActive.get(ch);
          if (!v) return;
          const list = variants();
          list.splice(list.indexOf(v), 1);
          if (!list.length) delete this.hw.glyphs[ch];
          this.sheetActive.delete(ch);
          this.drawCell(cell);
          this.updateCellCount(cell);
          this.sheetSave();
        };
        this.updateCellCount(cell);
      });
      this.sizeSheet();
    },

    updateCellCount(cell) {
      const n = (this.hw.glyphs[cell.ch] || []).length;
      cell.count.textContent = n ? String(n) : '';
      cell.count.title = n ? `Сохранено вариантов: ${n}` : '';
      cell.el.classList.toggle('done', n > 0);
    },

    sizeSheet() {
      if (!this.cells) return;
      const dpr = window.devicePixelRatio || 1;
      for (const cell of this.cells) {
        const w = cell.canvas.clientWidth;
        if (!w) continue;
        cell.canvas.width = cell.canvas.height = Math.round(w * dpr);
        this.drawCell(cell);
      }
    },

    drawCell(cell) {
      const c = cell.canvas;
      if (!c.width) return;
      const ctx = c.getContext('2d');
      const S = c.width;
      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, S, S);
      this.drawGuides(ctx, S, dpr, cell.ch);
      const v = this.sheetActive.get(cell.ch);
      const ink = (this.getSettings && this.getSettings().ink) || '#1a3b8c';
      if (v) EZ.drawGlyph(ctx, v, S, { color: ink, lw: Math.max(2, S / 70), pressure: 0.5 });
    },

    sheetSave() {
      clearTimeout(this.sheetTimer);
      this.sheetTimer = setTimeout(() => {
        this.persist();
        this.renderTabs();
        this.renderTest();
      }, 500);
    },

    step(d) {
      const seq = this.seq();
      const i = seq.indexOf(this.ch);
      this.select(seq[(i + d + seq.length) % seq.length]);
    },

    persist() {
      if (!EZ.store.save(this.hw)) EZ.toast('Не получилось сохранить: в браузере закончилось место. Нажмите «Поделиться почерком», чтобы сохранить его в файл.', true);
      this.onChange && this.onChange(this.hw);
    },

    // ---------- рисование ----------
    /**
     * Подключает рисование к холсту. Мышь, палец и стилус (Apple Pencil).
     * Если замечен стилус — касания пальцем/ладонью больше не рисуют.
     */
    bindPad(el, h) {
      let drawing = false,
        last = null;
      const pt = (e) => {
        const rect = el.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        let p = 0.5;
        if (e.pointerType === 'pen' && e.pressure > 0) p = e.pressure;
        else if (last) {
          // мышь/палец: имитируем нажим по скорости (быстрее = тоньше)
          const dt = Math.max(1, e.timeStamp - last.t);
          const v = (Math.hypot(x - last.x, y - last.y) * rect.width) / dt;
          p = last.p * 0.7 + EZ.clamp(0.78 - v * 0.22, 0.25, 0.8) * 0.3;
        }
        last = { x, y, p, t: e.timeStamp };
        return [x, y, p];
      };
      el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'pen') this.setPenOnly(true);
        else if (e.pointerType === 'touch' && this.penOnly) return;
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        drawing = true;
        last = null;
        h.start(pt(e));
      });
      el.addEventListener('pointermove', (e) => {
        if (!drawing) return;
        const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
        let moved = false;
        for (const ev of evs.length ? evs : [e]) {
          const rect = el.getBoundingClientRect();
          const x = (ev.clientX - rect.left) / rect.width;
          const y = (ev.clientY - rect.top) / rect.height;
          if (last && Math.hypot(x - last.x, y - last.y) < 0.004) continue;
          h.add(pt(ev));
          moved = true;
        }
      });
      const stop = () => {
        if (!drawing) return;
        drawing = false;
        h.end();
      };
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => el.addEventListener(t, stop));
      // iPad: стилус не должен прокручивать страницу и вызывать лупу
      el.addEventListener(
        'touchstart',
        (e) => {
          const t = e.touches[0];
          if ((t && t.touchType === 'stylus') || !this.penOnly) e.preventDefault();
        },
        { passive: false }
      );
      el.addEventListener('touchmove', (e) => {
        const t = e.touches[0];
        if ((t && t.touchType === 'stylus') || !this.penOnly) e.preventDefault();
      }, { passive: false });
    },

    setPenOnly(on) {
      if (this.penOnly === on) return;
      this.penOnly = on;
      $('ed-penonly').checked = on;
      document.body.classList.toggle('pen-only', on);
      if (on) EZ.toast('Теперь рисует только стилус. Пальцем можно листать страницу.');
    },

    undo() {
      this.strokes.pop();
      this.redraw();
    },
    clear() {
      this.strokes = [];
      this.redraw();
    },

    save(next) {
      if (!this.strokes.length) {
        if (next) this.step(1);
        else EZ.toast('Сначала нарисуйте букву в поле');
        return;
      }
      const variant = { strokes: this.strokes.map((st) => st.map((p) => [r4(p[0]), r4(p[1]), r2(p[2])])) };
      (this.hw.glyphs[this.ch] = this.hw.glyphs[this.ch] || []).push(variant);
      this.persist();
      if (next) this.step(1);
      else this.select(this.ch);
    },

    removeVariant(i) {
      const list = this.hw.glyphs[this.ch] || [];
      list.splice(i, 1);
      if (!list.length) delete this.hw.glyphs[this.ch];
      this.persist();
      this.select(this.ch);
    },

    addChar() {
      const v = Array.from($('ed-extra').value.trim());
      if (!v.length) return;
      v.forEach((c) => {
        if (!this.hw.extraChars.includes(c)) this.hw.extraChars.push(c);
      });
      $('ed-extra').value = '';
      this.persist();
      this.select(v[0]);
    },

    resize() {
      const wrap = $('ed-pad-wrap');
      const size = Math.min(wrap.clientWidth, 440);
      if (!size) return;
      const dpr = window.devicePixelRatio || 1;
      this.pad.style.width = this.pad.style.height = size + 'px';
      this.pad.width = this.pad.height = Math.round(size * dpr);
      this.redraw();
    },

    redraw() {
      const c = this.pad;
      if (!c || !c.width) return;
      const ctx = c.getContext('2d');
      const S = c.width;
      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, S, S);
      this.drawGuides(ctx, S, dpr, this.ch);
      const ink = (this.getSettings && this.getSettings().ink) || '#1a3b8c';
      EZ.drawGlyph(ctx, { strokes: this.strokes }, S, { color: ink, lw: 3.2 * dpr, pressure: 0.5 });
    },

    drawGuides(ctx, S, dpr, ch) {
      const line = (y, color, dash, w = 1) => {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = w * dpr;
        ctx.setLineDash(dash.map((d) => d * dpr));
        ctx.beginPath();
        ctx.moveTo(0, y * S);
        ctx.lineTo(S, y * S);
        ctx.stroke();
        ctx.restore();
      };
      line(G.ASC, 'rgba(120,120,140,0.45)', [6, 5]);
      line(G.XH, 'rgba(120,120,140,0.45)', [3, 4]);
      line(G.DESC, 'rgba(120,120,140,0.3)', [6, 5]);
      line(G.BASE, 'rgba(40,110,230,0.8)', [], 2);

      if ($('ed-ghost').checked) {
        ctx.save();
        ctx.fillStyle = 'rgba(130,130,150,0.16)';
        ctx.font = `${S * G.CAP * 1.45}px "Caveat", cursive`;
        const w = ctx.measureText(ch).width;
        ctx.fillText(ch, (S - w) / 2, G.BASE * S);
        ctx.restore();
      }
    },

    // ---------- интерфейс ----------
    renderTabs() {
      const box = $('ed-tabs');
      box.innerHTML = '';
      this.charsets().forEach((cs, i) => {
        const chars = Array.from(cs.chars);
        const done = chars.filter((c) => this.hw.glyphs[c] && this.hw.glyphs[c].length).length;
        const b = document.createElement('button');
        b.className = 'tab' + (i === this.tab ? ' active' : '');
        b.title = cs.full;
        b.innerHTML = `${cs.title} <small>${done}/${chars.length}</small>`;
        b.onclick = () => {
          this.tab = i;
          this.renderTabs();
          this.renderTiles();
          this.renderSheet();
          $('ed-extra-row').hidden = cs.id !== 'extra';
        };
        box.appendChild(b);
      });
      $('ed-extra-row').hidden = this.charsets()[this.tab].id !== 'extra';

      const core = EZ.CORE_CHARS.split('');
      const done = core.filter((c) => this.hw.glyphs[c] && this.hw.glyphs[c].length).length;
      $('ed-progress-bar').style.width = (100 * done) / core.length + '%';
      $('ed-progress-text').textContent = `Готово ${done} из ${core.length} основных символов (русский алфавит, цифры, знаки)`;
    },

    renderTiles() {
      const box = $('ed-tiles');
      box.innerHTML = '';
      const cs = this.charsets()[this.tab];
      const chars = Array.from(cs.chars);
      if (!chars.length) {
        box.innerHTML = '<p class="muted">Добавьте любые символы, которых нет в других наборах — например, «ö», «&», «@».</p>';
      }
      const ink = (this.getSettings && this.getSettings().ink) || '#1a3b8c';
      chars.forEach((ch) => {
        const vs = this.hw.glyphs[ch] || [];
        const t = document.createElement('button');
        t.className = 'tile' + (ch === this.ch ? ' active' : '') + (vs.length ? ' done' : '');
        t.title = vs.length ? `«${ch}»: вариантов ${vs.length}` : `«${ch}»: ещё не нарисована`;
        const c = document.createElement('canvas');
        c.width = c.height = 96;
        const ctx = c.getContext('2d');
        if (vs.length) EZ.drawGlyph(ctx, vs[0], 96, { color: ink, lw: 2.4 });
        else {
          ctx.fillStyle = 'rgba(120,120,140,0.45)';
          ctx.font = '44px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(ch, 48, 64);
        }
        t.appendChild(c);
        if (vs.length) {
          const b = document.createElement('span');
          b.className = 'badge';
          b.textContent = vs.length;
          t.appendChild(b);
        }
        t.onclick = () => this.select(ch);
        box.appendChild(t);
      });
    },

    renderCurrent() {
      $('ed-char').textContent = this.ch === ' ' ? '␣' : this.ch;
      const vs = this.hw.glyphs[this.ch] || [];
      $('ed-count').textContent = vs.length
        ? `сохранено вариантов: ${vs.length}${vs.length < 3 ? ' — добавьте ещё, будет живее' : ''}`
        : 'ещё не нарисована';
      const box = $('ed-variants');
      box.innerHTML = '';
      const ink = (this.getSettings && this.getSettings().ink) || '#1a3b8c';
      vs.forEach((v, i) => {
        const d = document.createElement('div');
        d.className = 'variant';
        const c = document.createElement('canvas');
        c.width = c.height = 80;
        EZ.drawGlyph(c.getContext('2d'), v, 80, { color: ink, lw: 2 });
        const x = document.createElement('button');
        x.className = 'x';
        x.textContent = '×';
        x.title = 'Удалить этот вариант';
        x.onclick = () => this.removeVariant(i);
        d.append(c, x);
        box.appendChild(d);
      });
    },

    async renderTest() {
      if (!this.hw) return;
      const c = $('ed-test');
      const wrap = c.parentElement;
      const w = Math.min(700, Math.max(280, wrap.clientWidth || 400));
      c.width = w * 2;
      c.height = 200;
      const s = { ...this.getSettings(), size: 30, lineHeight: 80, top: 0, paperColor: '#ffffff', seed: 7 };
      const missing = await EZ.renderSample(c, $('ed-test-text').value, this.hw, s);
      $('ed-test-missing').textContent = missing.length
        ? `Пока не нарисованы (взяты из шрифта): ${missing.join(' ')}`
        : 'Все символы нарисованы вашей рукой';
    },
  };

  EZ.editor = ed;
})();
