/* Čitanje certifikata o ispitivanju materijala (EN 10204 3.1).
 * Ulaz: riječi s položajem na stranici {t, x, y, w, h, page} iz pdf.js-a ili OCR-a (Tesseract).
 * Izlaz: kemijski sastav (jedan ili više redaka, npr. analiza taline i proizvoda), CEV, oznaka čelika,
 * broj taline i ReH. Sve vrijednosti korisnik potvrđuje prije upisa u obrazac.
 */
(function (root) {
  'use strict';

  // Uobičajeni rasponi u masenim %, za prepoznavanje faktora (vrijednosti zapisane ×100, ×1000…)
  const RANGE = {
    C: [0.005, 0.6], Si: [0, 1.2], Mn: [0.05, 2.2], P: [0, 0.06], S: [0, 0.06], Al: [0, 0.12], Cu: [0, 0.8],
    Cr: [0, 2.5], Ni: [0, 3.5], Mo: [0, 1.2], V: [0, 0.25], Nb: [0, 0.12], Ti: [0, 0.12], N: [0, 0.025],
    B: [0, 0.006], Ca: [0, 0.01], Sn: [0, 0.05], As: [0, 0.05], Co: [0, 0.1], W: [0, 0.2], Zr: [0, 0.05],
    CEV: [0.15, 0.95], CET: [0.1, 0.6], PCM: [0.08, 0.45]
  };
  const ALIAS = {
    C: 'C', SI: 'Si', MN: 'Mn', P: 'P', S: 'S', AL: 'Al', ALT: 'Al', ALS: 'Al', 'AL(T)': 'Al', 'AL(S)': 'Al',
    CU: 'Cu', CR: 'Cr', NI: 'Ni', MO: 'Mo', V: 'V', NB: 'Nb', TI: 'Ti', N: 'N', B: 'B', CA: 'Ca', SN: 'Sn',
    AS: 'As', CO: 'Co', W: 'W', ZR: 'Zr',
    CEV: 'CEV', CE: 'CEV', CEQ: 'CEV', 'CE(IIW)': 'CEV', CEIIW: 'CEV', CET: 'CET', PCM: 'PCM'
  };
  const FACTORS = [1, 0.1, 0.01, 0.001, 0.0001];
  // Poznate OCR zamjene simbola u zaglavlju (M se čita kao H, fi, N…); vrijede samo uz oznaku %
  const OCR_SYM = { FIN: 'Mn', FN: 'Mn', HN: 'Mn', NN: 'Mn', RN: 'Mn', MM: 'Mn', HIN: 'Mn', HO: 'Mo', H0: 'Mo', MO0: 'Mo', SL: 'Si', S1: 'Si', '5I': 'Si', '51': 'Si',
    CT: 'Cr', OR: 'Cr', GR: 'Cr', CN: 'Cu', GU: 'Cu', NL: 'Ni', N1: 'Ni', TL: 'Ti', T1: 'Ti', NO: 'Mo', AI: 'Al', A1: 'Al' };

  function normSym(t) {
    let u = t.replace(/[%:.,;|\-_'"’”“~*]/g, '').replace(/^\((.*)\)$/, '$1').trim();
    u = u.replace(/^[^A-Za-z(]+(?=[A-Za-z]{2,}$)/, '');   // smeće ispred simbola ("§86CEV")
    if (!u || u.length > 7) return null;
    // OCR zna udvostručiti slovo ("Cc", "Ss", "Vv")
    const dbl = u.match(/^([A-Za-z])\1$/i); if (dbl) u = dbl[1];
    const k = u.toUpperCase();
    return ALIAS[k] || null;
  }

  // OCR često iskrivi simbol u zaglavlju (npr. "Man%" za Mn%). Za riječi s oznakom % prihvaća se
  // simbol čija se slova pojavljuju redom u riječi, uz najviše dva suvišna znaka.
  const FUZZY = ['Si', 'Mn', 'Cr', 'Ni', 'Mo', 'Cu', 'Nb', 'Ti', 'Al', 'C', 'P', 'S', 'V', 'N', 'B'];
  function fuzzySym(t) {
    if (!/%/.test(t)) return null;
    const w = t.replace(/[^A-Za-z]/g, '').toLowerCase();
    if (!w || w.length > 4) return null;
    for (const sym of FUZZY) {
      const k = sym.toLowerCase();
      if (w[0] !== k[0] || w.length > k.length + 2) continue;
      let i = 0; for (const ch of w) if (ch === k[i]) i++;
      if (i === k.length) return sym;
    }
    return null;
  }

  function parseNum(t) {
    let s = String(t).trim().replace(/[≤<]/g, '').replace(/^[~≈]/, '');
    s = s.replace(/O(?=[\d,.])|(?<=[\d,.])O/g, '0');          // česta OCR zamjena O → 0
    if (!/^[-+]?(\d+([.,]\d+)?|[.,]\d+)$/.test(s)) return null;
    const v = parseFloat(s.replace(',', '.'));
    return Number.isFinite(v) ? { v, lt: /[≤<]/.test(t) } : null;
  }

  // Riječi koje sadrže razmake razdvaja u pojedinačne, s procijenjenim položajem
  function splitTokens(tokens) {
    const out = [];
    for (const tk of tokens) {
      const txt = String(tk.t || '');
      if (!txt.trim()) continue;
      const parts = txt.split(/\s+/).filter(Boolean);
      if (parts.length === 1) { out.push({ ...tk, t: parts[0] }); continue; }
      const len = txt.length; let idx = 0;
      for (const part of parts) {
        const i = txt.indexOf(part, idx); idx = i + part.length;
        const x = tk.x + tk.w * (i / len), w = tk.w * (part.length / len);
        out.push({ ...tk, t: part, x, w });
      }
    }
    return out;
  }

  function groupLines(tokens) {
    const hs = tokens.map(t => t.h).filter(h => h > 0).sort((a, b) => a - b);
    const hMed = hs.length ? hs[Math.floor(hs.length / 2)] : 10;
    const sorted = [...tokens].sort((a, b) => (a.page - b.page) || (a.y - b.y) || (a.x - b.x));
    const lines = [];
    for (const t of sorted) {
      const L = lines[lines.length - 1];
      if (L && L.page === t.page && Math.abs(L.y - t.y) < 0.55 * hMed) { L.tokens.push(t); L.y = (L.y * (L.tokens.length - 1) + t.y) / L.tokens.length; }
      else lines.push({ page: t.page, y: t.y, tokens: [t] });
    }
    lines.forEach(L => {
      L.tokens.sort((a, b) => a.x - b.x);
      // OCR razlomi "0,006" u "0," i "006": spajaju se dijelovi koji su blizu
      for (let i = 0; i < L.tokens.length - 1; i++) {
        const a = L.tokens[i], b = L.tokens[i + 1];
        if (/^\d{1,2}[.,]$/.test(a.t) && /^\d{1,5}$/.test(b.t) && b.x - (a.x + a.w) < 1.2 * hMed) {
          L.tokens.splice(i, 2, { ...a, t: a.t + b.t, w: b.x + b.w - a.x });
        }
      }
    });
    return { lines, hMed };
  }

  const cx = t => t.x + t.w / 2;

  function fitRange(sym, v, rowFactor) {
    const r = RANGE[sym]; if (!r) return { v, f: 1 };
    const base = v * rowFactor;
    if (base <= r[1]) return { v: base, f: rowFactor };
    for (const f of FACTORS) { const x = v * f; if (x <= r[1]) return { v: x, f }; }
    return { v: base, f: rowFactor, bad: true };
  }

  function rowFactorFrom(text) {
    const m = text.match(/[x×*]\s*10\s*(?:\^|e)?\s*-?\s*([1-4])\b|[x×*]\s*(10{1,4})\b/i);
    if (!m) return 1;
    const pow = m[1] ? +m[1] : m[2].length - 1;
    return Math.pow(10, -pow);
  }

  function parse(tokensIn, fullTextIn) {
    const tokens = splitTokens(tokensIn);
    const { lines, hMed } = groupLines(tokens);
    const fullText = fullTextIn || lines.map(L => L.tokens.map(t => t.t).join(' ')).join('\n');
    const warnings = [];
    const rows = [];

    // 1) zaglavlja kemijske analize. Glavni blok sadrži C i barem tri druga elementa; nastavni blok
    //    (npr. "Cr Ni Mo Cu V" ispod "C Si Mn P S") nastavlja retke prethodnog bloka.
    const blocks = [];
    let last = null;
    const repairLead = (str, sym, v) => {
      // OCR zamjenjuje vodeću 0 sa 6, 8 ili 9 ("6,017"): ako je vrijednost izvan raspona, pokuša se s 0
      const r = RANGE[sym];
      if (r && v > r[1] && /^[689][.,]\d/.test(str)) return { v: parseFloat('0' + str.slice(1).replace(',', '.')), fixed: true };
      return { v, fixed: false };
    };
    lines.forEach((L, li) => {
      let cols = [], fuzzy = 0;
      L.tokens.forEach((t, ti) => {
        const nxt = L.tokens[ti + 1];
        const pct = /%/.test(t.t) || (nxt && /^[%°]$/.test(nxt.t) && nxt.x - (t.x + t.w) < 2 * hMed);
        let s = normSym(t.t), fz = false;
        if (!s && pct) {
          const key = t.t.replace(/[%:.,;|\-_'"’”“~*]/g, '').toUpperCase();
          s = OCR_SYM[key] || fuzzySym(t.t.includes('%') ? t.t : t.t + '%'); fz = !!s;
        }
        if (s && !cols.some(c => c.sym === s)) { cols.push({ sym: s, x: cx(t), fuzzy: fz }); if (fz) fuzzy++; }
      });
      cols.sort((a, b) => a.x - b.x);
      const elems = cols.filter(c => !['CEV', 'CET', 'PCM'].includes(c.sym));
      const hasC = cols.some(c => c.sym === 'C');
      const isMain = elems.length >= 4 && hasC && (cols.some(c => c.sym === 'Mn') || elems.length - fuzzy >= 3);
      const isCont = !isMain && elems.length >= 3 && !hasC && last && last.page === L.page && L.y - last.endY < 8 * hMed;
      if (!isMain && !isCont) return;
      const gaps = cols.slice(1).map((c, i) => c.x - cols[i].x).filter(g => g > 0).sort((a, b) => a - b);
      const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 40;
      const headText = L.tokens.map(t => t.t).join(' ') + ' ' + ((lines[li - 1] && lines[li - 1].page === L.page) ? lines[li - 1].tokens.map(t => t.t).join(' ') : '');
      const hdrFactor = rowFactorFrom(headText);
      // "×100 / ×1000": glavni elementi ×100, mikrolegirni elementi i nečistoće ×1000 (B ×10000)
      const dual = /[x×*]\s*100\b[\s\S]*1000|[x×*]\s*1000\b[\s\S]*\b100\b/i.test(headText);
      const TRACE = ['P', 'S', 'Al', 'N', 'Nb', 'Ti', 'V', 'Ca', 'Sn', 'As', 'Zr'];
      const factorFor = sym => ['CEV', 'CET', 'PCM'].includes(sym) ? 1
        : dual ? (sym === 'B' ? 0.0001 : TRACE.includes(sym) ? 0.001 : 0.01) : hdrFactor;
      const firstCol = Math.min(...cols.map(c => c.x));
      const hdrLabel = L.tokens.filter(t => cx(t) < firstCol - 0.5 * gap && !normSym(t.t)).map(t => t.t).join(' ').trim();

      // 2) retci vrijednosti ispod zaglavlja
      const found = [];
      for (let k = li + 1; k < Math.min(lines.length, li + 9); k++) {
        const R = lines[k];
        if (R.page !== L.page || R.y - L.y > 14 * hMed) break;
        const nums = [], words = [];
        R.tokens.forEach(t => { const n = parseNum(t.t); if (n) nums.push({ ...n, x: cx(t), raw: t.t }); else words.push(t); });
        const symCount = R.tokens.filter(t => normSym(t.t) || fuzzySym(t.t)).length;
        if (symCount >= 3) break;                                   // sljedeće zaglavlje
        if (nums.length < 3) continue;
        const values = {}, flags = {};
        let used = 0;
        for (const n of nums) {
          let best = null, bd = Infinity;
          for (const c of cols) { const d = Math.abs(c.x - n.x); if (d < bd) { bd = d; best = c; } }
          if (best && bd < 0.6 * gap && values[best.sym] === undefined) {
            const rp = repairLead(n.raw.replace(/[≤<]/g, ''), best.sym, n.v);
            const fit = fitRange(best.sym, rp.v, factorFor(best.sym));
            values[best.sym] = +fit.v.toPrecision(4);
            if (rp.fixed) flags[best.sym] = 'ispravljeno: vodeća znamenka pročitana kao 0';
            if (fit.f !== 1) flags[best.sym] = 'preračunato ×' + fit.f;
            if (fit.bad) flags[best.sym] = 'izvan uobičajenog raspona';
            if (n.lt) flags[best.sym] = 'zapisano kao "<"';
            used++;
          }
        }
        if (used < 3) continue;
        if (isMain && values.C === undefined) continue;
        const label = words.filter(w => cx(w) < firstCol - 0.3 * gap).map(w => w.t).join(' ').replace(/[|\[\]_]/g, ' ').replace(/\s+/g, ' ').trim();
        if (/\b(min|max|spec|specified|required|zahtjev|zahtijevano|norma|soll|limit|grenz)/i.test(label)) continue;
        Object.keys(values).forEach(k2 => { const c = cols.find(q => q.sym === k2); if (c && c.fuzzy && !flags[k2]) flags[k2] = 'simbol nesigurno pročitan'; });
        found.push({ label, values, flags, y: R.y });
      }
      if (!found.length) return;
      const block = { page: L.page, headerY: L.y, gap, hMed, cols: cols.map(c => ({ sym: c.sym, x: c.x })), rows: [] };
      if (isMain) {
        const idx = found.map(f => {
          rows.push({ label: f.label || (found.length === 1 && hdrLabel) || ('redak ' + (rows.length + 1)), values: f.values, flags: f.flags, page: L.page });
          return rows.length - 1;
        });
        found.forEach((f, i) => block.rows.push({ y: f.y, row: idx[i] }));
        last = { page: L.page, endY: found[found.length - 1].y, idx };
      } else {
        found.forEach((f, i) => {
          const r = last.idx[i]; if (r === undefined) return;
          Object.assign(rows[r].values, f.values); Object.assign(rows[r].flags, f.flags);
          block.rows.push({ y: f.y, row: r });
        });
        last.endY = found[found.length - 1].y;
      }
      blocks.push(block);
    });

    if (!rows.length) warnings.push('Tablica kemijskog sastava nije prepoznata.');

    // 3) CEV iz tablice ili iz teksta
    let cev = null;
    const rowCev = rows.find(r => r.values.CEV !== undefined);
    if (rowCev) cev = rowCev.values.CEV;
    else {
      const re = /(CEV|CE\s*\(?IIW\)?|C\s?eq|CE)\b\s*[:=]?\s*[≤<]?\s*(\d?[.,]\d{1,3})/gi;
      let m;
      while ((m = re.exec(fullText))) {
        const v = parseFloat(m[2].replace(',', '.'));
        if (v >= RANGE.CEV[0] && v <= RANGE.CEV[1]) { cev = v; break; }
      }
    }

    // 4) oznaka čelika, broj taline, ReH
    const gm = fullText.match(/(?:^|[^A-Za-z0-9])[S$]\s?(235|275|355|420|460|500|550|620|690|890|960)\s?([A-Z]{1,2}\d?[A-Z]?\d?(?:\s?\+\s?[A-Z]{1,2})?)?/);   // OCR: S → $
    const grade = gm ? ('S' + gm[1] + (gm[2] ? gm[2].replace(/\s/g, '') : '')) : null;
    // broj taline: desno od oznake u istom retku ili ispod nje u stupcu
    let heat = null;
    const HEATW = /^(Heat|Cast|Charge|Schmelze|Talina|Šarža|Sarza)$/i, HEATV = t => /^[A-Z0-9][A-Z0-9-]{3,}$/i.test(t) && /\d/.test(t) && !/^\d+[.,]\d+$/.test(t);
    for (let li = 0; li < lines.length && !heat; li++) {
      const L = lines[li];
      const ti = L.tokens.findIndex(t => HEATW.test(t.t.replace(/[:.]/g, '')));
      if (ti < 0) continue;
      let lab = L.tokens[ti], j = ti + 1;
      if (L.tokens[j] && /^(No\.?|Nr\.?|br\.?|number|broj|N°)[:.]?$/i.test(L.tokens[j].t)) { lab = { ...lab, w: L.tokens[j].x + L.tokens[j].w - lab.x }; j++; }
      if (L.tokens[j] && /^[:#]$/.test(L.tokens[j].t)) j++;
      if (L.tokens[j] && HEATV(L.tokens[j].t) && L.tokens[j].x - (lab.x + lab.w) < 6 * hMed) { heat = L.tokens[j].t; break; }
      for (let k = li + 1; k < Math.min(lines.length, li + 3) && !heat; k++) {
        if (lines[k].page !== L.page) break;
        const c = lines[k].tokens.filter(t => HEATV(t.t) && Math.abs(cx(t) - cx(lab)) < Math.max(lab.w, 4 * hMed))
          .sort((a, b) => Math.abs(cx(a) - cx(lab)) - Math.abs(cx(b) - cx(lab)))[0];
        if (c) heat = c.t;
      }
    }
    if (!heat) {
      const hm = fullText.match(/(Heat|Cast|Charge|Schmelze|Talina|Šarža|Sarza)[ \t]*(No\.?|Nr\.?|br\.?|number|broj)?[ \t]*[:.#]?[ \t]*([A-Z0-9][A-Z0-9-]{3,})/i);
      if (hm && /\d/.test(hm[3])) heat = hm[3];
    }

    let ReH = null;
    for (let li = 0; li < lines.length && ReH === null; li++) {
      const L = lines[li];
      const h = L.tokens.find(t => /^(ReH|Rp0[.,]?2|Re|R[eE]H?\(?MPa\)?|Yield)/.test(t.t));
      if (!h) continue;
      for (let k = li + 1; k < Math.min(lines.length, li + 6); k++) {
        if (lines[k].page !== L.page) break;
        let best = null, bd = Infinity;
        lines[k].tokens.forEach(t => {
          const n = parseNum(t.t); if (!n || n.v < 150 || n.v > 1300) return;
          const d = Math.abs(cx(t) - cx(h)); if (d < bd) { bd = d; best = n.v; }
        });
        if (best !== null && bd < 4 * hMed + h.w) { ReH = best; break; }
      }
    }

    return { rows, cev, grade, heat, ReH, warnings, blocks, lineCount: lines.length };
  }

  // Oznaka iz certifikata -> materijal u programu
  function presetFor(grade) {
    if (!grade) return null;
    const n = grade.match(/S(\d{3})/); if (!n) return null;
    return { 235: 'S235JR', 355: 'S355J2', 460: 'S460M', 690: 'S690QL' }[n[1]] || null;
  }

  // ---- pomoćne funkcije za čitanje tablice po ćelijama ----
  // Simbol iz teksta jedne ćelije zaglavlja (OCR s ograničenim skupom slova)
  function symFromCell(t) {
    const raw = String(t || '').trim();
    if (!raw) return null;
    const s = normSym(raw); if (s) return s;
    const letters = raw.replace(/[^A-Za-z]/g, '');
    if (/%/.test(raw) || letters.length <= 2) return fuzzySym(raw.includes('%') ? raw : raw + '%');
    return null;
  }
  // Normalizacija broja pročitanog iz ćelije: "0007" -> "0.007", "040" -> "0.40", ",25" -> "0.25"
  function normCellNum(t) {
    let s = String(t || '').replace(/\s+/g, '');
    const lt = /^[<≤]/.test(s); s = s.replace(/^[<≤]/, '');
    if (!s) return null;
    if (/[.,]/.test(s)) {
      s = s.replace(',', '.'); if (s.startsWith('.')) s = '0' + s;
      if (!/^\d{1,2}\.\d{1,5}$/.test(s)) return null;
    } else {
      if (!/^\d{1,5}$/.test(s)) return null;
      if (s.length >= 2 && s[0] === '0') s = '0.' + s.slice(1);
    }
    return { s, lt };
  }
  // Glasanje između varijanti; kraći rezultat koji je početak duljega pribraja se duljemu
  function voteNumbers(list) {
    const c = new Map();
    list.forEach(t => { const n = normCellNum(t); if (n) c.set(n.s, (c.get(n.s) || 0) + 1); });
    if (!c.size) return null;
    const keys = [...c.keys()];
    const score = new Map(keys.map(k => [k, c.get(k)]));
    keys.forEach(a => keys.forEach(b => {
      if (a !== b && b.length > a.length && b.startsWith(a) && a.includes('.')) score.set(b, score.get(b) + c.get(a));
    }));
    let best = null; score.forEach((v, k) => { if (!best || v > best.v || (v === best.v && k.length > best.k.length)) best = { k, v }; });
    const total = list.length;
    // slaganje = koliko je očitanja dalo točno odabranu vrijednost (bez pribrojenih kraćih)
    return { value: parseFloat(best.k), text: best.k, agree: c.get(best.k), total };
  }
  function voteSymbols(list) {
    const c = new Map();
    list.forEach(t => { const s = symFromCell(t); if (s) c.set(s, (c.get(s) || 0) + 1); });
    let best = null; c.forEach((v, k) => { if (!best || v > best.v) best = { k, v }; });
    return best ? best.k : null;
  }
  const SPEC_ROW = /\b(min|max|spec|specified|required|zahtjev|zahtijevano|norma|soll|limit|grenz)/i;

  const api = { parse, presetFor, parseNum, splitTokens, groupLines, RANGE,
    symFromCell, normCellNum, voteNumbers, voteSymbols, fitRange, SPEC_ROW };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Cert = api;
})(typeof window !== 'undefined' ? window : globalThis);
