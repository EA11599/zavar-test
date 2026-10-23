/* Izračuni za demo "Provjera parametara zavarivanja".
 * Nema ovisnosti o sučelju: isti kod koristi stranica (window.Weld) i testovi (Node).
 * Jedinice: temperatura °C, duljina mm, vrijeme s, snaga W, unos topline kJ/mm, naprezanje MPa.
 */
(function (root) {
  'use strict';

  // Termička iskoristivost postupka (EN 1011-1)
  const K = { MAG: 0.8, TIG: 0.6, REL: 0.8 };

  // Konvencionalna radna karakteristika U = a + b·I (EN 60974-1)
  const ULINE = { MAG: { a: 14, b: 0.05 }, TIG: { a: 10, b: 0.04 }, REL: { a: 20, b: 0.04 } };

  // Tipični razred difuzijskog vodika dodatnog materijala, ml/100 g
  const HD_DEFAULT = { MAG: 5, TIG: 5, REL: 10 };

  // Tipične vrijednosti (orijentacijski; u stvarnoj primjeni iz certifikata 3.1)
  const MAT = {
    S235JR: { Re: 235, group: 1, TpWPS: 0,   tmin: 6, tmax: 30, Tmax: 250,
      comp: { C: .15, Si: .20, Mn: .80, Cr: .05, Mo: .01, Ni: .05, Cu: .10, V: 0 } },
    S355J2: { Re: 355, group: 1, TpWPS: 50,  tmin: 8, tmax: 25, Tmax: 250,
      comp: { C: .17, Si: .30, Mn: 1.40, Cr: .05, Mo: .02, Ni: .05, Cu: .10, V: .01 } },
    S460M:  { Re: 460, group: 2, TpWPS: 75,  tmin: 8, tmax: 20, Tmax: 250,
      comp: { C: .12, Si: .35, Mn: 1.55, Cr: .05, Mo: .03, Ni: .20, Cu: .10, V: .06 } },
    S690QL: { Re: 690, group: 3, TpWPS: 100, tmin: 5, tmax: 15, Tmax: 200,
      comp: { C: .16, Si: .30, Mn: 1.20, Cr: .30, Mo: .30, Ni: .20, Cu: .05, V: .05 } }
  };

  // Najveća dopuštena tvrdoća HV10 prema skupini materijala (EN ISO 15614-1, bez toplinske obrade)
  const HV_LIMIT = { 1: 380, 2: 380, 3: 450 };

  // Toplinska svojstva čelika odabrana tako da se Rosenthalovo rješenje pri T0 = 0 °C
  // poklapa s koeficijentima izraza za t8/5 iz EN 1011-2 (6700 i 4300·10^5).
  const LAMBDA = 1000 / (2 * Math.PI * 6700);            // W/(mm·K)  ≈ 0,0238
  const RHOC = 1e6 / (4 * Math.PI * 4.3e8) / LAMBDA;     // J/(mm³·K) ≈ 0,0078
  const DIFF = LAMBDA / RHOC;                             // mm²/s     ≈ 3,1
  const E_MOD = 210000, ALPHA = 12e-6;                    // MPa, 1/K
  const T_MELT = 1500;

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

  /* ---------- osnovne veličine ---------- */

  // Toplinska iskoristivost: iz norme, ili kalibrirana iz izmjerenog toplinskog ciklusa (p.kEff)
  const kOf = p => (Number.isFinite(p.kEff) && p.kEff > 0) ? p.kEff : K[p.proc];

  function heatInput(p) {                  // kJ/mm
    const vmm = p.v * 10 / 60;             // cm/min -> mm/s
    return kOf(p) * p.U * p.I / vmm / 1000;
  }

  function arcPower(p) { return kOf(p) * p.U * p.I; }   // W, efektivna

  function coupledVoltage(proc, U0, I0, I) {
    return U0 + ULINE[proc].b * (I - I0);
  }

  function shapeFactor(joint) { return joint === 'butt' ? 0.9 : 0.67; }

  // EN 1011-2, dodatak D
  function t85EN(Q, T0, d, joint) {
    const a = 1 / (500 - T0), b = 1 / (800 - T0), F = shapeFactor(joint);
    const t3 = (6700 - 5 * T0) * Q * (a - b) * F;
    const t2 = (4300 - 4.3 * T0) * 1e5 * (Q * Q / (d * d)) * (a * a - b * b) * F;
    const dt = Math.sqrt((4300 - 4.3 * T0) * 1e5 * Q * (a * a - b * b) / ((6700 - 5 * T0) * (a - b)));
    const is2D = d < dt;
    return { t85: is2D ? t2 : t3, t2, t3, dt, is2D };
  }

  function carbonEq(c) {
    const CE = c.C + c.Mn / 6 + (c.Cr + c.Mo + c.V) / 5 + (c.Ni + c.Cu) / 15;          // IIW
    const CET = c.C + (c.Mn + c.Mo) / 10 + (c.Cr + c.Cu) / 20 + c.Ni / 40;            // EN 1011-2
    return { CE, CET };
  }

  // EN 1011-2, dodatak C, metoda B (CET)
  function preheatCET(CET, d, HD, Q) {
    const Tp = 697 * CET + 160 * Math.tanh(d / 35) + 62 * Math.pow(HD, 0.35) + (53 * CET - 32) * Q - 328;
    const warn = [];
    if (CET < 0.2 || CET > 0.5) warn.push('CET izvan 0,20–0,50');
    if (d < 10 || d > 90) warn.push('debljina izvan 10–90 mm');
    if (HD < 1 || HD > 20) warn.push('HD izvan 1–20 ml/100 g');
    if (Q < 0.5 || Q > 4) warn.push('unos topline izvan 0,5–4,0 kJ/mm');
    return { Tp, warn };
  }

  // Najveća tvrdoća ZUT-a, model Yurioke i sur. (arctan oblik)
  function hvMax(c, t85) {
    const CEI = c.C + c.Si / 24 + c.Mn / 6 + c.Cu / 15 + c.Ni / 12 + c.Cr * (1 - 0.16 * Math.sqrt(c.Cr)) / 8 + c.Mo / 4;
    const CEII = c.C - c.Si / 30 + c.Mn / 5 + c.Cu / 5 + c.Ni / 4 + c.Cr / 5 + c.Mo / 2;
    const CEIII = c.C + c.Mn / 3.6 + c.Cu / 20 + c.Ni / 9 + c.Cr / 5 + c.Mo / 4;
    const x = (Math.log10(Math.max(t85, 0.1)) - 2.30 * CEI - 1.35 * CEIII + 0.882) /
              (1.15 * CEI - 0.673 * CEIII - 0.601);
    return 442 * c.C + 99 * CEII + 206 + (402 * c.C - 90 * CEII + 80) * Math.atan(x);
  }

  function dewPoint(T, RH) {                 // Magnusova formula
    const g = Math.log(clamp(RH, 1, 100) / 100) + 17.62 * T / (243.12 + T);
    return 243.12 * g / (17.62 - g);
  }

  /* ---------- Rosenthalovo rješenje (pomični izvor) ---------- */

  function besselK0(x) {                     // Abramowitz & Stegun 9.8.5–9.8.6
    if (x <= 2) {
      const t = (x / 3.75) ** 2;
      const I0 = 1 + t * (3.5156229 + t * (3.0899424 + t * (1.2067492 + t * (0.2659732 + t * (0.0360768 + t * 0.0045813)))));
      const y = x * x / 4;
      return -Math.log(x / 2) * I0 + (-0.57721566 + y * (0.42278420 + y * (0.23069756 + y * (0.03488590 + y * (0.00262698 + y * (0.00010750 + y * 0.00000740))))));
    }
    return Math.exp(-x) * besselK0e(x);
  }

  // e^x · K0(x) za x > 2 (izbjegava preljev u 2D rješenju)
  function besselK0e(x) {
    const y = 2 / x;
    return 1 / Math.sqrt(x) * (1.25331414 + y * (-0.07832358 + y * (0.02189568 + y * (-0.01062446 + y * (0.00587872 + y * (-0.00251540 + y * 0.00053208))))));
  }

  // Temperatura u točki (xi uzduž zavara u odnosu na izvor, y poprečno, z dubina), površina z = 0
  function rosenthal(xi, y, z, s) {
    // s = { q (W), v (mm/s), d (mm), T0, is2D }
    if (s.is2D) {
      const r = Math.max(Math.hypot(xi, y), 0.3);
      const z = s.v * r / (2 * DIFF), e = -s.v * xi / (2 * DIFF);
      const val = s.q / (2 * Math.PI * LAMBDA * s.d) *
        (z > 2 ? Math.exp(e - z) * besselK0e(z) : Math.exp(e) * besselK0(z));
      return s.T0 + val;
    }
    const R = Math.max(Math.sqrt(xi * xi + y * y + z * z), 0.3);
    return s.T0 + s.q / (2 * Math.PI * LAMBDA * R) * Math.exp(-s.v * (xi + R) / (2 * DIFF));
  }

  function sourceState(p, T0) {
    const Q = heatInput(p);
    const en = t85EN(Q, T0, p.d, p.joint);
    return { q: arcPower(p), v: p.v * 10 / 60, d: p.d, T0, is2D: en.is2D };
  }

  // Toplinski ciklus točke na udaljenosti y od osi zavara; izvor prolazi točkom u t = 0
  function thermalCycle(p, y, T0, tEnd, n = 600) {
    const s = sourceState(p, T0);
    const t0 = -Math.max(3, 30 / s.v);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = t0 + (tEnd - t0) * i / n;
      pts.push([t, Math.min(rosenthal(-s.v * t, y, 0, s), 3000)]);
    }
    let iPk = 0; pts.forEach((q, i) => { if (q[1] > pts[iPk][1]) iPk = i; });
    const cross = (lvl) => {
      for (let i = iPk; i < pts.length - 1; i++) {
        if (pts[i][1] >= lvl && pts[i + 1][1] < lvl) {
          const f = (pts[i][1] - lvl) / (pts[i][1] - pts[i + 1][1]);
          return pts[i][0] + f * (pts[i + 1][0] - pts[i][0]);
        }
      }
      return NaN;
    };
    const t800 = cross(800), t500 = cross(500);
    return { pts, peak: pts[iPk][1], tPeak: pts[iPk][0], t800, t500, t85: t500 - t800, is2D: s.is2D };
  }

  // Vršni porast temperature u ovisnosti o udaljenosti (Rosenthal, daleko polje)
  function peakRise(p, y, T0) {
    const s = sourceState(p, T0);
    if (s.is2D) return Math.sqrt(2 / (Math.PI * Math.E)) * s.q / (2 * RHOC * s.v * s.d * Math.max(y, 1e-3));
    return 2 * s.q / (Math.PI * Math.E * RHOC * s.v * Math.max(y, 1e-3) ** 2);
  }

  function distanceForRise(p, dT, T0) {
    const s = sourceState(p, T0);
    if (dT <= 0) return Infinity;
    if (s.is2D) return Math.sqrt(2 / (Math.PI * Math.E)) * s.q / (2 * RHOC * s.v * s.d * dT);
    return Math.sqrt(2 * s.q / (Math.PI * Math.E * RHOC * s.v * dT));
  }

  // Vršna temperatura na udaljenosti y (numerički, iz punog Rosenthalovog rješenja)
  function peakTemp(p, y, T0) {
    const s = sourceState(p, T0);
    let lo = -(60 + 30 * y), hi = 5, best = -Infinity, bx = 0;
    for (let i = 0; i <= 300; i++) {
      const x = lo + (hi - lo) * i / 300, T = rosenthal(x, y, 0, s);
      if (T > best) { best = T; bx = x; }
    }
    const step = (hi - lo) / 300;
    lo = bx - step; hi = bx + step;
    for (let k = 0; k < 40; k++) {                      // zlatni rez
      const m1 = hi - (hi - lo) / 1.618, m2 = lo + (hi - lo) / 1.618;
      if (rosenthal(m1, y, 0, s) > rosenthal(m2, y, 0, s)) hi = m2; else lo = m1;
    }
    return Math.max(best, rosenthal((lo + hi) / 2, y, 0, s));
  }

  // Udaljenost od osi zavara na kojoj vršna temperatura iznosi Tpk
  function distanceForPeak(p, Tpk, T0) {
    let a = 0.05, b = 400;
    if (peakTemp(p, a, T0) < Tpk) return 0;
    if (peakTemp(p, b, T0) > Tpk) return b;
    for (let k = 0; k < 50; k++) {
      const m = (a + b) / 2;
      if (peakTemp(p, m, T0) > Tpk) a = m; else b = m;
    }
    return (a + b) / 2;
  }

  /* ---------- uzdužna zaostala naprezanja ---------- */
  // Oblik raspodjele prema Masubuchiju i Martinu; poluširina vlačne zone b iz uvjeta da vršni
  // porast temperature dosegne 2·Re/(E·α) (pojednostavljeni kriterij plastifikacije).
  function stressProfile(p, T0) {
    const dTcrit = 2 * p.Re / (E_MOD * ALPHA);
    const b = distanceForPeak(p, T0 + dTcrit, T0);
    const yF = distanceForPeak(p, T_MELT, T0);
    const sm = p.Re;
    const at = y => sm * (1 - (y / b) ** 2) * Math.exp(-0.5 * (y / b) ** 2);
    return { b, yF, sm, dTcrit, at };
  }

  /* ---------- modeli zaostalih naprezanja ---------- */
  // p.B = ukupna širina ploče (mm), p.L = duljina zavara (mm)
  const integrate = (f, a, b, n = 2000) => {
    let s = 0; const h = (b - a) / n;
    for (let i = 0; i <= n; i++) s += f(a + i * h) * (i === 0 || i === n ? 0.5 : 1);
    return s * h;
  };

  function stressModels(p, T0) {
    const s = sourceState(p, T0);
    const dTy = p.Re / (E_MOD * ALPHA);
    const half = p.B / 2;

    // 1) Masubuchi i Martin (samouravnotežen, beskonačno široka ploča)
    const mm = stressProfile(p, T0);
    const mmTens = integrate(y => Math.max(mm.at(y), 0), -mm.b, mm.b);
    const MM = { id: 'mm', name: 'Masubuchi i Martin', b: mm.b, peak: mm.sm, at: mm.at,
      comp: -0.446 * mm.sm, F: mmTens * p.d / 1000, warn: [] };

    // 2) Okerblom: pravokutna vlačna zona σ = Re, poluširina iz uvjeta ΔT_vrh = Re/(E·α) (2D),
    //    jednoliki tlak po ostatku širine ploče B
    let bO = 0.5 * Math.sqrt(2 / (Math.PI * Math.E)) * s.q / (RHOC * s.v * p.d * dTy);   // 0,242 (Okerblom: 2b = 0,484·q/(v·d·cρ·ΔT))
    const warnO = [];
    if (!s.is2D) warnO.push('model je izveden za tanke ploče (2D odvođenje topline)');
    if (2 * bO >= 0.9 * p.B) { warnO.push('vlačna zona zauzima gotovo cijelu širinu ploče'); bO = 0.45 * p.B; }
    const sc = -p.Re * 2 * bO / (p.B - 2 * bO);
    const OK = { id: 'ok', name: 'Okerblom (pravokutna zona)', b: bO, peak: p.Re, comp: sc,
      at: y => Math.abs(y) <= bO ? p.Re : (Math.abs(y) <= half ? sc : NaN),
      F: p.Re * 2 * bO * p.d / 1000, warn: warnO };

    // 3) Poprečna naprezanja duž zavara (x od 0 do L): slobodne ploče daju vlak u sredini
    //    i tlak na krajevima (neto sila nula); ukliještenost dodaje jednoliko reaktivno naprezanje.
    const sA = 0.2 * p.Re;
    const sR = ({ low: 0, mid: 0.25, high: 0.5 })[p.restr] * p.Re;
    const tFree = x => { const xi = 2 * x / p.L - 1; return sA * (1 - 3 * xi * xi); };
    const TR = { sA, sR, L: p.L, free: tFree,
      at: x => clamp(tFree(x) + sR, -p.Re, p.Re) };

    return { MM, OK, TR, dTy };
  }

  /* ---------- procjena rizika ---------- */

  const RESTR = { low: .1, mid: .35, high: .7 };

  // Težine uzroka: početne vrijednosti su inženjerska procjena; zamjenjuju ih težine naučene iz
  // dnevnika zavara (fitWeights) kad ima dovoljno zapisa s nalazom ispitivanja.
  const W0 = { hv: .65, slow: .35, pre: .55, cond: .45, hot: .4, restr: .3 };
  const CAUSE_IDS = Object.keys(W0);
  const riskOf = (r, w) => 100 * (1 - CAUSE_IDS.reduce((acc, id) => acc * (1 - w[id] * (r[id] || 0)), 1));

  function evaluate(p) {
    const T0 = Math.min(p.T0, 450);
    const Q = heatInput(p);
    const en = t85EN(Q, T0, p.d, p.joint);
    // naučena korekcija iz dnevnika zavara (izmjereni t8/5 i tvrdoća), ako je uključena
    const corr = p.corr || {};
    const t85model = en.t85;
    if (Number.isFinite(corr.t85) && corr.t85 > 0) en.t85 = en.t85 * corr.t85;
    const { CE, CET } = carbonEq(p.comp);
    const HVmodel = hvMax(p.comp, en.t85);
    const HV = corr.hv ? corr.hv.a + corr.hv.b * HVmodel : HVmodel;
    const HVlim = HV_LIMIT[p.group] || 380;
    const cet = preheatCET(CET, p.d, p.HD, Q);
    const Tneed = Math.max(p.TpWPS, cet.Tp, 0);
    const Td = dewPoint(p.Ta, p.RH);

    const wt = { ...W0, ...(p.weights || {}) };
    const causes = [
      { id: 'hv', k: 'Tvrdoća ZUT-a blizu ili iznad granice (hladne pukotine)',
        r: clamp((HV - (HVlim - 60)) / 60) },
      { id: 'slow', k: 'Presporo hlađenje (pad žilavosti, veće deformacije)',
        r: en.t85 > p.tmax ? clamp((en.t85 - p.tmax) / p.tmax) : 0 },
      { id: 'pre', k: 'Komad hladniji od potrebnog predgrijavanja',
        r: T0 < Tneed ? clamp((Tneed - T0) / Math.max(Tneed, 40)) : 0 },
      { id: 'cond', k: 'Moguća kondenzacija vlage na komadu (vodik)',
        r: T0 < Td + 3 ? clamp((Td + 3 - T0) / 5) : 0 },
      { id: 'hot', k: 'Komad topliji od najveće dopuštene temperature',
        r: T0 > p.Tmax ? clamp((T0 - p.Tmax) / 50) : 0 },
      { id: 'restr', k: 'Ukliještenost konstrukcije',
        r: RESTR[p.restr] * clamp(CE / 0.5) }
    ];
    causes.forEach(c => { c.w = wt[c.id]; });
    const rs = {}; causes.forEach(c => { rs[c.id] = c.r; });
    const risk = riskOf(rs, wt);
    return { Q, ...en, t85model, CE, CET, HV, HVmodel, HVlim, TpCET: cet.Tp, cetWarn: cet.warn, Tneed, Td, causes, rs, risk, k: kOf(p), learnedWeights: !!p.weights };
  }

  /* ---------- učenje iz dnevnika zavara ---------- */
  // Za mali broj uzoraka: jednostavne korekcije s unakrsnom validacijom "izostavi jedan" (LOO).
  function fitCorrections(rows) {
    const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
    const mae = a => a.length ? mean(a.map(Math.abs)) : NaN;
    const out = {};
    // t8/5: izmjereno = c · predviđeno (pravac kroz ishodište)
    const T = rows.filter(r => Number.isFinite(r.pt) && Number.isFinite(r.mt) && r.pt > 0);
    if (T.length) {
      const fitC = arr => arr.reduce((s, r) => s + r.mt * r.pt, 0) / arr.reduce((s, r) => s + r.pt * r.pt, 0);
      const loo = T.length >= 3 ? T.map((r, i) => { const c = fitC(T.filter((_, j) => j !== i)); return r.mt - c * r.pt; }) : [];
      out.t85 = { n: T.length, c: fitC(T), maeBase: mae(T.map(r => r.mt - r.pt)), maeLoo: loo.length ? mae(loo) : NaN };
      out.t85.useful = T.length >= 3 && out.t85.maeLoo < out.t85.maeBase;
    }
    // tvrdoća: pomak (HV + a) ili pravac (a + b·HV), bira se manja LOO pogreška
    const H = rows.filter(r => Number.isFinite(r.ph) && Number.isFinite(r.mh));
    if (H.length) {
      const fitShift = arr => ({ a: mean(arr.map(r => r.mh - r.ph)), b: 1 });
      const fitLine = arr => {
        const mx = mean(arr.map(r => r.ph)), my = mean(arr.map(r => r.mh));
        const sxx = arr.reduce((s, r) => s + (r.ph - mx) ** 2, 0);
        if (sxx < 1e-9) return fitShift(arr);
        const b = arr.reduce((s, r) => s + (r.ph - mx) * (r.mh - my), 0) / sxx;
        return { a: my - b * mx, b };
      };
      const looErr = fit => H.length >= 3 ? H.map((r, i) => { const m = fit(H.filter((_, j) => j !== i)); return r.mh - (m.a + m.b * r.ph); }) : [];
      const shift = { name: 'pomak', ...fitShift(H), maeLoo: mae(looErr(fitShift)) };
      const line = { name: 'pravac', ...fitLine(H), maeLoo: H.length >= 5 ? mae(looErr(fitLine)) : NaN };
      const best = Number.isFinite(line.maeLoo) && line.maeLoo < shift.maeLoo ? line : shift;
      out.hv = { n: H.length, model: best.name, a: best.a, b: best.b, maeBase: mae(H.map(r => r.mh - r.ph)), maeLoo: best.maeLoo, shift, line };
      out.hv.useful = H.length >= 3 && best.maeLoo < out.hv.maeBase;
    }
    return out;
  }

  /* ---------- učenje težina indeksa rizika iz nalaza ispitivanja ---------- */
  // rows: { r: {hv, slow, ...} ocjene uzroka 0–1, y: 1 ako je ispitivanjem nađena greška, inače 0 }.
  // Vjerojatnost greške P = 1 − Π(1 − wᵢ·rᵢ) (isti oblik kao indeks rizika). Težine se traže metodom
  // najveće vjerodostojnosti uz kaznu odstupanja od stručne procjene (MAP), jer je zapisa malo:
  // uzrok koji se u podacima ne pojavljuje (rᵢ = 0 u svim zapisima) zadržava stručnu težinu.
  function fitWeights(rows, opts = {}) {
    const lam = opts.lambda ?? 4;                       // jačina "sidra" prema stručnoj procjeni
    const R = rows.filter(q => q && q.r && (q.y === 0 || q.y === 1));
    const prob = (r, w) => clamp(1 - CAUSE_IDS.reduce((acc, id) => acc * (1 - w[id] * (r[id] || 0)), 1), 1e-4, 1 - 1e-4);
    const ll = (arr, w) => arr.reduce((s, q) => { const P = prob(q.r, w); return s + (q.y ? Math.log(P) : Math.log(1 - P)); }, 0) -
      lam * CAUSE_IDS.reduce((s, id) => s + (w[id] - W0[id]) ** 2, 0);
    const fit = arr => {                                 // koordinatni spust: zlatni rez po svakoj težini
      const w = { ...W0 };
      for (let sweep = 0; sweep < 8; sweep++) {
        let moved = 0;
        CAUSE_IDS.forEach(id => {
          if (!arr.some(q => (q.r[id] || 0) > 0)) return;
          const f = x => ll(arr, { ...w, [id]: x });
          let lo = 0.02, hi = 0.98;
          for (let k = 0; k < 22; k++) {
            const m1 = hi - (hi - lo) / 1.618, m2 = lo + (hi - lo) / 1.618;
            if (f(m1) > f(m2)) hi = m2; else lo = m1;
          }
          const nw = (lo + hi) / 2; moved += Math.abs(nw - w[id]); w[id] = nw;
        });
        if (moved < 1e-4) break;
      }
      return w;
    };
    const brier = (arr, wf) => arr.reduce((s, q, i) => s + (prob(q.r, wf(i)) - q.y) ** 2, 0) / arr.length;
    // unakrsna validacija: "izostavi jedan" do 30 zapisa, iznad toga 10 skupina
    const cvBrier = arr => {
      const K = arr.length <= 30 ? arr.length : 10;
      const ws = Array.from({ length: K }, (_, f) => fit(arr.filter((_, j) => j % K !== f)));
      return brier(arr, i => ws[i % K]);
    };
    const n1 = R.filter(q => q.y === 1).length, n0 = R.length - n1;
    const out = { n: R.length, n1, n0, w: fit(R) };
    out.used = {}; CAUSE_IDS.forEach(id => { out.used[id] = R.some(q => (q.r[id] || 0) > 0.05); });
    out.brierBase = R.length ? brier(R, () => W0) : NaN;
    out.brierLoo = R.length >= 4 ? cvBrier(R) : NaN;
    out.useful = R.length >= 6 && n1 >= 2 && n0 >= 2 && out.brierLoo < out.brierBase;
    return out;
  }

  /* ---------- kalibracija toplinske iskoristivosti iz izmjerenog ciklusa ---------- */
  // Traži k za koji Rosenthalov ciklus na udaljenosti y ima izmjereni t8/5 (t8/5 raste s k).
  function calibrateK(p, y, t85meas, T0) {
    // t8/5 se u ZUT-u malo mijenja s udaljenošću; ako modelna točka ne doseže 800 °C (Rosenthal raspoređuje toplinu
    // po debljini, pa podcjenjuje vršne temperature uz površinu), koristi se točka uz rub taline
    // Točka se pomiče prema osi samo koliko treba da njezin vrh dosegne 1000 °C, kontinuirano s k:
    // inače bi t8/5 skočio pri k za koji modelna točka upravo prijeđe 800 °C.
    const yAt = pk => Math.min(y, Math.max(0.3, distanceForPeak(pk, 1000, T0)));
    const tEnd = Math.max(60, 4 * t85meas + 30);
    const t85At = k => { const pk = { ...p, kEff: k }; return thermalCycle(pk, yAt(pk), T0, tEnd).t85; };
    let lo = 0.2, hi = 1.3;
    const fLo = t85At(lo), fHi = t85At(hi);
    if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return { k: NaN, reason: 'točka ne doseže 800 °C uz zadane parametre' };
    if (t85meas < fLo) return { k: lo, reason: 'Izmjereni t8/5 kraći je od modela i uz k = 0,2', bound: true };
    if (t85meas > fHi) return { k: hi, reason: 'Izmjereni t8/5 dulji je od modela i uz k = 1,3', bound: true };
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2, fm = t85At(m);
      if (!Number.isFinite(fm) || fm < t85meas) lo = m; else hi = m;
    }
    const kf = (lo + hi) / 2, ye = yAt({ ...p, kEff: kf });
    return { k: kf, yEval: ye, reason: ye < y - 0.05 ? `Model u točki mjerenja ne doseže dovoljno visoku temperaturu, pa je t8/5 uspoređen ${ye.toFixed(1).replace('.', ',')} mm od osi zavara` : '' };
  }

  // Izmjereni ciklus: vrh i t8/5 iz niza [t, T]
  function cycleStats(pts) {
    if (!pts || pts.length < 3) return null;
    let ip = 0; pts.forEach((q, i) => { if (q[1] > pts[ip][1]) ip = i; });
    const cross = lvl => {
      for (let i = ip; i < pts.length - 1; i++) if (pts[i][1] >= lvl && pts[i + 1][1] < lvl) {
        const f = (pts[i][1] - lvl) / (pts[i][1] - pts[i + 1][1]); return pts[i][0] + f * (pts[i + 1][0] - pts[i][0]);
      }
      return NaN;
    };
    const t800 = cross(800), t500 = cross(500);
    return { peak: pts[ip][1], tPeak: pts[ip][0], t800, t500, t85: t500 - t800 };
  }

  /* ---------- preporuka i procesni prozor ---------- */

  function variant(p, I, v, T0, coupleU) {
    const U = coupleU ? coupledVoltage(p.proc, p.U, p.I, I) : p.U;
    return { ...p, I, v, U, T0 };
  }

  function recommend(p, opts = {}) {
    const coupleU = opts.coupleU !== false;
    const base = evaluate(p);
    const Q0 = base.Q;
    const temps = [p.T0];
    for (let t = Math.ceil(Math.max(p.T0, 0) / 10) * 10 + 10; t <= p.Tmax; t += 10) temps.push(t);
    let best = null;
    for (let fi = 0.8; fi <= 1.2001; fi += 0.05)
      for (let fv = 0.7; fv <= 1.3001; fv += 0.05)
        for (const T of temps) {
          const q = variant(p, p.I * fi, p.v * fv, T, coupleU);
          const Q = heatInput(q);
          if (Q < 0.75 * Q0 || Q > 1.25 * Q0) continue;       // granica kvalifikacije EN ISO 15614-1
          const e = evaluate(q);
          const cost = e.risk + 8 * (Math.abs(fi - 1) + Math.abs(fv - 1)) + 0.04 * (T - p.T0);
          if (!best || cost < best.cost) best = { cost, p: q, e };
        }
    if (!best || best.e.risk >= base.risk - 1) return { base, best: null };
    return { base, best };
  }

  function processWindow(p, T0, opts = {}) {
    const coupleU = opts.coupleU !== false;
    const nI = opts.nI || 48, nV = opts.nV || 36;
    const I1 = Math.max(40, p.I * 0.5), I2 = p.I * 1.5;
    const v1 = Math.max(2, p.v * 0.5), v2 = p.v * 1.6;
    const grid = [];
    for (let j = 0; j < nV; j++) {
      const row = [];
      const v = v1 + (v2 - v1) * (j + .5) / nV;
      for (let i = 0; i < nI; i++) {
        const I = I1 + (I2 - I1) * (i + .5) / nI;
        row.push(evaluate(variant(p, I, v, T0, coupleU)).risk);
      }
      grid.push(row);
    }
    return { grid, I1, I2, v1, v2, nI, nV, Q0: heatInput(p), coupleU };
  }

  const api = { K, ULINE, HD_DEFAULT, MAT, HV_LIMIT, LAMBDA, RHOC, DIFF, T_MELT,
    heatInput, coupledVoltage, t85EN, carbonEq, preheatCET, hvMax, dewPoint,
    besselK0, rosenthal, sourceState, thermalCycle, peakTemp, distanceForPeak, peakRise, stressModels, integrate, distanceForRise, stressProfile,
    evaluate, recommend, processWindow, variant, clamp, fitCorrections, calibrateK, cycleStats, kOf, W0, CAUSE_IDS, riskOf, fitWeights };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Weld = api;
})(typeof window !== 'undefined' ? window : globalThis);
