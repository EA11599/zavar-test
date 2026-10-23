/* Surogatni (hibridni) model zaostalih naprezanja.
 *
 * Analitički model (physics.js) daje osnovu, a Gaussova procesna regresija (GPR) uči koliko se rezultati
 * proračuna u CalculiX-u od nje razlikuju. Predviđanje = analitički model + naučeno odstupanje, uz
 * nesigurnost koju daje GPR. Usporedbe radi uči se i "čisti" GPR, koji fizikalni model ne koristi.
 *
 * Ulazi modela: unos topline Q (kJ/mm), temperatura komada T0 (°C), debljina d (mm), granica tečenja Re (MPa).
 * Izlazi: najveće uzdužno naprezanje σx (u proračunima je u ZUT-u, nekoliko mm od osi), poluširina vlačne
 * zone b (prvi prolaz σx kroz nulu), t8/5 i poprečno naprezanje σy u sredini zavara. Vrijednost σx u samoj
 * osi zavara nije izlaz modela jer jako ovisi o gustoći mreže.
 */
(function (root) {
  'use strict';

  const FEATS = ['Q', 'T0', 'd', 'Re'];
  const FEAT_LAB = { Q: 'Q, kJ/mm', T0: 'T₀, °C', d: 'd, mm', Re: 'Re, MPa' };

  // u za koji Masubuchi–Martinov oblik (1 − u²)·exp(−u²/2) iznosi 0,5
  const U50 = (() => { let a = 0, b = 1; for (let i = 0; i < 60; i++) { const m = (a + b) / 2; ((1 - m * m) * Math.exp(-m * m / 2) > 0.5) ? a = m : b = m; } return (a + b) / 2; })();

  /* ---------- linearna algebra (mali sustavi) ---------- */
  function cholesky(A) {
    const n = A.length, L = A.map(r => r.map(() => 0));
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) { if (s <= 0) return null; L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j];
    }
    return L;
  }
  function cholSolve(L, b) {
    const n = L.length, y = new Array(n), x = new Array(n);
    for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
    for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
    return x;
  }
  function cholInverse(L) {
    const n = L.length, inv = [];
    for (let j = 0; j < n; j++) { const e = new Array(n).fill(0); e[j] = 1; inv.push(cholSolve(L, e)); }
    return inv;                                              // simetrična, stupci = retci
  }

  /* ---------- Gaussova procesna regresija ---------- */
  // Jezgra: kvadratna eksponencijalna s posebnom duljinom za svaki ulaz (ARD), ulazi skalirani na [0, 1].
  const kern = (a, b, h) => { let s = 0; for (let i = 0; i < a.length; i++) s += ((a[i] - b[i]) / h.ell[i]) ** 2; return h.sf2 * Math.exp(-0.5 * s); };

  function gpFit(X, y, opts = {}) {
    const n = X.length, D = X[0].length;
    const mu = y.reduce((s, v) => s + v, 0) / n;
    const sd = Math.sqrt(y.reduce((s, v) => s + (v - mu) ** 2, 0) / n) || 1;
    const yn = y.map(v => (v - mu) / sd);
    // log-marginalna vjerodostojnost (Rasmussen i Williams, izraz 2.30)
    const lml = th => {
      const h = unpack(th);
      const K = X.map((a, i) => X.map((b, j) => kern(a, b, h) + (i === j ? h.sn2 : 0)));
      const L = cholesky(K); if (!L) return -Infinity;
      const al = cholSolve(L, yn);
      let ld = 0; for (let i = 0; i < n; i++) ld += Math.log(L[i][i]);
      // blagi priori na hiperparametre (sprječava duljine koje se rastegnu u beskonačno)
      const prior = th.slice(0, D).reduce((s, t) => s - 0.5 * ((t - Math.log(0.5)) / 1.5) ** 2, 0);
      return -0.5 * yn.reduce((s, v, i) => s + v * al[i], 0) - ld + prior;
    };
    const unpack = th => ({ ell: th.slice(0, D).map(Math.exp), sf2: Math.exp(th[D]), sn2: Math.exp(th[D + 1]) });
    // th = [log ℓ₁…ℓ_D, log σf², log σn²]; koordinatni spust zlatnim rezom po svakom parametru
    let th = [...new Array(D).fill(Math.log(0.5)), 0, Math.log(0.01)];
    const lo = [...new Array(D).fill(Math.log(0.05)), Math.log(0.05), Math.log(1e-4)];
    const hi = [...new Array(D).fill(Math.log(20)), Math.log(20), Math.log(0.5)];
    if (opts.fixed) th = opts.fixed.slice();
    else for (let sweep = 0; sweep < (opts.sweeps || 6); sweep++) {
      let moved = 0;
      for (let p = 0; p < th.length; p++) {
        let a = lo[p], b = hi[p];
        const f = x => { const t = th.slice(); t[p] = x; return lml(t); };
        for (let k = 0; k < 24; k++) { const m1 = b - (b - a) / 1.618, m2 = a + (b - a) / 1.618; if (f(m1) > f(m2)) b = m2; else a = m1; }
        const nv = (a + b) / 2; if (f(nv) > lml(th)) { moved += Math.abs(nv - th[p]); th[p] = nv; }
      }
      if (moved < 1e-3) break;
    }
    const h = unpack(th);
    const K = X.map((a, i) => X.map((b, j) => kern(a, b, h) + (i === j ? h.sn2 : 0)));
    const L = cholesky(K);
    const alpha = cholSolve(L, yn);
    const Kinv = cholInverse(L);
    // "izostavi jedan" u zatvorenom obliku (Rasmussen i Williams, izraz 5.12), uz iste hiperparametre
    const loo = yn.map((v, i) => ({ mean: mu + sd * (v - alpha[i] / Kinv[i][i]), sd: sd * Math.sqrt(1 / Kinv[i][i]) }));
    return {
      X, th, h, mu, sd, L, alpha, loo, lml: lml(th),
      predict(x) {
        const ks = X.map(a => kern(a, x, h));
        const m = ks.reduce((s, k, i) => s + k * alpha[i], 0);
        const v = cholSolve(L, ks);
        const var_ = Math.max(1e-12, h.sf2 - ks.reduce((s, k, i) => s + k * v[i], 0));
        return { mean: mu + sd * m, sd: sd * Math.sqrt(var_ + h.sn2), sdLatent: sd * Math.sqrt(var_) };
      }
    };
  }

  /* ---------- analitički model za iste ulaze ---------- */
  // Osnovni slučaj kao u skupu simulacija: MAG, sučeljeni spoj, B = 120 mm, L = 200 mm, srednja ukliještenost
  function baseCase(W, x, extra = {}) {
    return { proc: 'MAG', I: x.I, U: x.U, v: x.v, d: x.d, B: 120, L: 200, joint: 'butt', restr: 'mid', T0: x.T0, Ta: 20, RH: 50,
      TpWPS: 0, HD: 5, ...W.MAT.S355J2, Re: x.Re, comp: { ...W.MAT.S355J2.comp }, ...extra };
  }
  function analytic(W, p) {
    const T0 = Math.min(p.T0, 450);
    const M = W.stressModels(p, T0);
    const e = W.evaluate({ ...p, corr: undefined, weights: undefined });
    return { sxMax: M.MM.peak, b0: M.MM.b, t85: e.t85, syMid: M.TR.at(p.L / 2), Re: p.Re };
  }

  /* ---------- izlazi: kako se uči odstupanje ---------- */
  // fwd: iz rezultata CalculiX-a i analitičkog modela u veličinu koju uči GPR; inv: natrag u fizikalnu veličinu.
  // Omjeri se uče u logaritmu, pa predviđanje ostaje pozitivno; naprezanja se mjere u jedinicama Re.
  const OUTS = [
    { id: 'sxMax', lab: 'Najveći σx', unit: 'MPa', dec: 0,
      fwd: (c, a) => c / a.Re, inv: (z, a) => z * a.Re,
      raw: c => c, rawInv: z => z,
      lim: (v, a) => Math.min(Math.max(v, 0), 1.3 * a.Re) },             // očvršćenje (10 %) i višeosno stanje; u proračunima do 1,17·Re
    { id: 'b0', lab: 'Poluširina vlačne zone b', unit: 'mm', dec: 1,
      fwd: (c, a) => Math.log(c / a.b0), inv: (z, a) => a.b0 * Math.exp(z),
      raw: c => Math.log(c), rawInv: z => Math.exp(z), lim: v => v },
    { id: 't85', lab: 't8/5', unit: 's', dec: 1,
      fwd: (c, a) => Math.log(c / a.t85), inv: (z, a) => a.t85 * Math.exp(z),
      raw: c => Math.log(c), rawInv: z => Math.exp(z), lim: v => v },
    { id: 'syMid', lab: 'σy u sredini zavara', unit: 'MPa', dec: 0,
      fwd: (c, a) => (c - a.syMid) / a.Re, inv: (z, a) => a.syMid + z * a.Re,
      raw: c => c, rawInv: z => z,
      lim: (v, a) => Math.min(Math.max(v, -1.1 * a.Re), 1.1 * a.Re) }
  ];

  // Skaliranje ulaza na [0, 1] prema rasponu skupa za učenje
  function scaler(rows) {
    const r = {}; FEATS.forEach(f => { const v = rows.map(q => q.x[f]); r[f] = [Math.min(...v), Math.max(...v)]; });
    return { range: r, s: x => FEATS.map(f => (x[f] - r[f][0]) / ((r[f][1] - r[f][0]) || 1)) };
  }

  // rows: [{ x: {I, U, v, Q, T0, d, Re}, y: {sxMax, b0, t85, syMid} }]
  function train(W, rows, opts = {}) {
    const S = scaler(rows);
    const ana = rows.map(q => analytic(W, baseCase(W, q.x)));
    const X = rows.map(q => S.s(q.x));
    const models = {};
    OUTS.forEach(o => {
      const ok = rows.map((q, i) => Number.isFinite(q.y[o.id]) && Number.isFinite(ana[i][o.id]) && q.y[o.id] > (o.id === 'syMid' ? -Infinity : 0));
      const idx = ok.map((v, i) => v ? i : -1).filter(i => i >= 0);
      const Xs = idx.map(i => X[i]);
      // unaprijed naučeni hiperparametri (iz datoteke s podacima) ubrzavaju pokretanje stranice
      const fx = opts.thetas && opts.thetas[o.id];
      const hy = gpFit(Xs, idx.map(i => o.fwd(rows[i].y[o.id], ana[i])), fx ? { fixed: fx.hy } : opts);
      const pu = gpFit(Xs, idx.map(i => o.raw(rows[i].y[o.id], ana[i])), fx ? { fixed: fx.pu } : opts);
      // pogreške "izostavi jedan" u fizikalnim jedinicama
      const err = { ana: [], hyb: [], pure: [] }, pts = [];
      idx.forEach((i, k) => {
        const c = rows[i].y[o.id], a = ana[i];
        const hm = o.lim(o.inv(hy.loo[k].mean, a), a), pm = o.lim(o.rawInv(pu.loo[k].mean, a), a);
        const lo = o.lim(o.inv(hy.loo[k].mean - 1.96 * hy.loo[k].sd, a), a), up = o.lim(o.inv(hy.loo[k].mean + 1.96 * hy.loo[k].sd, a), a);
        const plo = o.lim(o.rawInv(pu.loo[k].mean - 1.96 * pu.loo[k].sd, a), a), pup = o.lim(o.rawInv(pu.loo[k].mean + 1.96 * pu.loo[k].sd, a), a);
        err.ana.push(a[o.id] - c); err.hyb.push(hm - c); err.pure.push(pm - c);
        pts.push({ ccx: c, ana: a[o.id], hyb: hm, pure: pm, lo: Math.min(lo, up), up: Math.max(lo, up), plo: Math.min(plo, pup), pup: Math.max(plo, pup), i });
      });
      const mae = a => a.reduce((s, v) => s + Math.abs(v), 0) / a.length;
      const M_ = { ana: mae(err.ana), hyb: mae(err.hyb), pure: mae(err.pure) };
      // za svaku veličinu koristi se model s manjom pogreškom "izostavi jedan" (hibridni ako su jednaki)
      const sel = (opts.sel && opts.sel[o.id]) || (M_.pure < M_.hyb ? 'pure' : 'hyb');
      pts.forEach(q => { q.val = sel === 'hyb' ? q.hyb : q.pure; q.vlo = sel === 'hyb' ? q.lo : q.plo; q.vup = sel === 'hyb' ? q.up : q.pup; });
      const cover = pts.filter(q => q.ccx >= q.vlo && q.ccx <= q.vup).length / pts.length;
      models[o.id] = { out: o, hy, pu, n: idx.length, mae: M_, sel, cover, pts, ell: (sel === 'hyb' ? hy : pu).h.ell };
    });
    const thetas = {}; OUTS.forEach(o => { thetas[o.id] = { hy: models[o.id].hy.th, pu: models[o.id].pu.th }; });
    return { S, models, n: rows.length, rows, thetas };
  }

  // Predviđanje za proizvoljne ulaze (p iz obrasca); vraća analitičku, hibridnu i čistu GPR vrijednost s 95 % intervalom
  function predict(W, M, p) {
    const x = { Q: W.heatInput(p), T0: p.T0, d: p.d, Re: p.Re };
    const a = analytic(W, baseCase(W, { ...x, I: p.I, U: p.U, v: p.v }));
    const z = M.S.s(x);
    const out = {}; let maxRel = 0;
    OUTS.forEach(o => {
      const m = M.models[o.id];
      const ph = m.hy.predict(z), pp = m.pu.predict(z);
      const v1 = o.lim(o.inv(ph.mean - 1.96 * ph.sd, a), a), v2 = o.lim(o.inv(ph.mean + 1.96 * ph.sd, a), a);
      // relativna nesigurnost u odnosu na tipičnu nesigurnost na točkama za učenje
      const typ = m.hy.loo.reduce((s, q) => s + q.sd, 0) / m.hy.loo.length;
      maxRel = Math.max(maxRel, ph.sd / typ);
      const w1 = o.lim(o.rawInv(pp.mean - 1.96 * pp.sd, a), a), w2 = o.lim(o.rawInv(pp.mean + 1.96 * pp.sd, a), a);
      const q = { ana: a[o.id], hyb: o.lim(o.inv(ph.mean, a), a), lo: Math.min(v1, v2), up: Math.max(v1, v2),
        pure: o.lim(o.rawInv(pp.mean, a), a), plo: Math.min(w1, w2), pup: Math.max(w1, w2), sdRel: ph.sd / typ, sel: m.sel };
      q.val = m.sel === 'hyb' ? q.hyb : q.pure; q.vlo = m.sel === 'hyb' ? q.lo : q.plo; q.vup = m.sel === 'hyb' ? q.up : q.pup;
      out[o.id] = q;
    });
    const outside = FEATS.filter(f => x[f] < M.S.range[f][0] - 1e-9 || x[f] > M.S.range[f][1] + 1e-9);
    return { x, a, out, outside, maxRel };
  }

  // Raspodjela σx po surogatnom modelu: Masubuchi–Martinov oblik s predviđenim najvećim naprezanjem i poluširinom b.
  // Oblik ne prikazuje sniženje u samom zavaru (M-oblik), nego omotnicu raspodjele.
  function profile(pred) {
    const pk = pred.out.sxMax.val, b = pred.out.b0.val;
    return y => pk * (1 - (y / b) ** 2) * Math.exp(-0.5 * (y / b) ** 2);
  }

  // Provjera izvan raspona učenja: model se uči samo na nižoj polovici jednog ulaza, a provjerava na višoj
  function extrapolation(W, rows) {
    const splits = [['Q', 1.35], ['T0', 100], ['d', 16], ['Re', 550]];
    return splits.map(([f, cut]) => {
      const tr = rows.filter(r => r.x[f] < cut), te = rows.filter(r => r.x[f] >= cut);
      const M = train(W, tr);
      const res = {};
      OUTS.forEach(o => {
        const e = { ana: 0, hyb: 0, pure: 0 }; let n = 0;
        te.forEach(r => { if (!Number.isFinite(r.y[o.id])) return; n++; const q = predict(W, M, baseCase(W, r.x)).out[o.id];
          e.ana += Math.abs(q.ana - r.y[o.id]); e.hyb += Math.abs(q.hyb - r.y[o.id]); e.pure += Math.abs(q.pure - r.y[o.id]); });
        res[o.id] = { ana: e.ana / n, hyb: e.hyb / n, pure: e.pure / n, n };
      });
      return { f, cut, nTrain: tr.length, nTest: te.length, res };
    });
  }

  // Pravilo odabira: hibridni model, osim ako je čisti GPR bolji i unutar raspona ("izostavi jedan") i izvan njega
  function chooseModels(M, EX) {
    const sel = {};
    OUTS.forEach(o => {
      const m = M.models[o.id], ex = EX.reduce((s, e) => ({ h: s.h + e.res[o.id].hyb, p: s.p + e.res[o.id].pure }), { h: 0, p: 0 });
      sel[o.id] = (m.mae.pure < m.mae.hyb && ex.p < ex.h) ? 'pure' : 'hyb';
    });
    return sel;
  }

  const api = { chooseModels, extrapolation, FEATS, FEAT_LAB, OUTS, U50, cholesky, cholSolve, gpFit, train, predict, profile, analytic, baseCase };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SUR = api;
})(typeof window !== 'undefined' ? window : globalThis);
