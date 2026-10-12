/* EzWrite — раскладка текста, бумага и отрисовка «рукописи» */
(function () {
  const EZ = window.EZ;

  // Разметка клетки, в которой рисуется буква (доли стороны квадрата)
  const G = (EZ.GLYPH = { ASC: 0.15, XH: 0.45, BASE: 0.75, DESC: 0.95, CAP: 0.6 });

  // Размеры листов в пикселях (≈150 dpi) и миллиметрах (для PDF)
  EZ.PAPERS = {
    a4: { name: 'A4', w: 1240, h: 1754, mm: [210, 297] },
    a5: { name: 'A5', w: 874, h: 1240, mm: [148, 210] },
    notebook: { name: 'Школьная тетрадь', w: 1004, h: 1210, mm: [170, 205] },
  };

  const FONT_SCALE = 1.45; // размер шрифта ≈ высота заглавной × 1.45
  const measureCtx = document.createElement('canvas').getContext('2d');
  const bboxCache = new WeakMap();

  function bboxOf(v) {
    let bb = bboxCache.get(v);
    if (bb) return bb;
    let minX = Infinity,
      maxX = -Infinity;
    for (const st of v.strokes) for (const p of st) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
    }
    if (!isFinite(minX)) (minX = 0), (maxX = 0.2);
    bb = { minX, maxX };
    bboxCache.set(v, bb);
    return bb;
  }

  /**
   * Рисует один штрих переменной толщины.
   * pts: [[x, y, нажим 0..1], ...] в пикселях.
   */
  EZ.drawStroke = function (ctx, pts, lw, pressureVar) {
    const n = pts.length;
    if (!n) return;
    const width = (p, i) => {
      let w = lw * (1 + ((p[2] == null ? 0.5 : p[2]) - 0.5) * pressureVar * 1.4);
      const edge = Math.min(i, n - 1 - i);
      if (edge < 2) w *= 0.78 + edge * 0.11; // лёгкое сужение на концах
      return Math.max(0.4, w);
    };
    if (n === 1 || (n === 2 && Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) < 0.5)) {
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], Math.max(0.6, lw * 0.6), 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    ctx.lineWidth = width(pts[0], 0);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    const m01 = mid(pts[0], pts[1]);
    ctx.lineTo(m01[0], m01[1]);
    ctx.stroke();
    for (let i = 1; i < n - 1; i++) {
      const a = mid(pts[i - 1], pts[i]);
      const b = mid(pts[i], pts[i + 1]);
      ctx.lineWidth = width(pts[i], i);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], b[0], b[1]);
      ctx.stroke();
    }
    const last = mid(pts[n - 2], pts[n - 1]);
    ctx.lineWidth = width(pts[n - 1], n - 1);
    ctx.beginPath();
    ctx.moveTo(last[0], last[1]);
    ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
    ctx.stroke();
  };

  /** Рисует вариант буквы целиком (для превью в мастерской) */
  EZ.drawGlyph = function (ctx, variant, size, opts = {}) {
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = opts.color || '#1a3b8c';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const ox = opts.ox || 0,
      oy = opts.oy || 0;
    for (const st of variant.strokes) {
      EZ.drawStroke(ctx, st.map((p) => [ox + p[0] * size, oy + p[1] * size, p[2]]), opts.lw || 2, opts.pressure ?? 0.4);
    }
    ctx.restore();
  };

  function familiesFor(hw, s) {
    const f = [s.fallbackFont || 'Caveat'];
    if (hw && hw.type === 'font') f.push(hw.family);
    return f;
  }

  async function ensureFonts(families, text) {
    const sample = Array.from(new Set(Array.from((text || '') + 'АаЯяAaZz0'))).join('');
    await Promise.all(families.map((f) => document.fonts.load(`40px "${f}"`, sample).catch(() => {})));
  }

  /** «Поставщик» букв: умеет измерить и нарисовать символ выбранным почерком */
  function makeProvider(hw, s, rand) {
    const fam = hw && hw.type === 'font' ? hw.family : s.fallbackFont || 'Caveat';
    const missing = new Set();
    const slant = Math.tan(((s.slant || 0) * Math.PI) / 180);
    const pv = (s.pressure || 0) / 100;

    const jitter = () => ({
      sc: 1 + (rand() - 0.5) * 2 * (s.sizeVar / 100),
      rot: ((rand() - 0.5) * 2 * s.rotateVar * Math.PI) / 180,
      dy: (rand() - 0.5) * 2 * s.baselineVar,
      gap: (rand() - 0.5) * 2 * (s.spacingVar / 100),
    });

    function fontItem(ch) {
      const j = jitter();
      const px = s.size * FONT_SCALE * j.sc;
      measureCtx.font = `${px}px "${fam}"`;
      const w = measureCtx.measureText(ch).width + s.letterSpacing + j.gap * s.size * 0.25;
      return { t: 'f', ch, px, w: Math.max(w, px * 0.1), rot: j.rot, dy: j.dy };
    }

    function strokeItem(variants) {
      const j = jitter();
      const v = variants[Math.floor(rand() * variants.length)];
      const bb = bboxOf(v);
      const unit = (s.size / G.CAP) * j.sc;
      const gap = s.size * 0.13 + s.letterSpacing + j.gap * s.size * 0.25;
      return { t: 's', v, bb, unit, w: Math.max((bb.maxX - bb.minX) * unit + gap, s.size * 0.1), rot: j.rot, dy: j.dy, seed: Math.floor(rand() * 1e9) };
    }

    return {
      missing,
      item(ch) {
        if (hw && hw.type === 'strokes') {
          const vs = hw.glyphs && hw.glyphs[ch];
          if (vs && vs.length) return strokeItem(vs);
          if (ch.trim()) missing.add(ch);
        }
        return fontItem(ch);
      },
      space() {
        return s.size * 0.55 * (s.wordSpacing / 100) * (1 + (rand() - 0.5) * (s.spacingVar / 100));
      },
      draw(ctx, it, x, y, color) {
        ctx.save();
        ctx.translate(x, y + it.dy);
        if (slant) ctx.transform(1, 0, -slant, 1, 0, 0);
        const cx = it.w / 2;
        ctx.translate(cx, 0);
        ctx.rotate(it.rot);
        ctx.translate(-cx, 0);
        ctx.fillStyle = ctx.strokeStyle = color;
        if (it.t === 'f') {
          ctx.font = `${it.px}px "${fam}"`;
          ctx.fillText(it.ch, 0, 0);
          const extra = (s.penWidth - 1.6) * 0.55;
          if (extra > 0.05) {
            ctx.lineWidth = extra;
            ctx.lineJoin = 'round';
            ctx.strokeText(it.ch, 0, 0);
          }
        } else {
          const r = EZ.rng(it.seed);
          const amp = (s.wobble / 100) * it.unit * 0.022;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          for (const st of it.v.strokes) {
            const ph1 = r() * 6.283,
              ph2 = r() * 6.283,
              f1 = 0.6 + r() * 1.6,
              f2 = 0.6 + r() * 1.6;
            const ox = (r() - 0.5) * amp,
              oy = (r() - 0.5) * amp;
            const n = st.length;
            const wm = 1 + (r() - 0.5) * 0.2 * pv;
            const pts = st.map((p, i) => {
              const t = i / Math.max(1, n - 1);
              return [
                (p[0] - it.bb.minX) * it.unit + ox + amp * Math.sin(t * f1 * 6.283 + ph1),
                (p[1] - G.BASE) * it.unit + oy + amp * Math.sin(t * f2 * 6.283 + ph2),
                p[2],
              ];
            });
            EZ.drawStroke(ctx, pts, s.penWidth * wm, pv);
          }
        }
        ctx.restore();
      },
    };
  }

  /** Разбивает текст на строки с переносом по словам */
  function layout(text, prov, maxW, s) {
    const lines = [];
    const paras = String(text || '').replace(/\r/g, '').replace(/\t/g, '    ').split('\n');
    for (const para of paras) {
      let line = { items: [], w: 0, indent: 0 };
      if (s.indent && para.trim()) line.w = line.indent = s.size * 2.2;
      const words = para.split(' ');
      words.forEach((word, wi) => {
        const items = Array.from(word).map((ch) => prov.item(ch));
        const ww = items.reduce((a, it) => a + it.w, 0);
        let sp = wi > 0 ? prov.space() : 0;
        if (line.items.length && line.w + sp + ww > maxW) {
          lines.push(line);
          line = { items: [], w: 0, indent: 0 };
          sp = 0;
        }
        if (line.items.length && sp) {
          line.items.push({ t: 'sp', w: sp });
          line.w += sp;
        }
        if (ww > maxW - line.w) {
          for (const it of items) {
            if (line.items.length && line.w + it.w > maxW) {
              lines.push(line);
              line = { items: [], w: 0, indent: 0 };
            }
            line.items.push(it);
            line.w += it.w;
          }
        } else {
          line.items.push(...items);
          line.w += ww;
        }
      });
      lines.push(line);
    }
    return lines;
  }

  function drawLines(ctx, lines, prov, geo, s, rand) {
    const inkRGB = EZ.hexToRgb(s.ink);
    const paperRGB = EZ.hexToRgb(s.paperColor || '#ffffff');
    const inkVar = (s.inkVar || 0) / 100;
    let ink = 1;
    lines.forEach((line, i) => {
      const baseY = geo.top + (i + 1) * s.lineHeight - 1;
      const ang = (rand() - 0.5) * 2 * (s.lineDrift / 100) * 0.012;
      let x = geo.left + line.indent + rand() * s.lineDrift * 0.06;
      for (const it of line.items) {
        if (it.t === 'sp') {
          x += it.w;
          continue;
        }
        // «чернила»: плавно то гуще, то бледнее
        ink = EZ.clamp(ink + (rand() - 0.5) * 0.14 * inkVar, 1 - inkVar * 0.45, 1);
        const y = baseY + (x - geo.left) * Math.tan(ang);
        prov.draw(ctx, it, x, y, EZ.mixRgb(inkRGB, paperRGB, 1 - ink));
        x += it.w;
      }
    });
  }

  function geometry(W, H, s) {
    const lh = s.lineHeight;
    const cell = lh / 2;
    const top = Math.max(cell, Math.round((H * 0.055) / cell) * cell);
    const marginX = s.margin ? Math.round((W * 0.11) / cell) * cell : 0;
    const left = s.margin ? marginX + Math.max(8, cell * 0.5) : Math.round(W * 0.07);
    const right = W - Math.round(W * 0.05);
    const rows = Math.max(1, Math.floor((H - top - H * 0.04) / lh));
    return { W, H, top, left, right, rows, marginX, cell };
  }

  function drawPaper(ctx, geo, s) {
    const { W, H, cell } = geo;
    ctx.fillStyle = s.paperColor || '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 1;
    if (s.paper === 'grid') {
      ctx.strokeStyle = 'rgba(70,130,200,0.32)';
      ctx.beginPath();
      const x0 = (W % cell) / 2;
      for (let x = x0; x <= W; x += cell) {
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, H);
      }
      for (let y = geo.top % cell; y <= H; y += cell) {
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(W, Math.round(y) + 0.5);
      }
      ctx.stroke();
    } else if (s.paper === 'lined') {
      ctx.strokeStyle = 'rgba(70,120,200,0.42)';
      ctx.beginPath();
      for (let k = 1; k <= geo.rows; k++) {
        const y = Math.round(geo.top + k * s.lineHeight) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
      }
      ctx.stroke();
    }
    if (s.margin) {
      ctx.strokeStyle = 'rgba(215,55,60,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(geo.marginX + 0.5, 0);
      ctx.lineTo(geo.marginX + 0.5, H);
      ctx.stroke();
    }
  }

  /** Эффект «фото/скана»: шум бумаги, неравномерное освещение */
  function scanEffect(ctx, W, H, seed) {
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const r = EZ.rng(seed);
    for (let i = 0; i < d.length; i += 4) {
      const n = (r() - 0.5) * 16;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n - 3;
    }
    ctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const g = ctx.createRadialGradient(W * (0.4 + r() * 0.2), H * (0.35 + r() * 0.2), Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.8);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(185,178,160,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const side = ctx.createLinearGradient(0, 0, W, 0);
    side.addColorStop(0, 'rgba(160,155,145,0.35)');
    side.addColorStop(0.12, 'rgba(255,255,255,0)');
    ctx.fillStyle = side;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  /** Рендер всех страниц. Возвращает { canvases, missing } */
  EZ.renderPages = async function (text, hw, s) {
    await ensureFonts(familiesFor(hw, s), text);
    const P = EZ.PAPERS[s.paperSize] || EZ.PAPERS.a4;
    const geo = geometry(P.w, P.h, s);
    const prov = makeProvider(hw, s, EZ.rng(s.seed));
    const lines = layout(text, prov, geo.right - geo.left, s);
    const pages = [];
    for (let i = 0; i < lines.length; i += geo.rows) pages.push(lines.slice(i, i + geo.rows));
    if (!pages.length) pages.push([]);
    const canvases = pages.map((pl, pi) => {
      const c = document.createElement('canvas');
      c.width = P.w;
      c.height = P.h;
      const ctx = c.getContext('2d');
      drawPaper(ctx, geo, s);
      drawLines(ctx, pl, prov, geo, s, EZ.rng(s.seed + (pi + 1) * 7919));
      if (s.scan) scanEffect(ctx, P.w, P.h, s.seed + pi);
      return c;
    });
    return { canvases, missing: Array.from(prov.missing) };
  };

  /** Образец почерка на небольшом холсте (карточки библиотеки, проверка в мастерской) */
  EZ.renderSample = async function (canvas, text, hw, s) {
    await ensureFonts(familiesFor(hw, s), text);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const rand = EZ.rng(s.seed || 1);
    const prov = makeProvider(hw, s, rand);
    const geo = { top: s.top || 0, left: 10, right: canvas.width - 10 };
    const lines = layout(text, prov, geo.right - geo.left, { ...s, indent: false });
    drawLines(ctx, lines, prov, geo, s, rand);
    return Array.from(prov.missing);
  };
})();
