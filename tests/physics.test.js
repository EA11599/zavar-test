// Pokretanje: node --test tests/   (Node 18 ili noviji)
const test = require('node:test');
const assert = require('node:assert');
const W = require('../physics.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} umjesto ${b} (±${tol})`);
const base = {
  proc: 'MAG', I: 260, U: 27, v: 25, d: 12, joint: 'butt', restr: 'mid', T0: 12, Ta: 18, RH: 70,
  TpWPS: 50, HD: 5, ...W.MAT.S355J2, comp: { ...W.MAT.S355J2.comp }
};

test('unos topline Q = k·U·I/v', () => {
  near(W.heatInput(base), 0.8 * 27 * 260 / (25 * 10 / 60) / 1000, 1e-9, 'Q');
});

test('t8/5: 2D i 3D izraz se poklapaju na prijelaznoj debljini', () => {
  const Q = 1.2, T0 = 20;
  const { dt } = W.t85EN(Q, T0, 10, 'butt');
  const r = W.t85EN(Q, T0, dt, 'butt');
  near(r.t2, r.t3, 1e-6 * r.t3, 't2 = t3 za d = dt');
});

test('Rosenthal 3D daje isti t8/5 kao EN 1011-2 (T0 = 0, F = 1)', () => {
  const p = { ...base, d: 80, T0: 0 };
  const Q = W.heatInput(p);
  const en = (6700) * Q * (1 / 500 - 1 / 800);
  const c = W.thermalCycle(p, 4, 0, 60, 4000);
  near(c.t85, en, en * 0.02, 't8/5 3D');
});

test('Rosenthal 2D daje isti t8/5 kao EN 1011-2 (T0 = 0, F = 1)', () => {
  const p = { ...base, d: 4, I: 150, U: 22, v: 30, T0: 0 };
  const Q = W.heatInput(p);
  const en = 4300e5 * (Q * Q / 16) * (1 / 500 ** 2 - 1 / 800 ** 2);
  const c = W.thermalCycle(p, 3, 0, 120, 4000);
  near(c.t85, en, en * 0.03, 't8/5 2D');
});

test('Besselova funkcija K0', () => {
  near(W.besselK0(1), 0.4210244382, 1e-6, 'K0(1)');
  near(W.besselK0(3), 0.0347395, 1e-6, 'K0(3)');
});

test('rosište: 20 °C i 50 % daje oko 9,3 °C', () => {
  near(W.dewPoint(20, 50), 9.26, 0.05, 'rosište');
});

test('ekvivalenti ugljika za S355J2', () => {
  const { CE, CET } = W.carbonEq(base.comp);
  near(CE, 0.17 + 1.40 / 6 + (0.05 + 0.02 + 0.01) / 5 + (0.05 + 0.10) / 15, 1e-9, 'CE');
  near(CET, 0.17 + (1.40 + 0.02) / 10 + (0.05 + 0.10) / 20 + 0.05 / 40, 1e-9, 'CET');
});

test('predgrijavanje CET raste s debljinom, vodikom i CET-om, pada s unosom topline', () => {
  const f = (CET, d, HD, Q) => W.preheatCET(CET, d, HD, Q).Tp;
  assert.ok(f(.35, 40, 5, 1) > f(.35, 20, 5, 1));
  assert.ok(f(.35, 20, 15, 1) > f(.35, 20, 5, 1));
  assert.ok(f(.40, 20, 5, 1) > f(.35, 20, 5, 1));
  assert.ok(f(.35, 20, 5, 2) < f(.35, 20, 5, 1));
});

test('tvrdoća ZUT-a pada s duljim hlađenjem i u razumnom je rasponu', () => {
  const h = t => W.hvMax(base.comp, t);
  assert.ok(h(3) > h(10) && h(10) > h(30));
  assert.ok(h(3) < 550 && h(30) > 150);
});

test('toplije ploče: dulji t8/5 i manji rizik', () => {
  const cold = W.evaluate({ ...base, T0: 5 }), warm = W.evaluate({ ...base, T0: 60 });
  assert.ok(warm.t85 > cold.t85);
  assert.ok(warm.risk < cold.risk);
});

test('preporuka smanjuje rizik i ostaje unutar ±25 % unosa topline', () => {
  const r = W.recommend({ ...base, T0: 5 });
  assert.ok(r.best, 'preporuka postoji');
  assert.ok(r.best.e.risk < r.base.risk);
  const ratio = r.best.e.Q / r.base.Q;
  assert.ok(ratio >= 0.75 - 1e-9 && ratio <= 1.25 + 1e-9);
  assert.ok(r.best.p.T0 <= base.Tmax);
});

test('zaostala naprezanja: vlačna zona šira uz veći unos topline', () => {
  const a = W.stressProfile(base, 20), b = W.stressProfile({ ...base, v: 15 }, 20);
  assert.ok(a.yF > 1 && a.yF < a.b, "talina uža od vlačne zone");
  assert.ok(b.b > a.b);
  near(a.at(0), base.Re, 1e-9, 'vrh = Re');
});

test('Okerblom: poluširina odgovara uvjetu vršnog porasta Re/(E·α) u 2D', () => {
  const p = { ...base, B: 300, L: 500 };
  const m = W.stressModels(p, 20);
  const rise = W.peakRise(p, m.OK.b, 20);
  near(rise, m.dTy, m.dTy * 1e-6, 'ΔT na rubu zone');
});

test('Okerblom: sila u vlačnoj zoni jednaka je sili u tlačnim zonama', () => {
  const p = { ...base, B: 300, L: 500 };
  const m = W.stressModels(p, 20);
  const total = W.integrate(y => m.OK.at(y), -150, 150, 6000);
  near(total, 0, p.Re * 2, 'neto sila po širini');
});

test('Masubuchi i Martin: raspodjela je samouravnotežena', () => {
  const m = W.stressModels({ ...base, B: 300, L: 500 }, 20);
  near(W.integrate(m.MM.at, -20 * m.MM.b, 20 * m.MM.b, 20000), 0, 1e-3 * base.Re * m.MM.b, 'neto sila');
});

test('poprečna naprezanja slobodnih ploča imaju neto silu nula, ukliještenost je povećava', () => {
  const p = { ...base, B: 300, L: 500 };
  const free = W.stressModels({ ...p, restr: 'low' }, 20).TR;
  near(W.integrate(free.free, 0, 500), 0, 1e-4 * free.sA * 500, 'neto sila');
  const hi = W.stressModels({ ...p, restr: 'high' }, 20).TR;
  assert.ok(hi.at(250) > free.at(250));
});

test('kalibracija k: iz "izmjerenog" ciklusa vraća k kojim je ciklus izračunat', () => {
  const pk = { ...base, kEff: 0.7 };
  const meas = W.thermalCycle(pk, 3, 20, 80, 2000);
  const r = W.calibrateK(base, 3, meas.t85, 20);
  near(r.k, 0.7, 0.01, 'k');
  const s = W.cycleStats(meas.pts);
  near(s.t85, meas.t85, 0.05, 'cycleStats t8/5');
});

test('kalibrirani k mijenja unos topline i t8/5', () => {
  const a = W.evaluate({ ...base }), b = W.evaluate({ ...base, kEff: 0.6 });
  near(b.Q / a.Q, 0.6 / 0.8, 1e-9, 'Q');
  assert.ok(b.t85 < a.t85);
});

test('učenje iz dnevnika: pronalazi poznati pomak tvrdoće i faktor t8/5, LOO bolji od modela bez korekcije', () => {
  const rows = [250, 270, 290, 310, 330, 350].map((h, i) => ({ ph: h, mh: h + 15 + (i % 2 ? 3 : -3), pt: 8 + i, mt: (8 + i) * 1.1 }));
  const f = W.fitCorrections(rows);
  near(f.hv.a + f.hv.b * 300 - 300, 15, 3, 'pomak HV na 300');
  near(f.t85.c, 1.1, 1e-9, 'faktor t8/5');
  assert.ok(f.hv.useful && f.t85.useful);
  assert.ok(f.hv.maeLoo < f.hv.maeBase);
});

test('korekcija u procjeni: t8/5 × c i HV = a + b·HV', () => {
  const plain = W.evaluate(base), cor = W.evaluate({ ...base, corr: { t85: 1.1, hv: { a: 10, b: 1 } } });
  near(cor.t85, plain.t85 * 1.1, 1e-9, 't8/5');
  near(cor.HV, W.hvMax(base.comp, plain.t85 * 1.1) + 10, 1e-9, 'HV');
});

test('indeks rizika: početne težine i naučene težine', () => {
  const e = W.evaluate(base);
  near(e.risk, W.riskOf(e.rs, W.W0), 1e-9, 'indeks s početnim težinama');
  const e2 = W.evaluate({ ...base, weights: { ...W.W0, pre: 0.9 } });
  assert.ok(e.rs.pre > 0 ? e2.risk > e.risk : e2.risk === e.risk, 'veća težina uzroka povećava indeks');
});

test('učenje težina: težina uzroka koji stvarno uzrokuje greške raste', () => {
  // sintetički nalazi: greška nastaje kad je komad znatno hladniji od potrebnog predgrijavanja
  let s = 11; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const e = W.evaluate({ ...base, T0: -5 + 80 * rnd(), B: 300, L: 500 });
    rows.push({ r: e.rs, y: e.rs.pre > 0.3 ? 1 : 0 });
  }
  const f = W.fitWeights(rows);
  assert.ok(f.w.pre > W.W0.pre, `težina "pre" ${f.w.pre} veća od početne`);
  assert.ok(f.brierLoo < f.brierBase, 'unakrsna validacija pokazuje poboljšanje');
  assert.ok(f.useful);
  const few = W.fitWeights(rows.slice(0, 4));
  assert.ok(!few.useful, 'premalo zapisa ne smije se koristiti');
});
