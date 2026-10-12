/* EzWrite — общие утилиты, наборы символов и хранилище почерков */
(function () {
  const EZ = (window.EZ = window.EZ || {});

  // Детерминированный генератор случайных чисел (mulberry32):
  // одинаковый seed => одинаковый «почерк» в превью.
  EZ.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  EZ.clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  EZ.hexToRgb = function (hex) {
    const h = String(hex || '#000').replace('#', '');
    const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
    return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
  };

  EZ.mixRgb = function (a, b, t) {
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
  };

  EZ.uid = () => Math.random().toString(36).slice(2, 10);

  EZ.downloadBlob = function (blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  };

  // Наборы символов для «мастерской почерка»
  EZ.CHARSETS = [
    { id: 'ru-lower', title: 'а–я', full: 'Русские строчные', chars: 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя' },
    { id: 'ru-upper', title: 'А–Я', full: 'Русские заглавные', chars: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ' },
    { id: 'digits', title: '0–9', full: 'Цифры', chars: '0123456789' },
    { id: 'punct', title: '.,!?', full: 'Знаки препинания', chars: '.,!?:;-—()«»"\'/+=%№' },
    { id: 'en-lower', title: 'a–z', full: 'Латинские строчные', chars: 'abcdefghijklmnopqrstuvwxyz' },
    { id: 'en-upper', title: 'A–Z', full: 'Латинские заглавные', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
  ];
  EZ.CORE_CHARS = EZ.CHARSETS.slice(0, 4).map((c) => c.chars).join('');

  // Встроенные рукописные шрифты (Google Fonts, с кириллицей)
  EZ.BUILTIN_FONTS = [
    ['Caveat', 'Аккуратный, современный'],
    ['Marck Script', 'Классическая пропись'],
    ['Bad Script', 'Беглый, с наклоном'],
    ['Neucha', 'Печатными буквами'],
    ['Pangolin', 'Округлый, школьный'],
    ['Shantell Sans', 'Небрежный маркер'],
    ['Comforter', 'Каллиграфия с росчерками'],
    ['Amatic SC', 'Узкий, высокий'],
    ['Great Vibes', 'Нарядный курсив'],
    ['Underdog', 'Угловатый, неровный'],
  ].map(([family, note]) => ({ id: 'font:' + family, type: 'font', builtin: true, name: family, family, note }));

  const LS_KEY = 'ezwrite.handwritings.v1';

  function b64ToBuf(b64) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  function bufToB64(buf) {
    const u = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }

  const store = {
    user: [],
    lastError: null,

    async init() {
      try {
        this.user = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
      } catch (e) {
        this.user = [];
      }
      await Promise.all(this.user.filter((h) => h.type === 'font').map((h) => this.registerFont(h)));
    },

    async registerFont(hw) {
      try {
        const face = new FontFace(hw.family, b64ToBuf(hw.data));
        await face.load();
        document.fonts.add(face);
        return true;
      } catch (e) {
        console.warn('Не удалось загрузить шрифт', hw.name, e);
        return false;
      }
    },

    all() {
      return [...this.user, ...EZ.BUILTIN_FONTS];
    },
    get(id) {
      return this.all().find((h) => h.id === id) || null;
    },

    persist() {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(this.user));
        this.lastError = null;
        return true;
      } catch (e) {
        this.lastError = e;
        console.error(e);
        return false;
      }
    },

    save(hw) {
      hw.updated = Date.now();
      const i = this.user.findIndex((h) => h.id === hw.id);
      if (i >= 0) this.user[i] = hw;
      else this.user.unshift(hw);
      return this.persist();
    },

    remove(id) {
      this.user = this.user.filter((h) => h.id !== id);
      this.persist();
    },

    createStrokes(name) {
      const hw = { id: 'hw:' + EZ.uid(), type: 'strokes', name: name || 'Мой почерк', author: '', created: Date.now(), glyphs: {}, extraChars: [] };
      this.save(hw);
      return hw;
    },

    async addFontFile(file) {
      const buf = await file.arrayBuffer();
      const id = EZ.uid();
      const hw = {
        id: 'hwf:' + id,
        type: 'font',
        name: file.name.replace(/\.(ttf|otf|woff2?)$/i, ''),
        family: 'EZFont_' + id,
        data: bufToB64(buf),
        created: Date.now(),
      };
      if (!(await this.registerFont(hw))) throw new Error('Файл не похож на шрифт (нужен .ttf, .otf, .woff или .woff2)');
      if (!this.save(hw)) {
        this.user = this.user.filter((h) => h.id !== hw.id);
        throw new Error('Шрифт слишком большой для хранилища браузера');
      }
      return hw;
    },

    exportHw(hw) {
      const data = { format: 'ezwrite-handwriting', version: 1, handwriting: hw };
      const safe = (hw.name || 'pocherk').replace(/[^\p{L}\p{N}_-]+/gu, '_');
      EZ.downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${safe}.ezwrite.json`);
    },

    async importJson(text) {
      let obj;
      try {
        obj = JSON.parse(text);
      } catch (e) {
        throw new Error('Файл повреждён или это не JSON');
      }
      const hw = obj && obj.format === 'ezwrite-handwriting' ? obj.handwriting : null;
      if (!hw || (hw.type !== 'strokes' && hw.type !== 'font')) throw new Error('Это не файл почерка EzWrite');
      const copy = JSON.parse(JSON.stringify(hw));
      const id = EZ.uid();
      if (copy.type === 'strokes') {
        copy.id = 'hw:' + id;
        copy.glyphs = copy.glyphs || {};
        copy.extraChars = copy.extraChars || [];
      } else {
        copy.id = 'hwf:' + id;
        copy.family = 'EZFont_' + id;
        if (!(await this.registerFont(copy))) throw new Error('Шрифт в файле повреждён');
      }
      copy.imported = Date.now();
      if (!this.save(copy)) {
        this.user = this.user.filter((h) => h.id !== copy.id);
        throw new Error('Не хватает места в хранилище браузера');
      }
      return copy;
    },
  };

  EZ.store = store;

  EZ.glyphCount = (hw) => (hw && hw.glyphs ? Object.keys(hw.glyphs).filter((k) => hw.glyphs[k].length).length : 0);
})();
