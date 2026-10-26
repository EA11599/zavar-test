// Pokretanje: node --test tests/surrogate.test.js
const test = require('node:test');
const assert = require('node:assert');
const W = require('../physics.js');
const S = require('../surrogate.js');

let seed = 5; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

test('GPR aproksimira glatku funkciju i prepoznaje nevažan ulaz', () => {
  const f = x => Math.sin(3 * x[0]) + 0.5 * x[1] * x[1];
  const X = [], y = [];
  for (let i = 0; i < 30; i++) { const x = [rnd(), rnd(), rnd()]; X.push(x); y.push(f(x)); }
  const g = S.gpFit(X, y);
  let e = 0; for (let i = 0; i < 100; i++) { const x = [rnd(), rnd(), rnd()]; e += Math.abs(g.predict(x).mean - f(x)); }
  assert.ok(e / 100 < 0.03, `srednja pogreška ${e / 100}`);
  assert.ok(g.h.ell[2] > 3 * g.h.ell[0], 'treći ulaz ne utječe pa dobiva dugu duljinu');
});

test('"izostavi jedan" u zatvorenom obliku jednak je ponovnom učenju bez točke', () => {
  const X = [], y = [];
  for (let i = 0; i < 15; i++) { const x = [rnd(), rnd()]; X.push(x); y.push(x[0] - x[1] * x[1]); }
  const g = S.gpFit(X, y);
  // isti hiperparametri, ista normalizacija: usporedba u normaliziranim jedinicama
  const yn = y.map(v => (v - g.mu) / g.sd);
  for (const i of [0, 7, 14]) {
    const g2 = S.gpFit(X.filter((_, j) => j !== i), yn.filter((_, j) => j !== i).map(v => v * g.sd + g.mu), { fixed: g.th });
    const p = g2.predict(X[i]).mean;
    assert.ok(Math.abs(p - g.loo[i].mean) < 0.02 * g.sd, `točka ${i}: ${p} prema ${g.loo[i].mean}`);
  }
});

test('hibridni model nauči sustavno odstupanje od analitičkog', () => {
  const rows = [];
  for (let i = 0; i < 24; i++) {
    const I = 180 + 140 * rnd(), U = 14 + 0.05 * I, v = 18 + 22 * rnd();
    const x = { I, U, v, T0: -5 + 150 * rnd(), d: 8 + 12 * rnd(), Re: 235 + 450 * rnd() };
    const a = S.analytic(W, S.baseCase(W, x)); x.Q = W.heatInput(S.baseCase(W, x));
    rows.push({ x, y: { sxMax: 0.9 * a.sxMax, b0: 1.2 * a.b0, t85: 1.07 * a.t85, syMid: a.syMid + 0.3 * x.Re } });
  }
  const M = S.train(W, rows);
  S.OUTS.forEach(o => { const m = M.models[o.id]; assert.ok(m.mae.hyb < 0.2 * m.mae.ana, `${o.id}: ${m.mae.hyb} prema ${m.mae.ana}`); });
  const p = { ...S.baseCase(W, rows[0].x), T0: 400 };
  assert.ok(S.predict(W, M, p).outside.includes('T0'), 'upozorenje izvan raspona');
});

test('fizikalni uvjeti: najveći σx najviše 1,4·Re, oblik raspodjele samouravnotežen', () => {
  const o = S.OUTS.find(q => q.id === 'sxMax');
  assert.strictEqual(o.lim(1000, { Re: 355 }), 1.4 * 355);
  const pred = { out: { sxMax: { val: 300 }, b0: { val: 12 } } };
  const f = S.profile(pred);
  assert.ok(Math.abs(W.integrate(f, -400, 400, 8000)) < 1e-3 * 300 * 8, 'uzdužna sila preko presjeka ≈ 0');
  assert.ok(Math.abs(f(12)) < 1e-6 && Math.abs(f(0) - 300) < 1e-6, 'σx(0) = najveće, σx(b) = 0');
});
