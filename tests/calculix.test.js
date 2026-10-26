// Pokretanje: node --test tests/calculix.test.js
const test = require('node:test');
const assert = require('node:assert');
const W = require('../physics.js');
global.Weld = W;
const C = require('../calculix.js');

const p = { proc: 'MAG', I: 260, U: 27, v: 25, d: 12, B: 120, L: 60, joint: 'butt', restr: 'mid', T0: 20, Ta: 18, RH: 60,
  TpWPS: 50, HD: 5, mat: 'S355J2', ...W.MAT.S355J2, comp: { ...W.MAT.S355J2.comp } };

test('Goldakova raspodjela u poluprostoru daje ukupnu snagu Q', () => {
  const g = { b: 3, c: 4, af: 3, ar: 6, ff: 0.6, fr: 1.4 };
  let s = 0; const h = 0.25;
  for (let x = -40; x < 20; x += h) for (let y = -15; y < 15; y += h) for (let z = 0; z < 15; z += h) s += C.goldak(g, 1000, x + h / 2, y + h / 2, z + h / 2) * h * h * h;
  assert.ok(Math.abs(s - 1000) < 10, `ukupno ${s}`);
});

test('generator: svaki korak mehaničke analize čita vlastiti korak toplinske (BSTEP = broj koraka)', () => {
  const r = C.build(p, { mesh: 'gruba', tCool: 600, Weld: W });
  // CalculiX u *TEMPERATURE, BSTEP=k čita posljednji ispis k-tog KORAKA analize, pa toplinska analiza
  // mora imati po jedan korak za svako stanje koje mehanička učitava, s jednim ispisom na kraju koraka
  const thSteps = (r.toplina.match(/^\*HEAT TRANSFER/gm) || []).length;
  const bsteps = (r.naprezanja.match(/BSTEP=\d+/g) || []).map(s => +s.slice(6));
  assert.strictEqual(bsteps.length, thSteps);
  assert.deepStrictEqual(bsteps, bsteps.map((_, i) => i + 1));
  assert.strictEqual(r.info.nSteps, bsteps.length);
  assert.ok(!/TIME POINTS/.test(r.toplina), 'nema ispisa unutar koraka');
  assert.ok((r.toplina.match(/\*AMPLITUDE, NAME=\S+, TIME=TOTAL TIME/g) || []).length > 0, 'krivulje toka u ukupnom vremenu');
  assert.match(r.naprezanja, /FILE=toplina\.frd/);
});

test('generator: toplinski tok elemenata u trenutku prolaza izvora zbraja se na k·U·I/2', () => {
  const r = C.build(p, { mesh: 'gruba', tCool: 600, Weld: W });
  const nodes = new Map(); const lines = r.toplina.split('\n');
  let i = lines.indexOf('*NODE, NSET=Nall') + 1;
  for (; !lines[i].startsWith('*'); i++) { const a = lines[i].split(',').map(Number); nodes.set(a[0], a.slice(1)); }
  const el = new Map(); i++;
  for (; !lines[i].startsWith('*'); i++) { const a = lines[i].split(',').map(Number); el.set(a[0], a.slice(1)); }
  const vol = e => { const c = el.get(e).map(n => nodes.get(n)); const d = k => Math.max(...c.map(q => q[k])) - Math.min(...c.map(q => q[k])); return d(0) * d(1) * d(2); };
  const tMid = 30 / (25 * 10 / 60);
  let P = 0;
  for (let k = 0; k < lines.length; k++) {
    const m = lines[k].match(/^\*AMPLITUDE, NAME=Q(\d+)/); if (!m) continue;
    const pts = []; for (let j = k + 1; !lines[j].startsWith('*'); j++) pts.push(...lines[j].split(',').filter(x => x.trim()).map(Number));
    let q = 0; for (let a = 0; a + 3 < pts.length; a += 2) if (pts[a] <= tMid && tMid <= pts[a + 2]) { const f = (tMid - pts[a]) / (pts[a + 2] - pts[a]); q = pts[a + 1] + f * (pts[a + 3] - pts[a + 1]); }
    P += q * vol(+m[1]);
  }
  const target = W.kOf(p) * p.U * p.I * 1000 / 2;   // mW, polovica modela
  assert.ok(Math.abs(P - target) / target < 0.03, `snaga ${P} umjesto ${target}`);
});

test('kalibrirani k ulazi u snagu izvora', () => {
  const a = C.build(p, { mesh: 'gruba', infoOnly: true, Weld: W }).info, b = C.build({ ...p, kEff: 0.6 }, { mesh: 'gruba', infoOnly: true, Weld: W }).info;
  assert.ok(Math.abs(b.Qtot / a.Qtot - 0.6 / 0.8) < 1e-9);
});

test('svojstva čelika prema EN 1993-1-2', () => {
  const P = C.PROPS, at = T => P.T.indexOf(T);
  assert.ok(Math.abs(P.k[at(20)] - 53.334) < 0.01, 'λ(20 °C) = 54 − 0,0333·20');
  assert.ok(Math.abs(P.k[at(800)] - 27.3) < 1e-9, 'λ = 27,3 od 800 °C');
  assert.ok(Math.abs(C.EC3.c(735) - 5000) < 1, 'c(735 °C) = 5000 J/(kg·K)');
  // zaglađeni c u tablici mora čuvati entalpiju od 20 do 1000 °C
  let Hx = 0; for (let i = 0; i < 9800; i++) Hx += C.EC3.c(20 + (i + .5) * 0.1) * 0.1;
  let Ht = 0; for (let i = 1; P.T[i] <= 1000; i++) Ht += (P.c[i] + P.c[i - 1]) / 2 * (P.T[i] - P.T[i - 1]);
  assert.ok(Math.abs(Ht / Hx - 1) < 0.01, `entalpija ${Ht} prema ${Hx}`);
  assert.ok(Math.abs(C.EC3.elong(750) - 1.1e-2) < 2e-5 && Math.abs(C.EC3.elong(860) - 1.1e-2) < 1e-9, 'produljenje neprekinuto u 750 i 860 °C');
  assert.ok(Math.abs(P.yieldFactor[at(600)] - 0.47) < 1e-9 && Math.abs(P.E[at(600)] - 0.31 * 210000) < 1e-6, 'k_y i k_E iz tablice 3.1');
  assert.ok(P.T.every((T, i) => P.E[i] > 0 && P.yieldFactor[i] > 0), 'krutost i čvrstoća veće od nule');
});
