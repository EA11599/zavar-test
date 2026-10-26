/* Sučelje za demo "Provjera parametara zavarivanja". Izračuni su u physics.js (window.Weld). */
(function () {
  'use strict';
  const W = window.Weld;
  const $ = id => document.getElementById(id);
  const clamp = W.clamp;
  const CHEM = ['C', 'Si', 'Mn', 'Cr', 'Mo', 'Ni', 'Cu', 'V'];
  const fmt = (x, n = 1) => Number.isFinite(x)
    ? x.toLocaleString('hr-HR', { minimumFractionDigits: n, maximumFractionDigits: n }) : '–';
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Broj iz polja: prihvaća decimalni zarez i točku (polja su tekstualna, pa preglednik ne izbacuje zarez)
  const numv = s => { const t = String(s ?? '').trim().replace(/\s+/g, '').replace(/−/g, '-').replace(',', '.'); return t === '' || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? NaN : Number(t); };
  // hrvatska množina: 1 zapis, 2–4 zapisa, 5+ zapisa (11–14 zapisa)
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };

  function hexRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const mix = (a, b, t) => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));

  /* ---------------- ulazi ---------------- */

  function applyMaterial() {
    const m = W.MAT[$('mat').value];
    $('Re').value = m.Re; $('TpWPS').value = m.TpWPS;
    $('tmin').value = m.tmin; $('tmax').value = m.tmax; $('Tmax').value = m.Tmax;
    CHEM.forEach(k => { $('c' + k).value = m.comp[k]; });
  }
  function applyProcess() {
    const pr = $('proc').value; $('HD').value = String(W.HD_DEFAULT[pr]);
    const I = numv($('I').value), L = W.ULINE[pr];
    if (Number.isFinite(I) && L) $('U').value = String(Math.round((L.a + L.b * I) * 2) / 2).replace('.', ',');   // uobičajeni napon za tu struju
  }

  function read() {
    const g = id => numv($(id).value);
    const comp = {}; CHEM.forEach(k => { comp[k] = g('c' + k); });
    return {
      T0: g('T0'), Ta: g('Ta'), RH: g('RH'), Re: g('Re'), d: g('d'), joint: $('joint').value,
      restr: $('restr').value, proc: $('proc').value, B: g('B'), L: g('L'), HD: g('HD'), I: g('I'), U: g('U'), v: g('v'),
      TpWPS: g('TpWPS'), tmin: g('tmin'), tmax: g('tmax'), Tmax: g('Tmax'),
      group: W.MAT[$('mat').value].group, mat: $('mat').value, comp, coupleU: $('coupleU').checked,
      kEff: KCAL.on && Number.isFinite(KCAL.k) ? KCAL.k : undefined,
      corr: ML.use && ML.fit ? mlCorr() : undefined,
      weights: ML.use ? mlWeights() : undefined
    };
  }

  function invalid(p) {
    const need = { T0: 'temperatura komada', Ta: 'okolna temperatura', RH: 'relativna vlažnost', Re: 'granica tečenja',
      d: 'debljina lima', I: 'struja', U: 'napon', v: 'brzina zavarivanja', TpWPS: 'propisano predgrijavanje',
      B: 'širina ploča', L: 'duljina zavara', tmin: 'ciljani t8/5 od', tmax: 'ciljani t8/5 do', Tmax: 'najveća temperatura komada' };
    for (const k in need) if (!Number.isFinite(p[k])) return 'Upiši vrijednost: ' + need[k] + '.';
    for (const k of CHEM) if (!Number.isFinite(p.comp[k]) || p.comp[k] < 0) return 'Upiši udio elementa ' + k + ' (0 ili više).';
    if (p.comp.C <= 0 || p.comp.C > 0.5) return 'Udio ugljika mora biti između 0 i 0,5 %.';
    if (p.d <= 0 || p.I <= 0 || p.U <= 0 || p.v <= 0) return 'Debljina, struja, napon i brzina moraju biti veći od nule.';
    if (p.B < 20 || p.L < 20) return 'Širina ploča i duljina zavara moraju biti barem 20 mm.';
    if (p.RH < 1 || p.RH > 100) return 'Relativna vlažnost mora biti između 1 i 100 %.';
    if (p.T0 >= 450) return 'Temperatura komada mora biti ispod 450 °C.';
    if (p.T0 < -40) return 'Temperatura komada mora biti barem −40 °C.';
    if (p.d < 2 || p.d > 150) return 'Debljina lima mora biti između 2 i 150 mm.';
    if (p.I < 30 || p.I > 1000) return 'Struja mora biti između 30 i 1.000 A.';
    if (p.U < 8 || p.U > 60) return 'Napon mora biti između 8 i 60 V.';
    if (p.v < 2 || p.v > 300) return 'Brzina zavarivanja mora biti između 2 i 300 cm/min.';
    if (p.Re < 150 || p.Re > 1300) return 'Granica tečenja mora biti između 150 i 1.300 MPa.';
    if (p.tmin >= p.tmax) return 'Ciljani t8/5 "od" mora biti manji od "do".';
    return null;
  }

  /* ---------------- stanje ---------------- */
  let P = null, E = null, REC = null, ST = null, SM = null;
  const MC = { pts: null, name: '', stats: null, sig: '' };        // učitani (izmjereni ili simulirani) toplinski ciklus
  const KCAL = { k: NaN, on: false, from: '' };           // kalibrirana toplinska iskoristivost
  const ML = { fit: null, fitW: null, use: false, demo: false };      // naučene korekcije iz dnevnika
  const FEM = { x: null, y: null, sig: '' };
  // potpis ulaza za koje su učitani vanjski rezultati; ako se ulazi promijene, rezultati više ne odgovaraju
  const sigFem = p => p ? [p.Re, p.d, p.B, p.L, p.I, p.U, p.v, p.T0, p.proc, p.joint, p.restr].join('|') : '';
  const sigCyc = p => p ? [p.d, p.B, p.L, p.I, p.U, p.v, p.T0, p.proc, p.joint].join('|') : '';
  const femStale = () => !!(FEM.sig && P && FEM.sig !== sigFem(P));
  const mcStale = () => !!(MC.sig && P && MC.sig !== sigCyc(P));
  let CERT = null;   // podaci iz potvrđenog certifikata
  let LOADMISS = [];  // polja koja nedostaju u zapisu učitanom iz dnevnika
  let probeY = 3, probeAuto = true;
  let pwMode = 'meas';

  function verdict(r) {
    if (r < 25) return ['Prihvatljivo', 'var(--ok)'];
    if (r < 50) return ['Oprez', 'var(--warn)'];
    return ['Korigiraj parametre', 'var(--bad)'];
  }

  /* ---------------- glavni prikaz ---------------- */

  function render() {
    const p = read();
    const err = invalid(p);
    if (err) { showError(err); return; }
    P = p;
    E = W.evaluate(p);
    REC = W.recommend(p, { coupleU: p.coupleU });
    ST = W.stressProfile(p, p.T0);
    if (probeAuto) probeY = Math.max(0.5, W.distanceForPeak(p, 1350, p.T0));
    renderInSum(); renderSurrogate(); renderSummary(); renderReco(); renderStKey(); renderStress(); renderCycle(); renderCompare(); renderPW(); renderCcx();
    fieldStateDirty = true;
    if (!playing) drawField();
  }

  function showError(msg) {
    P = null; renderInSum();
    $('risk').textContent = '–'; $('verdict').textContent = msg; $('verdict').style.color = 'var(--bad)';
    ['mQ', 'mT85', 'mHV', 'mTp', 'mDew', 'mB'].forEach(id => { $(id).textContent = '–'; });
    $('causes').innerHTML = ''; $('cetWarn').textContent = ''; $('ceOut').textContent = '';
    $('reco').innerHTML = '<p class="note">Preporuka će se prikazati kad su svi ulazni podaci ispravni.</p>';
    ['cycle', 'stress', 'stressT', 'chart', 'stressTable'].forEach(id => { $(id).innerHTML = ''; });
    $('cycleOut').textContent = ''; $('stressOut').textContent = ''; $('dA').innerHTML = ''; $('dB').innerHTML = '';
    $('stKey').innerHTML = ''; $('stSide').innerHTML = ''; $('stKeyNote').textContent = msg;
    const c = $('pw').getContext('2d'); c.clearRect(0, 0, 760, 420);
  }

  function renderSummary() {
    const p = P, e = E;
    $('risk').textContent = Math.round(e.risk);
    const [vt, col] = verdict(e.risk);
    $('verdict').textContent = vt; $('verdict').style.color = col;
    $('pin').style.left = clamp(e.risk, 0, 100) + '%';
    $('tint').setAttribute('aria-label', 'Indeks rizika ' + Math.round(e.risk) + ' od 100');
    $('riskSrc').textContent = e.learnedWeights ? `Težine uzroka naučene iz dnevnika (${ML.fitW.n} zapisa s nalazom).` : 'Težine uzroka: stručna procjena, dok se ne nauče iz nalaza u dnevniku.';
    $('mQ').textContent = fmt(e.Q, 2);
    $('mQ').nextElementSibling.textContent = KCAL.on ? `unos topline, kJ/mm (k = ${fmt(e.k, 2)}, kalibriran)` : 'unos topline, kJ/mm';
    $('mT85').textContent = fmt(e.t85, 1);
    $('mT85l').textContent = `t8/5, s (${e.is2D ? '2D' : '3D'} odvođenje; cilj ${fmt(p.tmin, 0)}–${fmt(p.tmax, 0)})` + (p.corr && p.corr.t85 ? ', naučena korekcija' : '');
    $('mHV').textContent = Math.round(e.HV);
    $('mHVl').textContent = `najveća tvrdoća ZUT-a, HV (granica ${e.HVlim})` + (p.corr && p.corr.hv ? ', naučena korekcija' : '');
    $('mHVbox').classList.toggle('alert', e.HV > e.HVlim);
    if (e.TpCET <= 0) { $('mTp').textContent = '0'; $('mTpl').textContent = 'potrebno predgrijavanje (CET), °C: nije potrebno'; }
    else { $('mTp').textContent = Math.round(e.TpCET); $('mTpl').textContent = 'potrebno predgrijavanje (CET), °C'; }
    $('mDew').textContent = fmt(e.Td, 1);
    // ista vrijednost kao na prvoj kartici: surogatni model ako postoji, inače Masubuchi i Martin
    const bSu = SU.pred ? SU.pred.out.b0.val : NaN;
    $('mB').textContent = '±' + fmt(Number.isFinite(bSu) ? bSu : W.stressModels(p, p.T0).MM.b, 1);
    $('mBl').textContent = 'širina vlačne zone od osi zavara, mm (' + (Number.isFinite(bSu) ? 'surogatni model' : 'Masubuchi i Martin') + ')';
    $('cetWarn').textContent = e.cetWarn.length ? 'Izraz za predgrijavanje primijenjen izvan područja valjanosti: ' + e.cetWarn.join(', ') + '.' : '';
    $('ceOut').innerHTML = `CE = <b>${fmt(e.CE, 2)}</b>, CET = <b>${fmt(e.CET, 2)}</b>, skupina materijala ${p.group}` +
      (CERT && Number.isFinite(CERT.cev) ? `; CEV s certifikata = <b>${fmt(CERT.cev, 2)}</b>${Math.abs(CERT.cev - e.CE) > 0.02 ? ' (razlika od izračunatog veća od 0,02: provjeri sastav)' : ''}` : '');
    $('causes').innerHTML = e.causes.map(c => `
      <div class="cause"><span>${c.k} <span class="muted">(w = ${fmt(c.w, 2)})</span></span>
      <div class="bar" title="${Math.round(c.r * 100)} %"><i style="width:${Math.round(c.r * 100)}%"></i></div></div>`).join('');
  }

  function renderReco() {
    const p = P, e = E, b = REC.best;
    if (!b) {
      $('reco').innerHTML = e.risk < 25
        ? '<p class="note">Uz trenutne uvjete parametri iz WPS-a su prihvatljivi. Zavarivanje može početi.</p>'
        : '<p class="note">Unutar dopuštenih promjena struje, brzine i predgrijavanja nije pronađena bolja kombinacija. Potrebna je stručna procjena, npr. promjena dodatnog materijala ili WPS-a.</p>';
      return;
    }
    const q = b.p, f = b.e;
    const row = (n, a, c, u, d = 0) => {
      const same = Math.abs(a - c) < (d ? 0.05 : 0.5);
      return `<tr><td>${n}</td><td>${fmt(a, d)} ${u}</td><td class="${same ? '' : 'chg'}">${fmt(c, d)} ${u}</td></tr>`;
    };
    const Ir = Math.round(q.I / 5) * 5;
    $('reco').innerHTML = `<div class="tablewrap"><table class="t">
      <tr><th>Veličina</th><th>Sada</th><th>Preporuka</th></tr>
      ${row(q.T0 > p.T0 ? 'Temperatura komada (predgrijati na)' : q.T0 < p.T0 ? 'Temperatura komada (ohladiti na)' : 'Temperatura komada', p.T0, q.T0, '°C')}
      ${row('Struja', p.I, Ir, 'A')}
      ${row('Napon', p.U, q.U, 'V', 1)}
      ${row('Brzina zavarivanja', p.v, q.v, 'cm/min')}
      ${row('Unos topline', e.Q, f.Q, 'kJ/mm', 2)}
      ${row('t8/5', e.t85, f.t85, 's', 1)}
      ${row('Tvrdoća ZUT-a', e.HV, f.HV, 'HV')}
      <tr><td>Indeks rizika</td><td>${Math.round(e.risk)}</td><td class="chg">${Math.round(f.risk)}</td></tr>
      </table></div>
      <p class="note">Unos topline ostaje unutar ±25 % WPS-a. Prije primjene provjeri je li preporuka unutar granica odobrenog WPS-a.</p>
      <div class="row noprint" style="margin-top:12px"><button type="button" id="apply">Primijeni preporuku</button></div>`;
    $('apply').onclick = () => {
      const T0changed = q.T0 !== p.T0;
      $('T0').value = q.T0; $('I').value = Ir; $('U').value = String(Math.round(q.U * 2) / 2).replace('.', ','); $('v').value = Math.round(q.v);
      render();
      if (T0changed) $('reco').insertAdjacentHTML('afterbegin', `<p class="warnline">Temperatura komada ${fmt(q.T0, 0)} °C sada je planirana vrijednost. Prije zavarivanja izmjeri stvarnu temperaturu i upiši je.</p>`);
    };
  }

  /* ---------------- SVG pomoćnici ---------------- */
  function axes(o) {
    // o: {W,H,L,R,T,B,x0,x1,y0,y1,xt,yt,xl,yl}
    const X = x => o.L + (x - o.x0) / (o.x1 - o.x0) * (o.W - o.L - o.R);
    const Y = y => o.H - o.B - (y - o.y0) / (o.y1 - o.y0) * (o.H - o.T - o.B);
    const line = css('--line'), ink = css('--ink');
    let s = '';
    for (const t of o.xt) s += `<line x1="${X(t)}" x2="${X(t)}" y1="${o.T}" y2="${o.H - o.B}" stroke="${line}"/><text x="${X(t)}" y="${o.H - o.B + 16}" text-anchor="middle">${o.xf ? o.xf(t) : t}</text>`;
    for (const t of o.yt) s += `<line x1="${o.L}" x2="${o.W - o.R}" y1="${Y(t)}" y2="${Y(t)}" stroke="${line}" opacity=".6"/><text x="${o.L - 6}" y="${Y(t) + 4}" text-anchor="end">${o.yf ? o.yf(t) : t}</text>`;
    s += `<line x1="${o.L}" x2="${o.W - o.R}" y1="${o.H - o.B}" y2="${o.H - o.B}" stroke="${ink}"/>`;
    s += `<line x1="${o.L}" x2="${o.L}" y1="${o.T}" y2="${o.H - o.B}" stroke="${ink}"/>`;
    if (o.xl) s += `<text x="${(o.L + o.W - o.R) / 2}" y="${o.H - 6}" text-anchor="middle">${o.xl}</text>`;
    if (o.yl) s += `<text transform="translate(13 ${(o.T + o.H - o.B) / 2}) rotate(-90)" text-anchor="middle">${o.yl}</text>`;
    return { X, Y, s };
  }
  function ticks(a, b, n = 6) {
    const raw = (b - a) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(k => k >= raw) || raw;
    const out = []; for (let t = Math.ceil(a / step) * step; t <= b + 1e-9; t += step) out.push(+t.toFixed(6));
    return out;
  }

  /* ---------------- toplinski ciklus ---------------- */
  let CYC = null;
  function renderCycle() {
    const p = P;
    $('yOut').textContent = fmt(probeY, 1);
    $('yProbe').value = probeY;
    const tEnd = clamp(3 * E.t85 + 25, 30, 300);
    const c = W.thermalCycle(p, probeY, p.T0, tEnd);
    CYC = c;
    const o = { W: 520, H: 300, L: 50, R: 14, T: MC.pts ? 34 : 14, B: 40, x0: c.pts[0][0], x1: tEnd, y0: 0,
      y1: Math.min(Math.max(c.peak * 1.08, MC.stats ? MC.stats.peak * 1.06 : 0, 900), 2100) };
    o.xt = ticks(Math.ceil(o.x0), o.x1, 6); o.yt = ticks(0, o.y1, 6); o.xl = 'vrijeme, s'; o.yl = 'temperatura, °C';
    const A = axes(o); let s = A.s;
    const straw = css('--straw'), bronze = css('--bronze'), blue = css('--blue'), ink = css('--ink');
    if (Number.isFinite(c.t85)) {
      s += `<rect x="${A.X(c.t800)}" y="${o.T}" width="${A.X(c.t500) - A.X(c.t800)}" height="${o.H - o.T - o.B}" fill="${straw}" opacity=".25"/>`;
      s += `<text x="${(A.X(c.t800) + A.X(c.t500)) / 2}" y="${o.T + 14}" text-anchor="middle" style="fill:${ink};font-weight:600">t8/5 = ${fmt(c.t85, 1)} s</text>`;
    }
    for (const [lv, lab] of [[800, '800 °C'], [500, '500 °C'], [1500, 'talište']]) {
      if (lv < o.y1) s += `<line x1="${o.L}" x2="${o.W - o.R}" y1="${A.Y(lv)}" y2="${A.Y(lv)}" stroke="${bronze}" stroke-dasharray="5 4"/><text x="${o.W - o.R - 4}" y="${A.Y(lv) - 4}" text-anchor="end">${lab}</text>`;
    }
    const pts = c.pts.map(q => A.X(q[0]).toFixed(1) + ',' + A.Y(Math.min(q[1], o.y1)).toFixed(1)).join(' ');
    s += `<polyline fill="none" stroke="${blue}" stroke-width="2.5" points="${pts}"/>`;
    if (MC.pts && MC.stats) {                         // učitani ciklus, vrh poravnat s vrhom modela
      const sh = c.tPeak - MC.stats.tPeak;
      const mp = MC.pts.filter(q => q[0] + sh >= o.x0 && q[0] + sh <= o.x1)
        .map(q => A.X(q[0] + sh).toFixed(1) + ',' + A.Y(Math.min(Math.max(q[1], 0), o.y1)).toFixed(1));
      s += `<polyline fill="none" stroke="${bronze}" stroke-width="2" stroke-dasharray="6 3" points="${mp.join(' ')}"/>`;
      s += `<line x1="${o.L}" x2="${o.L + 22}" y1="12" y2="12" stroke="${blue}" stroke-width="2.5"/><text x="${o.L + 28}" y="16" style="fill:${ink}">Rosenthal</text>`;
      s += `<line x1="${o.L + 120}" x2="${o.L + 142}" y1="12" y2="12" stroke="${bronze}" stroke-width="2" stroke-dasharray="6 3"/><text x="${o.L + 148}" y="16" style="fill:${ink}">učitani ciklus</text>`;
    }
    s += `<circle id="cycMark" r="5" fill="${ink}" cx="-20" cy="-20"/>`;
    $('cycle').innerHTML = s;
    CYC.axes = A; CYC.o = o;
    let txt = `Vršna temperatura <b>${fmt(Math.min(c.peak, 3000), 0)} °C</b>. `;
    if (c.peak >= W.T_MELT) txt += 'Točka je u talini. ';
    if (Number.isFinite(c.t85)) txt += `t8/5 s krivulje: <b>${fmt(c.t85, 1)} s</b> (Rosenthal, F = 1); prema EN 1011-2: <b>${fmt(E.t85, 1)} s</b>.`;
    else txt += 'Točka ne doseže 800 °C, pa za nju t8/5 nije definiran.';
    $('cycleOut').innerHTML = txt;
    renderMeasured();
  }

  /* ---------------- učitani toplinski ciklus i kalibracija k ---------------- */
  function renderMeasured() {
    if (!MC.pts || !MC.stats || !P) { $('mcOut').innerHTML = ''; return; }
    const y = numv($('mcY').value);
    const st = MC.stats;
    const pBase = { ...P, kEff: undefined };
    const model = Number.isFinite(y) ? W.thermalCycle(P, y, P.T0, clamp(3 * (st.t85 || E.t85) + 40, 40, 400)) : null;
    const row = (n, a, b, u, dd) => `<tr><td>${n}</td><td>${Number.isFinite(a) ? fmt(a, dd) + ' ' + u : '–'}</td><td>${Number.isFinite(b) ? fmt(b, dd) + ' ' + u : '–'}</td></tr>`;
    let h = `<div class="tablewrap"><table class="t"><tr><th></th><th>Učitano</th><th>Model (Rosenthal, ${fmt(y, 1)} mm${KCAL.on ? ', kalibrirani k' : ''})</th></tr>` +
      row('Vršna temperatura', st.peak, model && Math.min(model.peak, 3000), '°C', 0) +
      row('t8/5', st.t85, model && model.t85, 's', 1) + '</table></div>' +
      `<p class="note">Za usporedbu, t8/5 prema EN 1011-2 iznosi ${fmt(E.t85, 1)} s. Rosenthal raspoređuje toplinu po cijeloj debljini, pa uz površinu daje niže vršne temperature od stvarnih; t8/5 se u ZUT-u s udaljenošću mijenja malo.</p>`;
    if (mcStale()) h = '<p class="warnline">Ciklus je učitan uz druge ulaze (struja, napon, brzina, debljina, temperatura komada…) nego što su sada upisani, pa usporedba i kalibracija ne vrijede za trenutne ulaze.</p>' + h;
    if (!Number.isFinite(st.t85)) h += `<p class="warnline">Učitani ciklus ne prolazi kroz 800 i 500 °C (vrh ${fmt(st.peak, 0)} °C), pa t8/5 i kalibracija nisu mogući. Kalibracija treba ciklus iz ZUT-a s vrhom iznad 800 °C, najbolje oko 1.000 do 1.350 °C.</p>`;
    else {
      h += `<div class="row" style="margin-top:10px"><button type="button" id="mcCal">Kalibriraj k prema ovom ciklusu</button>` +
        (KCAL.on ? `<button type="button" class="ghost" id="mcReset">Vrati k iz norme (${fmt(W.K[P.proc], 1)})</button>` : '') + '</div>';
      if (Number.isFinite(KCAL.k)) h += `<p class="note">Kalibrirani k = <b>${fmt(KCAL.k, 3)}</b> (norma za ${P.proc}: ${fmt(W.K[P.proc], 1)})${KCAL.note ? '. ' + esc(KCAL.note) : ''}. ${KCAL.on ? 'Primijenjen je u svim izračunima na stranici i u generatoru za CalculiX.' : ''}</p>`;
      if (Number.isFinite(KCAL.k) && !KCAL.on) h += `<div class="row"><button type="button" id="mcApply">Primijeni k = ${fmt(KCAL.k, 2)}</button></div>`;
    }
    $('mcOut').innerHTML = h;
    const b1 = $('mcCal'), b2 = $('mcReset'), b3 = $('mcApply');
    if (b1) b1.onclick = () => {
      const r = W.calibrateK(pBase, y, st.t85, P.T0);
      if (!Number.isFinite(r.k)) { $('mcStatus').textContent = 'Kalibracija nije moguća: ' + r.reason + '.'; return; }
      Object.assign(KCAL, { k: r.k, on: false, note: r.reason || '', from: MC.name });
      $('mcStatus').textContent = '';
      renderMeasured();
    };
    if (b2) b2.onclick = () => { KCAL.on = false; render(); };
    if (b3) b3.onclick = () => { KCAL.on = true; render(); };
  }

  function parseTwoColsTime(text) {
    const out = [];
    text.replace(/^\ufeff/, '').split(/\r?\n/).forEach(line => {
      const t = line.trim(); if (!t || /^[#!*]/.test(t)) return;
      let parts = t.includes(';') ? t.split(';') : t.includes('\t') ? t.split('\t') : (t.match(/,/g) || []).length === 1 && /\s/.test(t) === false ? t.split(',') : t.split(/\s+/);
      parts = parts.map(x => x.trim()).filter(Boolean);
      if (parts.length < 2) return;
      const a = parseFloat(parts[0].replace(',', '.')), b = parseFloat(parts[1].replace(',', '.'));
      if (Number.isFinite(a) && Number.isFinite(b)) out.push([a, b]);
    });
    return out.sort((p, q) => p[0] - q[0]);
  }
  $('mcFile').addEventListener('change', async ev => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    const text = await f.text(); let pts = parseTwoColsTime(text);
    const keep = MC.pts ? ' Prethodno učitani ciklus ostaje.' : '';
    if (pts.length < 5) { $('mcStatus').textContent = `U "${f.name}" nije pronađeno barem 5 redaka s vremenom i temperaturom.` + keep; return; }
    const head = text.replace(/^\ufeff/, '').split(/\r?\n/)[0].toLowerCase().split(/[;,\t]|\s+/).filter(Boolean);
    const notes = [];
    // zamijenjeni stupci: zaglavlje kaže da je temperatura prva
    const isTemp = h => /temp|°|^t_?(c|k)$|\((c|k|°c)\)/.test(h), isTime = h => /vrij|time|^t_?s$|\(s\)|^s$/.test(h);
    if (head.length >= 2 && isTemp(head[0]) && isTime(head[1])) {
      pts = pts.map(q => [q[1], q[0]]).sort((u, v) => u[0] - v[0]); notes.push('stupci su zamijenjeni prema zaglavlju (prvi je bio temperatura)');
    }
    if (head.some(h => /\(k\)|_k\b|kelvin|^k$/.test(h))) { pts = pts.map(q => [q[0], q[1] - 273.15]); notes.push('temperature pretvorene iz K u °C'); }
    if (pts.some(q => q[1] > 3500)) { $('mcStatus').textContent = `U "${f.name}" ima temperatura iznad 3.500 °C. Jesu li u kelvinima? U zaglavlje drugog stupca stavi "T_K" ili ih zapiši u °C.` + keep; return; }
    Object.assign(MC, { pts, name: f.name, stats: W.cycleStats(pts), sig: sigCyc(P) });
    KCAL.k = NaN;
    const y = numv($('mcY').value);
    if (Number.isFinite(y)) { probeY = y; probeAuto = false; }
    $('mcStatus').textContent = `Učitano ${pts.length} ${plural(pts.length, 'točka', 'točke', 'točaka')} iz "${f.name}"${notes.length ? ' (' + notes.join('; ') + ')' : ''}. Upiši udaljenost točke mjerenja od osi zavara.`;
    if (P) { renderCycle(); if (!playing) drawField(); }
  });
  $('mcY').addEventListener('input', () => {
    const y = numv($('mcY').value);
    if (MC.pts && Number.isFinite(y) && y > 0) { probeY = y; probeAuto = false; KCAL.k = KCAL.on ? KCAL.k : NaN; if (P) { renderCycle(); if (!playing) drawField(); } }
  });
  $('mcClear').addEventListener('click', () => {
    Object.assign(MC, { pts: null, name: '', stats: null, sig: '' });
    $('mcStatus').textContent = 'Učitani ciklus je uklonjen.' + (KCAL.on ? ' Kalibrirani k ostaje primijenjen dok ga ne vratiš na vrijednost iz norme.' : '');
    if (P) renderCycle();
  });

  /* ---------------- zaostala naprezanja ---------------- */
  function renderStress() {
    const p = P, M = W.stressModels(p, p.T0); SM = M;
    const bronze = css('--bronze'), blue = css('--blue'), ink = css('--ink'), straw = css('--straw'), muted = css('--muted');
    const showMM = $('smMM').checked, showOK = $('smOK').checked;
    const half = p.B / 2;
    // --- uzdužno ---
    const ym = Math.min(half, Math.max(4 * M.MM.b, 1.3 * M.OK.b, 30));
    const femX = FEM.x && FEM.x.length ? FEM.x : null;
    let yLo = Math.min(-0.6 * p.Re, showOK ? 1.1 * M.OK.comp : 0), yHi = 1.15 * p.Re;
    if (femX) femX.forEach(q => { yLo = Math.min(yLo, q[1] * 1.1); yHi = Math.max(yHi, q[1] * 1.1); });
    const o = { W: 760, H: 320, L: 56, R: 16, T: 40, B: 40, x0: -ym, x1: ym, y0: yLo, y1: yHi };
    o.xt = ticks(-ym, ym, 8); o.yt = ticks(o.y0, o.y1, 6); o.xl = 'udaljenost od osi zavara y, mm'; o.yl = 'σx, MPa';
    const A = axes(o); let s = A.s;
    s += `<rect x="${A.X(-M.MM.yF || -ST.yF)}" y="${o.T}" width="${A.X(ST.yF) - A.X(-ST.yF)}" height="${o.H - o.T - o.B}" fill="${straw}" opacity=".35"/>`;
    s += `<text x="${A.X(0)}" y="${o.T + 12}" text-anchor="middle">talina</text>`;
    s += `<line x1="${o.L}" x2="${o.W - o.R}" y1="${A.Y(0)}" y2="${A.Y(0)}" stroke="${ink}" opacity=".6"/>`;
    s += `<line x1="${o.L}" x2="${o.W - o.R}" y1="${A.Y(p.Re)}" y2="${A.Y(p.Re)}" stroke="${muted}" stroke-dasharray="2 4"/><text x="${o.L + 6}" y="${A.Y(p.Re) - 5}">Re = ${fmt(p.Re, 0)} MPa</text>`;
    const curve = (f, col, w, dash) => {
      const pts = [];
      for (let i = 0; i <= 600; i++) { const y = -ym + 2 * ym * i / 600, v = f(y); if (Number.isFinite(v)) pts.push(A.X(y).toFixed(1) + ',' + A.Y(v).toFixed(1)); }
      return `<polyline fill="none" stroke="${col}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linejoin="round" points="${pts.join(' ')}"/>`;
    };
    if (showOK) s += curve(M.OK.at, bronze, 2.4, '');
    if (showMM) s += curve(M.MM.at, ink, 2.4, '');
    const showSU = $('smSU').checked && SU.pred;
    if (showSU) {
      const prof = window.SUR.profile(SU.pred), q = SU.pred.out.sxMax, violet = css('--violet');
      const band = [];
      for (let i = 0; i <= 200; i++) { const y = -ym + 2 * ym * i / 200, f = q.val > 1e-6 ? prof(y) / q.val : 0; band.push([y, Math.max(f * q.vlo, f * q.vup), Math.min(f * q.vlo, f * q.vup)]); }
      s += `<polygon fill="${violet}" opacity=".16" points="${band.map(r => A.X(r[0]).toFixed(1) + ',' + A.Y(r[1]).toFixed(1)).concat(band.slice().reverse().map(r => A.X(r[0]).toFixed(1) + ',' + A.Y(r[2]).toFixed(1))).join(' ')}"/>`;
      s += curve(prof, violet, 2.6, '');
    }
    if (femX) {
      s += `<polyline fill="none" stroke="${blue}" stroke-width="1.5" points="${femX.filter(q => Math.abs(q[0]) <= ym).map(q => A.X(q[0]).toFixed(1) + ',' + A.Y(q[1]).toFixed(1)).join(' ')}"/>`;
      femX.filter(q => Math.abs(q[0]) <= ym).forEach(q => { s += `<circle cx="${A.X(q[0]).toFixed(1)}" cy="${A.Y(q[1]).toFixed(1)}" r="2.6" fill="${blue}"/>`; });
    }
    // legenda
    let lx = o.W - o.R - 8, items = [];
    if (showMM) items.push(['Masubuchi i Martin', ink]);
    if (showOK) items.push(['Okerblom', bronze]);
    if (showSU) items.push(['Surogatni model', css('--violet')]);
    if (femX) items.push(['CalculiX', blue]);
    let lxx = o.L; items.forEach(it => { s += `<line x1="${lxx}" x2="${lxx + 22}" y1="14" y2="14" stroke="${it[1]}" stroke-width="3"/><text x="${lxx + 28}" y="18" style="fill:${ink}">${it[0]}</text>`; lxx += 40 + it[0].length * 7; });
    $('stress').innerHTML = s;

    // tablica usporedbe
    const rows = [];
    const femStats = femX ? (() => {
      const pk = Math.max(...femX.map(q => q[1])), mn = Math.min(...femX.map(q => q[1]));
      // poluširina vlačne zone: prvi prolaz kroz nulu desno od najvećeg naprezanja (linearna interpolacija)
      const r = femX.filter(q => q[0] >= 0).sort((u, v) => u[0] - v[0]);
      let im = 0; r.forEach((q, i) => { if (q[1] > r[im][1]) im = i; });
      let b = NaN; for (let i = im + 1; i < r.length; i++) if (r[i - 1][1] > 0 && r[i][1] <= 0) { b = r[i - 1][0] + (r[i][0] - r[i - 1][0]) * r[i - 1][1] / (r[i - 1][1] - r[i][1]); break; }
      return { peak: pk, comp: mn, b };
    })() : null;
    if (showMM) rows.push(['Masubuchi i Martin', M.MM.peak, M.MM.b, M.MM.comp, M.MM.F]);
    if (showOK) rows.push(['Okerblom', M.OK.peak, M.OK.b, M.OK.comp, M.OK.F]);
    if (showSU) rows.push(['Surogatni model', SU.pred.out.sxMax.val, SU.pred.out.b0.val, NaN, NaN]);
    const stale = femStale();
    if (femStats) rows.push([stale ? 'CalculiX (učitano za druge ulaze)' : 'CalculiX (učitano)', femStats.peak, femStats.b, femStats.comp, NaN]);
    $('stressTable').innerHTML = rows.length ? `<tr><th>Model</th><th>Najveći σx, MPa</th><th>Poluširina vlačne zone b, mm</th><th>Najveći tlak, MPa</th><th>Sila skupljanja, kN</th></tr>` +
      rows.map(r => `<tr><td>${r[0]}</td><td>${fmt(r[1], 0)}</td><td>${fmt(r[2], 1)}</td><td>${fmt(r[3], 0)}</td><td>${Number.isFinite(r[4]) ? fmt(r[4], 0) : '–'}</td></tr>`).join('') : '';
    $('stressWarn').textContent = [(femX || FEM.y) && stale ? 'Učitani rezultati iz CalculiX-a izračunati su za druge ulaze nego što su sada upisani, pa usporedba s modelima ne vrijedi. Vrati ulaze ili učitaj nove rezultate.' : '',
      showOK && M.OK.warn.length ? 'Okerblom: ' + M.OK.warn.join('; ') + '.' : ''].filter(Boolean).join(' ');

    // --- poprečno duž zavara ---
    const TR = M.TR, femY = FEM.y && FEM.y.length ? FEM.y : null;
    let t0 = -p.Re * 0.6, t1 = p.Re * 0.9;
    if (femY) femY.forEach(q => { t0 = Math.min(t0, q[1] * 1.1); t1 = Math.max(t1, q[1] * 1.1); });
    const o2 = { W: 760, H: 290, L: 56, R: 16, T: 40, B: 40, x0: 0, x1: p.L, y0: t0, y1: t1 };
    o2.xt = ticks(0, p.L, 8); o2.yt = ticks(t0, t1, 6); o2.xl = 'položaj duž zavara x, mm'; o2.yl = 'σy, MPa';
    const A2 = axes(o2); let s2 = A2.s;
    s2 += `<line x1="${o2.L}" x2="${o2.W - o2.R}" y1="${A2.Y(0)}" y2="${A2.Y(0)}" stroke="${ink}" opacity=".6"/>`;
    const c2 = (f, col, w, dash) => {
      const pts = []; for (let i = 0; i <= 300; i++) { const x = p.L * i / 300; pts.push(A2.X(x).toFixed(1) + ',' + A2.Y(f(x)).toFixed(1)); }
      return `<polyline fill="none" stroke="${col}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''} points="${pts.join(' ')}"/>`;
    };
    s2 += c2(TR.free, muted, 1.8, '6 4');
    s2 += c2(TR.at, ink, 2.4, '');
    if (femY) s2 += femY.filter(q => q[0] >= 0 && q[0] <= p.L).map(q => `<circle cx="${A2.X(q[0]).toFixed(1)}" cy="${A2.Y(q[1]).toFixed(1)}" r="2.6" fill="${blue}"/>`).join('');
    const leg2 = [['slobodne ploče', muted, '6 4'], [`s ukliještenošću (${({ low: 'mala', mid: 'srednja', high: 'velika' })[p.restr]})`, ink, '']].concat(femY ? [['CalculiX', blue, '']] : []);
    let lx2 = o2.L; leg2.forEach(it => { s2 += `<line x1="${lx2}" x2="${lx2 + 22}" y1="14" y2="14" stroke="${it[1]}" stroke-width="3" ${it[2] ? `stroke-dasharray="${it[2]}"` : ''}/><text x="${lx2 + 28}" y="18" style="fill:${ink}">${it[0]}</text>`; lx2 += 40 + it[0].length * 7; });
    $('stressT').innerHTML = s2;

    {
      const parts = [`Analitički modeli: vrh σx ≈ Re = <b>${fmt(p.Re, 0)} MPa</b> u osi zavara, vlačna zona ±${fmt(M.MM.b, 1)} mm (Masubuchi i Martin) odnosno ±${fmt(M.OK.b, 1)} mm (Okerblom), σy u sredini ≈ ${fmt(TR.at(p.L / 2), 0)} MPa.`];
      if (SU.pred) parts.push(`Surogatni model: najveći σx <b>${fmt(SU.pred.out.sxMax.val, 0)} MPa</b>, vlačna zona ±${fmt(SU.pred.out.b0.val, 1)} mm, σy u sredini <b>${fmt(SU.pred.out.syMid.val, 0)} MPa</b>.`);
      if (femStats) parts.push(`CalculiX (učitano${stale ? ' za druge ulaze' : ''}): najveći σx <b>${fmt(femStats.peak, 0)} MPa</b>${Number.isFinite(femStats.b) ? `, vlačna zona ±${fmt(femStats.b, 1)} mm` : ''}.`);
      if (femY) { const mid = femY.filter(q => Math.abs(q[0] - p.L / 2) < p.L * 0.15); if (mid.length) parts.push(`CalculiX σy u sredini zavara ≈ <b>${fmt(mid.reduce((a, q) => a + q[1], 0) / mid.length, 0)} MPa</b>.`); }
      $('stressOut').innerHTML = parts.join('<br>');
    }
  }

  /* ---------------- temperaturno polje (canvas) ---------------- */
  const FW = 480, FH = 192, PX = 200, PY = 80, SC = FW / PX;   // ploča 200 × 80 mm
  const GW = 240, GH = 96;                                        // mreža izračuna
  const fcv = $('field'), fctx = fcv.getContext('2d');
  const off = document.createElement('canvas'); off.width = GW; off.height = GH;
  const octx = off.getContext('2d'); const img = octx.createImageData(GW, GH);
  let xs = 60, playing = !reduceMotion, visible = true, lastT = 0, fieldStateDirty = true, SRC = null, PLATE = [86, 98, 108];
  const PROBE_X = 100;

  const HOT = [[500, [150, 38, 24]], [800, [205, 60, 22]], [1100, [242, 130, 30]], [1500, [255, 214, 90]], [2000, [255, 248, 215]]];
  function heatColor(T) {
    const T0 = SRC.T0;
    if (T < 500) {
      const t = clamp((T - T0 - 20) / (480 - T0), 0, 1);
      const straw = hexRgb(css('--straw') || '#D6AE55');
      return t < .5 ? mix(PLATE, straw, t * 1.2) : mix(mix(PLATE, straw, .6), [150, 38, 24], (t - .5) * 2);
    }
    for (let i = 0; i < HOT.length - 1; i++) {
      if (T < HOT[i + 1][0]) return mix(HOT[i][1], HOT[i + 1][1], (T - HOT[i][0]) / (HOT[i + 1][0] - HOT[i][0]));
    }
    return HOT[HOT.length - 1][1];
  }
  const band = T => T >= 1500 ? 3 : T >= 800 ? 2 : T >= 500 ? 1 : 0;

  function drawField() {
    if (!P) return;
    if (fieldStateDirty) {
      SRC = W.sourceState(P, P.T0); fieldStateDirty = false;
      PLATE = hexRgb(css('--plate') || '#56626C');
    }
    const yF = ST.yF, bands = new Uint8Array(GW * GH), temps = new Float32Array(GW * GH);
    for (let j = 0; j < GH; j++) {
      const y = PY / 2 - (j + .5) * PY / GH;
      for (let i = 0; i < GW; i++) {
        const x = (i + .5) * PX / GW;
        const T = W.rosenthal(x - xs, Math.abs(y), 0, SRC);
        temps[j * GW + i] = T; bands[j * GW + i] = band(T);
      }
    }
    const data = img.data;
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const k = j * GW + i, T = temps[k], x = (i + .5) * PX / GW, y = PY / 2 - (j + .5) * PY / GH;
      let c;
      if (T < 520 && x < xs && Math.abs(y) < Math.max(yF, 1.2)) {
        const rip = 12 * Math.sin(x * 2.2);
        c = [168 + rip, 174 + rip, 180 + rip];
      } else c = heatColor(T);
      const edge = (i > 0 && bands[k - 1] !== bands[k]) || (j > 0 && bands[k - GW] !== bands[k]);
      if (edge && T > 450) c = [255, 255, 255];
      data[4 * k] = c[0]; data[4 * k + 1] = c[1]; data[4 * k + 2] = c[2]; data[4 * k + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    fctx.imageSmoothingEnabled = true;
    fctx.drawImage(off, 0, 0, FW, FH);
    // izvor
    if (xs >= 0 && xs <= PX) {
      fctx.fillStyle = '#fff'; fctx.beginPath(); fctx.arc(xs * SC, FH / 2, 4, 0, 7); fctx.fill();
    }
    // točka mjerenja
    const py = FH / 2 - probeY * SC, px = PROBE_X * SC;
    fctx.strokeStyle = 'rgba(255,255,255,.85)'; fctx.setLineDash([4, 4]); fctx.lineWidth = 1;
    fctx.beginPath(); fctx.moveTo(0, py); fctx.lineTo(FW, py); fctx.stroke(); fctx.setLineDash([]);
    fctx.fillStyle = '#17212B'; fctx.strokeStyle = '#fff'; fctx.lineWidth = 2;
    fctx.beginPath(); fctx.arc(px, py, 5, 0, 7); fctx.fill(); fctx.stroke();
    const Tp = W.rosenthal(PROBE_X - xs, probeY, 0, SRC);
    fctx.font = '600 13px Barlow, Arial, sans-serif'; fctx.fillStyle = '#fff';
    fctx.fillText(`${Math.round(Math.min(Tp, 3000))} °C`, px + 9, py - 8);
    // mjerilo
    fctx.fillStyle = '#fff'; fctx.fillRect(10, FH - 14, 10 * SC, 3);
    fctx.font = '12px Barlow, Arial, sans-serif'; fctx.fillText('10 mm', 10, FH - 20);
    // oznaka na ciklusu
    const mk = document.getElementById('cycMark');
    if (mk && CYC && CYC.axes) {
      const t = (xs - PROBE_X) / SRC.v;
      if (t >= CYC.o.x0 && t <= CYC.o.x1) {
        mk.setAttribute('cx', CYC.axes.X(t)); mk.setAttribute('cy', CYC.axes.Y(Math.min(Tp, CYC.o.y1)));
      } else { mk.setAttribute('cx', -20); mk.setAttribute('cy', -20); }
    }
  }

  function tick(ts) {
    if (playing && visible && P) {
      const dt = lastT ? Math.min((ts - lastT) / 1000, 0.1) : 0;
      const speed = clamp(SRC ? SRC.v * 4 : 15, 8, 40);
      xs += speed * dt;
      const tail = CYC ? Math.min(CYC.o.x1 * (SRC ? SRC.v : 4), 400) : 120;
      if (xs > PX + tail) xs = -20;
      drawField();
    }
    lastT = ts;
    requestAnimationFrame(tick);
  }

  function legend() {
    const sw = c => `<i style="background:${c}"></i>`;
    $('fieldLegend').innerHTML =
      `<span>${sw('var(--straw)')}ispod 500 °C</span><span>${sw('rgb(170,45,22)')}500–800 °C</span>` +
      `<span>${sw('rgb(242,130,30)')}800–1500 °C</span><span>${sw('rgb(255,240,190)')}talina</span>` +
      `<span>${sw('rgb(172,178,184)')}zavar</span><span>bijele linije: izoterme 500, 800 i 1500 °C</span>`;
  }

  /* ---------------- procesni prozor ---------------- */
  const pcv = $('pw'), pctx = pcv.getContext('2d');
  const PWL = 64, PWR = 20, PWT = 16, PWB = 48, PWW = 760, PWH = 420;
  let PWD = null;
  const TINT = [[0, '#C9CFD4'], [.18, '#E3CF8E'], [.32, '--straw'], [.52, '--bronze'], [.72, '--violet'], [1, '--blue']];
  function tintColor(r) {
    const t = clamp(r / 100);
    const stops = TINT.map(([k, c]) => [k, hexRgb(c.startsWith('--') ? css(c) : c)]);
    for (let i = 0; i < stops.length - 1; i++) {
      if (t <= stops[i + 1][0]) return mix(stops[i][1], stops[i + 1][1], (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]));
    }
    return stops[stops.length - 1][1];
  }
  function pwT0() {
    if (pwMode === 'A') return numv($('TA').value);
    if (pwMode === 'B') return numv($('TB').value);
    if (pwMode === 'reco') return REC && REC.best ? REC.best.p.T0 : P.T0;
    return P.T0;
  }
  function renderPW() {
    const T0 = pwT0();
    if (!Number.isFinite(T0)) return;
    const d = W.processWindow(P, T0, { coupleU: P.coupleU });
    PWD = { ...d, T0 };
    const ctx = pctx, iw = PWW - PWL - PWR, ih = PWH - PWT - PWB;
    ctx.clearRect(0, 0, PWW, PWH);
    const oc = document.createElement('canvas'); oc.width = d.nI; oc.height = d.nV;
    const ox = oc.getContext('2d'), im = ox.createImageData(d.nI, d.nV);
    for (let j = 0; j < d.nV; j++) for (let i = 0; i < d.nI; i++) {
      const c = tintColor(d.grid[j][i]), k = 4 * ((d.nV - 1 - j) * d.nI + i);
      im.data[k] = c[0]; im.data[k + 1] = c[1]; im.data[k + 2] = c[2]; im.data[k + 3] = 255;
    }
    ox.putImageData(im, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(oc, PWL, PWT, iw, ih);
    const X = I => PWL + (I - d.I1) / (d.I2 - d.I1) * iw;
    const Y = v => PWT + ih - (v - d.v1) / (d.v2 - d.v1) * ih;
    const ink = css('--ink'), muted = css('--muted');
    // linije jednakog unosa topline
    for (const [f, dash] of [[1, []], [0.75, [6, 5]], [1.25, [6, 5]]]) {
      ctx.setLineDash(dash); ctx.strokeStyle = ink; ctx.lineWidth = f === 1 ? 2 : 1.4; ctx.beginPath();
      let started = false, last = null;
      for (let k = 0; k <= 200; k++) {
        const I = d.I1 + (d.I2 - d.I1) * k / 200;
        const U = P.coupleU ? W.coupledVoltage(P.proc, P.U, P.I, I) : P.U;
        const v = W.K[P.proc] * U * I / (d.Q0 * f * 1000) * 6;
        if (v < d.v1 || v > d.v2) { started = false; continue; }
        if (!started) { ctx.moveTo(X(I), Y(v)); started = true; } else ctx.lineTo(X(I), Y(v));
        last = [X(I), Y(v)];
      }
      ctx.stroke();
      if (last) {
        ctx.setLineDash([]); ctx.fillStyle = ink; ctx.font = '600 12px Barlow, Arial, sans-serif';
        ctx.fillText(f === 1 ? 'Q iz WPS-a' : (f < 1 ? '−25 %' : '+25 %'), Math.min(last[0] + 4, PWW - PWR - 60), Math.max(last[1] - 4, PWT + 12));
      }
    }
    ctx.setLineDash([]);
    // osi
    ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.strokeRect(PWL, PWT, iw, ih);
    ctx.fillStyle = muted; ctx.font = '12px Barlow, Arial, sans-serif'; ctx.textAlign = 'center';
    ticks(d.I1, d.I2, 8).forEach(t => ctx.fillText(t, X(t), PWT + ih + 16));
    ctx.fillText('struja I, A', PWL + iw / 2, PWH - 8);
    ctx.textAlign = 'right';
    ticks(d.v1, d.v2, 6).forEach(t => ctx.fillText(t, PWL - 6, Y(t) + 4));
    ctx.save(); ctx.translate(16, PWT + ih / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center';
    ctx.fillText('brzina v, cm/min', 0, 0); ctx.restore();
    ctx.textAlign = 'left';
    // trenutna točka
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(X(P.I), Y(P.v), 12, 0, 7); ctx.stroke();
    ctx.strokeStyle = '#17212B'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(X(P.I), Y(P.v), 12, 0, 7); ctx.stroke();
    ctx.fillStyle = '#17212B'; ctx.font = '600 12px Barlow, Arial, sans-serif'; ctx.fillText('WPS', X(P.I) + 15, Y(P.v) - 10);
    // preporuka
    if (REC && REC.best && (pwMode === 'meas' || pwMode === 'reco')) {
      const q = REC.best.p, x = X(q.I), y = Y(q.v);
      ctx.strokeStyle = '#17212B'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 7, y); ctx.closePath();
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#17212B'; ctx.font = '600 12px Barlow, Arial, sans-serif';
      ctx.fillText(q.T0 !== P.T0 ? `preporuka, uz ${Math.round(q.T0)} °C` : 'preporuka', x + 15, y + 16);
    }
    $('pwReco').disabled = !(REC && REC.best && REC.best.p.T0 !== P.T0);
    $('pwReco').title = $('pwReco').disabled ? (REC && REC.best ? 'Preporuka ne mijenja temperaturu komada, pa je karta ista kao uz izmjerenu temperaturu.' : 'Nema preporuke: trenutni parametri su prihvatljivi ili nije pronađena bolja kombinacija.') : '';
    $('pwOut').innerHTML = `Karta uz temperaturu komada <b>${fmt(T0, 0)} °C</b>. Krug je trenutna točka iz WPS-a${REC && REC.best && (pwMode === 'meas' || pwMode === 'reco') ? ', romb preporuka' : ''}.`;
  }
  pcv.addEventListener('mousemove', ev => {
    if (!PWD || !P) return;
    const r = pcv.getBoundingClientRect();
    const x = (ev.clientX - r.left) * PWW / r.width, y = (ev.clientY - r.top) * PWH / r.height;
    const iw = PWW - PWL - PWR, ih = PWH - PWT - PWB;
    if (x < PWL || x > PWL + iw || y < PWT || y > PWT + ih) return;
    const I = PWD.I1 + (x - PWL) / iw * (PWD.I2 - PWD.I1), v = PWD.v1 + (PWT + ih - y) / ih * (PWD.v2 - PWD.v1);
    const q = W.variant(P, I, v, PWD.T0, P.coupleU), e = W.evaluate(q);
    $('pwOut').innerHTML = `I = <b>${fmt(I, 0)} A</b>, U = <b>${fmt(q.U, 1)} V</b>, v = <b>${fmt(v, 1)} cm/min</b>: Q = ${fmt(e.Q, 2)} kJ/mm, t8/5 = ${fmt(e.t85, 1)} s, HV ≈ ${Math.round(e.HV)}, rizik <b>${Math.round(e.risk)}</b>`;
  });
  pcv.addEventListener('mouseleave', () => { if (P) renderPW(); });
  document.querySelectorAll('[data-pw]').forEach(b => b.addEventListener('click', () => {
    pwMode = b.dataset.pw;
    document.querySelectorAll('[data-pw]').forEach(x => x.setAttribute('aria-pressed', x === b));
    if (P) renderPW();
  }));

  /* ---------------- sunce i sjena ---------------- */
  function dl(el, T) {
    const e = W.evaluate({ ...P, T0: T });
    const [vt, col] = verdict(e.risk);
    el.innerHTML = `<dt>t8/5</dt><dd>${fmt(e.t85)} s</dd>
      <dt>Tvrdoća ZUT-a</dt><dd>${Math.round(e.HV)} HV</dd>
      <dt>Predgrijavanje ispunjeno</dt><dd>${T >= e.Tneed ? 'da' : 'ne (treba ' + Math.round(e.Tneed) + ' °C)'}</dd>
      <dt>Kondenzacija</dt><dd>${T < e.Td + 3 ? 'moguća' : 'ne'}</dd>
      <dt>Indeks rizika</dt><dd style="color:${col}">${Math.round(e.risk)} (${vt.toLowerCase()})</dd>`;
    return e;
  }
  function renderCompare() {
    const TA = numv($('TA').value), TB = numv($('TB').value);
    if (!Number.isFinite(TA) || !Number.isFinite(TB) || TA >= 450 || TB >= 450) {
      $('dA').innerHTML = $('dB').innerHTML = '<dt>Upiši temperaturu komada ispod 450 °C</dt><dd></dd>'; $('chart').innerHTML = ''; return;
    }
    const eA = dl($('dA'), TA), eB = dl($('dB'), TB);
    const x0 = -10, x1 = 200;
    const pts = []; for (let t = x0; t <= x1; t += 2) { const e = W.evaluate({ ...P, T0: t }); pts.push([t, e.t85, e.HV]); }
    const ymax = Math.max(P.tmax * 1.3, ...pts.map(q => q[1]), eA.t85, eB.t85) * 1.05;
    const hv = pts.map(q => q[2]).concat([E.HVlim]); const h0 = Math.floor((Math.min(...hv) - 20) / 20) * 20, h1 = Math.ceil((Math.max(...hv) + 20) / 20) * 20;
    const o = { W: 640, H: 270, L: 48, R: 52, T: 14, B: 38, x0, x1, y0: 0, y1: ymax, xt: [0, 50, 100, 150, 200], yt: ticks(0, ymax, 5),
      xl: 'temperatura komada, °C', yl: 't8/5, s' };
    const A = axes(o); let s = A.s;
    const blue = css('--blue'), bronze = css('--bronze'), straw = css('--straw'), ink = css('--ink');
    const YH = h => o.H - o.B - (h - h0) / (h1 - h0) * (o.H - o.T - o.B);
    s = `<rect x="${o.L}" y="${A.Y(Math.min(P.tmax, ymax))}" width="${o.W - o.L - o.R}" height="${A.Y(P.tmin) - A.Y(Math.min(P.tmax, ymax))}" fill="${straw}" opacity=".22"/>` + s;
    ticks(h0, h1, 5).forEach(h => { s += `<text x="${o.W - o.R + 6}" y="${YH(h) + 4}">${h}</text>`; });
    s += `<text transform="translate(${o.W - 8} ${(o.T + o.H - o.B) / 2}) rotate(90)" text-anchor="middle">HV</text>`;
    if (E.HVlim > h0 && E.HVlim < h1) s += `<line x1="${o.L}" x2="${o.W - o.R}" y1="${YH(E.HVlim)}" y2="${YH(E.HVlim)}" stroke="${bronze}" stroke-dasharray="2 4"/><text x="${A.X(60)}" y="${YH(E.HVlim) - 4}" text-anchor="middle">granica ${E.HVlim} HV</text>`;
    s += `<polyline fill="none" stroke="${bronze}" stroke-width="2" stroke-dasharray="7 4" points="${pts.map(q => A.X(q[0]) + ',' + YH(q[2])).join(' ')}"/>`;
    s += `<polyline fill="none" stroke="${blue}" stroke-width="2.5" points="${pts.map(q => A.X(q[0]) + ',' + A.Y(q[1])).join(' ')}"/>`;
    s += `<text x="${o.W - o.R - 4}" y="${A.Y(Math.min(P.tmax, ymax)) + 14}" text-anchor="end">ciljani t8/5</text>`;
    const mark = (t, e, lab) => (t >= x0 && t <= x1) ? `<circle cx="${A.X(t)}" cy="${A.Y(e.t85)}" r="6" fill="${ink}"/><text x="${A.X(t) + 9}" y="${A.Y(e.t85) - 8}" style="fill:${ink};font-weight:600">${lab}</text>` : '';
    s += mark(TA, eA, 'A') + mark(TB, eB, 'B');
    s += `<text x="${o.L + 8}" y="${o.H - o.B - 10}" style="fill:${blue};font-weight:600">t8/5 (puna linija)</text><text x="${o.L + 130}" y="${o.H - o.B - 10}" style="fill:${bronze};font-weight:600">tvrdoća ZUT-a (isprekidana)</text>`;
    $('chart').innerHTML = s;
  }

  /* ---------------- surogatni (hibridni) model ---------------- */
  const SU = { M: null, pred: null, out: 'sxMax', err: '' };
  const suRows = () => window.SUROGAT_PODACI.rows.map(r => ({ ...r, y: Object.fromEntries(Object.entries(r.y).map(([k, v]) => [k, v == null ? NaN : v])) }));
  function suInit() {
    if (!window.SUR || !window.SUROGAT_PODACI) { SU.err = 'Podaci za surogatni model nisu učitani.'; return; }
    try { SU.M = window.SUR.train(W, suRows(), { thetas: window.SUROGAT_PODACI.thetas, sel: window.SUROGAT_PODACI.sel }); }
    catch (e) { SU.err = 'Surogatni model nije moguće izgraditi.'; }
  }
  const suFmt = (o, v) => fmt(v, o.dec);
  function renderSurrogate() {
    if (!SU.M) { $('suTable').innerHTML = ''; $('suWarn').textContent = SU.err; return; }
    const S = window.SUR, pr = S.predict(W, SU.M, P); SU.pred = pr; let clipped = false;
    const row = o => {
      const q = pr.out[o.id];
      const cellv = (v, lo, up, on, cl) => {
        const iv = suFmt(o, lo) === suFmt(o, up) ? `${suFmt(o, lo)}` : `${suFmt(o, lo)} do ${suFmt(o, up)}`;
        return `<td>${on ? '<b>' : ''}${suFmt(o, v)}${on ? '</b>' : ''}${cl ? '*' : ''} <span class="muted">(${iv})</span>${on ? ' <span class="tag">odabran</span>' : ''}</td>`;
      };
      if (q.clip.hyb || q.clip.pure) clipped = true;
      return `<tr><td>${o.lab}, ${o.unit}</td><td>${suFmt(o, q.ana)}</td>${cellv(q.hyb, q.lo, q.up, q.sel === 'hyb', q.clip.hyb)}${cellv(q.pure, q.plo, q.pup, q.sel === 'pure', q.clip.pure)}</tr>`;
    };
    $('suTable').innerHTML = '<tr><th>Veličina</th><th>Analitički model</th><th>Hibridni: analitički + GPR (95 % interval)</th><th>Samo GPR (95 % interval)</th></tr>' + S.OUTS.map(row).join('');
    const w = [];
    SU.clipMsg = '* Vrijednost ili interval odrezani su na fizičkoj granici (σx najviše 1,4·Re, σy najviše 1,1·Re), pa stvarni interval nije poznat.';
    if (clipped) w.push('* Vrijednost ili interval odrezani su na fizičkoj granici (σx najviše 1,4·Re, σy najviše 1,1·Re), pa stvarni interval nije poznat.');
    if (pr.outside.length) w.push('Ulazi izvan raspona simulacija: ' + pr.outside.map(f => S.FEAT_LAB[f].split(',')[0]).join(', ') + '. Hibridni model tada se vraća prema analitičkom, a samo GPR prema prosjeku simulacija; nesigurnost raste.');
    else if (pr.maxRel > 2) w.push('Ova kombinacija ulaza daleko je od simulacija u skupu, pa je interval širi nego inače.');
    const geo = [];
    if (P.B !== 120) geo.push(`B = ${fmt(P.B, 0)} mm`); if (P.L !== 200) geo.push(`L = ${fmt(P.L, 0)} mm`);
    if (P.joint !== 'butt') geo.push('kutni spoj'); if (P.restr !== 'mid') geo.push(P.restr === 'low' ? 'mala ukliještenost' : 'velika ukliještenost'); if (P.proc !== 'MAG') geo.push('postupak ' + P.proc);
    if (geo.length) w.push(`Simulacije su za sučeljeni spoj, MAG, B = 120 mm, L = 200 mm i srednju ukliještenost; upisano je: ${geo.join(', ')}, pa je predviđanje samo orijentacijsko.`);
    $('suWarn').textContent = w.join(' ');
    renderSuCurve();
  }
  function renderSuCurve() {
    const S = window.SUR, o = S.OUTS.find(q => q.id === SU.out), M = SU.M;
    const [T1, T2] = M.S.range.T0;
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const T = T1 - 20 + (T2 - T1 + 40) * i / 40;
      const q = S.predict(W, M, { ...P, T0: T }).out[o.id];
      pts.push({ T, a: q.ana, h: q.val, lo: q.vlo, up: q.vup });
    }
    const all = pts.flatMap(q => [q.a, q.lo, q.up]).filter(Number.isFinite);
    let y0 = Math.min(...all), y1 = Math.max(...all); const pad = (y1 - y0) * 0.1 || 1; y0 -= pad; y1 += pad;
    if (o.id !== 'syMid') y0 = Math.max(0, y0);
    const ob = { W: 760, H: 300, L: 56, R: 16, T: 36, B: 40, x0: pts[0].T, x1: pts[pts.length - 1].T, y0, y1 };
    ob.xt = ticks(ob.x0, ob.x1, 8); ob.yt = ticks(y0, y1, 6); ob.xl = 'temperatura komada T₀, °C'; ob.yl = `${o.lab}, ${o.unit}`;
    const A = axes(ob); let s = A.s;
    const violet = css('--violet'), ink = css('--ink'), muted = css('--muted');
    s += `<rect x="${A.X(T1)}" y="${ob.T}" width="${A.X(T2) - A.X(T1)}" height="${ob.H - ob.T - ob.B}" fill="${muted}" opacity=".08"/>`;
    s += `<text x="${A.X(T1) + 6}" y="${ob.T + 12}" style="fill:${muted}">raspon simulacija</text>`;
    s += `<polygon fill="${violet}" opacity=".18" points="${pts.map(q => A.X(q.T).toFixed(1) + ',' + A.Y(q.up).toFixed(1)).concat(pts.slice().reverse().map(q => A.X(q.T).toFixed(1) + ',' + A.Y(q.lo).toFixed(1))).join(' ')}"/>`;
    s += `<polyline fill="none" stroke="${ink}" stroke-width="2" stroke-dasharray="6 4" points="${pts.map(q => A.X(q.T).toFixed(1) + ',' + A.Y(q.a).toFixed(1)).join(' ')}"/>`;
    s += `<polyline fill="none" stroke="${violet}" stroke-width="2.6" points="${pts.map(q => A.X(q.T).toFixed(1) + ',' + A.Y(q.h).toFixed(1)).join(' ')}"/>`;
    const cur = S.predict(W, M, P).out[o.id];
    if (P.T0 >= ob.x0 && P.T0 <= ob.x1) s += `<circle cx="${A.X(P.T0)}" cy="${A.Y(cur.val)}" r="6" fill="${violet}"/><text x="${A.X(P.T0) + 9}" y="${A.Y(cur.val) - 9}" style="fill:${ink};font-weight:600">trenutni ulazi</text>`;
    const leg = [[`surogatni model (${M.models[o.id].sel === 'hyb' ? 'hibridni' : 'samo GPR'}) i 95 % interval`, violet, ''], ['analitički model', ink, '6 4']];
    let lx = ob.L; leg.forEach(it => { s += `<line x1="${lx}" x2="${lx + 22}" y1="14" y2="14" stroke="${it[1]}" stroke-width="3" ${it[2] ? `stroke-dasharray="${it[2]}"` : ''}/><text x="${lx + 28}" y="18" style="fill:${ink}">${it[0]}</text>`; lx += 50 + it[0].length * 7; });
    $('suCurve').innerHTML = s;
    const a = pts.find(q => q.T >= T1), b = [...pts].reverse().find(q => q.T <= T2);
    $('suCurveOut').innerHTML = `Uz ostale ulaze nepromijenjene, između ${fmt(a.T, 0)} i ${fmt(b.T, 0)} °C veličina „${o.lab.charAt(0).toLowerCase() + o.lab.slice(1)}“ prema surogatnom modelu mijenja se od <b>${suFmt(o, a.h)}</b> do <b>${suFmt(o, b.h)} ${o.unit}</b>, a prema analitičkom od ${suFmt(o, a.a)} do ${suFmt(o, b.a)} ${o.unit}.`;
  }
  function renderSuValidation() {
    if (!SU.M) { $('suCV').innerHTML = ''; $('suCVNote').textContent = SU.err; return; }
    const S = window.SUR, M = SU.M;
    $('suCV').innerHTML = '<tr><th>Veličina</th><th>Broj simulacija</th><th>Analitički</th><th>Samo GPR</th><th>Hibridni</th><th>Odabran</th><th>Pokrivenost</th></tr>' + S.OUTS.map(o => {
      const m = M.models[o.id], best = Math.min(m.mae.ana, m.mae.pure, m.mae.hyb);
      const c = v => `<td class="${v === best ? 'good' : ''}">${suFmt(o, v)}</td>`;
      return `<tr><td>${o.lab}, ${o.unit}</td><td>${m.n}</td>${c(m.mae.ana)}${c(m.mae.pure)}${c(m.mae.hyb)}<td>${m.sel === 'hyb' ? 'hibridni' : 'samo GPR'}</td><td>${fmt(100 * m.cover, 0)} %</td></tr>`;
    }).join('');
    $('suCVNote').textContent = `Srednja apsolutna pogreška na ${M.n} simulacija (za veličinu kojoj neka simulacija nema vrijednost, na manje), svaka predviđena bez nje same ("izostavi jedan"). Pokrivenost je udio simulacija unutar 95 % intervala odabranog modela.`;
    const EX = window.SUROGAT_PODACI.extrap;
    if (EX) {
      const lab = { Q: 'Q ≥ 1,35 kJ/mm', T0: 'T₀ ≥ 100 °C', d: 'd ≥ 16 mm', Re: 'Re ≥ 550 MPa' };
      $('suEx').innerHTML = '<tr><th>Izvan raspona učenja</th>' + S.OUTS.map(o => `<th>${o.lab}, ${o.unit}<br><span class="muted">analit. / GPR / hibrid</span></th>`).join('') + '</tr>' +
        EX.map(e => `<tr><td>${lab[e.f] || e.f} <span class="muted">(${e.nTest} sim.)</span></td>` + S.OUTS.map(o => {
          const r = e.res[o.id], best = Math.min(r.ana, r.pure, r.hyb), c = v => v === best ? `<b>${suFmt(o, v)}</b>` : suFmt(o, v);
          return `<td>${c(r.ana)} / ${c(r.pure)} / ${c(r.hyb)}</td>`;
        }).join('') + '</tr>').join('');
    }
    renderSuParity();
    const r = M.S.range;
    const xr = k => { const v = window.SUROGAT_PODACI.rows.map(q => q.x[k]); return [Math.min(...v), Math.max(...v)]; };
    $('suData').innerHTML = '<tr><th>Ulaz</th><th>Najmanje</th><th>Najviše</th><th>Duljina ℓ (najveći σx, odabrani model)</th></tr>' + S.FEATS.map((f, i) =>
      `<tr><td>${S.FEAT_LAB[f]}</td><td>${fmt(r[f][0], f === 'Q' ? 2 : 0)}</td><td>${fmt(r[f][1], f === 'Q' ? 2 : 0)}</td><td>${M.models.sxMax.ell[i] > 10 ? 'iznad 10 (gotovo bez utjecaja)' : fmt(M.models.sxMax.ell[i], 2)}</td></tr>`).join('') +
      [['I', 'struja I, A (kroz Q)'], ['v', 'brzina v, cm/min (kroz Q)']].map(([k, lab]) => { const [a, b] = xr(k); return `<tr><td>${lab}</td><td>${fmt(a, 0)}</td><td>${fmt(b, 0)}</td><td class="muted">nije zaseban ulaz</td></tr>`; }).join('');
  }
  function renderSuParity() {
    const S = window.SUR, o = S.OUTS.find(q => q.id === SU.out), m = SU.M.models[o.id];
    const all = m.pts.flatMap(q => [q.ccx, q.ana, q.vlo, q.vup]);
    let a = Math.min(...all), b = Math.max(...all); const pad = (b - a) * 0.08 || 1; a -= pad; b += pad;
    const ob = { W: 360, H: 320, L: 52, R: 12, T: 30, B: 40, x0: a, x1: b, y0: a, y1: b, xt: ticks(a, b, 5), yt: ticks(a, b, 5),
      xl: `CalculiX, ${o.unit}`, yl: `predviđeno, ${o.unit}` };
    const A = axes(ob); let s = A.s;
    const violet = css('--violet'), ink = css('--ink');
    s += `<line x1="${A.X(a)}" y1="${A.Y(a)}" x2="${A.X(b)}" y2="${A.Y(b)}" stroke="${css('--bronze')}" stroke-dasharray="5 4"/>`;
    m.pts.forEach(q => { s += `<circle cx="${A.X(q.ccx).toFixed(1)}" cy="${A.Y(q.ana).toFixed(1)}" r="4.5" fill="none" stroke="${ink}" stroke-width="1.5"/>`; });
    m.pts.forEach(q => {
      s += `<line x1="${A.X(q.ccx).toFixed(1)}" x2="${A.X(q.ccx).toFixed(1)}" y1="${A.Y(q.vlo).toFixed(1)}" y2="${A.Y(q.vup).toFixed(1)}" stroke="${violet}" opacity=".5"/>`;
      s += `<circle cx="${A.X(q.ccx).toFixed(1)}" cy="${A.Y(q.val).toFixed(1)}" r="4" fill="${violet}"/>`;
    });
    s += `<circle cx="${ob.L + 8}" cy="14" r="4" fill="${violet}"/><text x="${ob.L + 16}" y="18" style="fill:${ink}">${m.sel === 'hyb' ? 'hibridni' : 'samo GPR'}</text>`;
    s += `<circle cx="${ob.L + 98}" cy="14" r="4.5" fill="none" stroke="${ink}" stroke-width="1.5"/><text x="${ob.L + 106}" y="18" style="fill:${ink}">analitički</text>`;
    $('suParity').innerHTML = s;
  }
  function suOptions() {
    $('suOut').innerHTML = window.SUR ? window.SUR.OUTS.map(o => `<option value="${o.id}" ${o.id === SU.out ? 'selected' : ''}>${o.lab}</option>`).join('') : '';
  }
  $('suOut').addEventListener('change', () => { SU.out = $('suOut').value; if (P && SU.M) { renderSuCurve(); renderSuParity(); } });
  $('suCsv').addEventListener('click', () => {
    const D = window.SUROGAT_PODACI; if (!D) return;
    const cols = ['oznaka', 'I_A', 'U_V', 'v_cm_min', 'Q_kJ_mm', 'T0_C', 'd_mm', 'Re_MPa', 'sigma_x_najvece_MPa', 'b_vlacna_zona_mm', 't85_s', 'sigma_y_sred_MPa'];
    const c = v => typeof v === 'number' ? String(+v.toFixed(4)).replace('.', ',') : v;
    const lines = [cols.join(';'), ...D.rows.map(r => [r.id, r.x.I, r.x.U, r.x.v, r.x.Q, r.x.T0, r.x.d, r.x.Re, r.y.sxMax, r.y.b0, r.y.t85, r.y.syMid].map(c).join(';'))];
    saveFile('surogat-simulacije.csv', new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })).then(r => { $('suMsg').textContent = r === 'saved' ? 'Skup podataka je spremljen.' : ''; });
  });
  $('suRefit').addEventListener('click', () => {
    $('suMsg').textContent = 'Učim hiperparametre…'; $('suRefit').disabled = true;
    setTimeout(() => {
      const t = performance.now();
      SU.M = window.SUR.train(W, suRows(), { sel: window.SUROGAT_PODACI.sel });
      $('suMsg').textContent = `Gotovo za ${fmt((performance.now() - t) / 1000, 1)} s.`; $('suRefit').disabled = false;
      renderSuValidation(); if (P) { renderSurrogate(); renderStress(); }
    }, 30);
  });

  /* ---------------- spremanje datoteka ---------------- */
  // U Claude artefaktu kroz mogućnost "downloads" (preglednik traži potvrdu), drugdje običnim preuzimanjem
  async function saveFile(filename, data, type = 'text/plain;charset=utf-8') {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const dl = (window.claude && typeof window.claude.use === 'function') ? await window.claude.use('downloads').catch(() => null) : null;
    if (dl) {
      try { await dl.save({ filename, data: blob }); return 'saved'; }
      catch (e) { return e && e.code === 'unavailable' ? 'unavailable' : 'declined'; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return 'saved';
  }

  /* ---------------- generator za CalculiX ---------------- */
  function ccxOpts() { const c = numv($('ccxCool').value); return { mesh: $('ccxMesh').value, tCool: Number.isFinite(c) ? Math.max(200, c) : 3000, yProbe: probeY, Weld: W }; }
  function renderCcx() {
    if (!P || !window.CCX) return;
    const i = window.CCX.build(P, { ...ccxOpts(), infoOnly: true }).info;
    $('ccxInfo').innerHTML = `Mreža ${i.nx} × ${i.ny} × ${i.nz} elemenata (${i.elems.toLocaleString('hr-HR')} elemenata, ${i.nodes.toLocaleString('hr-HR')} čvorova), ` +
      `Goldak b = ${fmt(i.g.b, 1)} mm, c = ${fmt(i.g.c, 1)} mm, Q = ${fmt(i.Qtot, 0)} W${KCAL.on ? ' (kalibrirani k)' : ''}; ` +
      `${i.nSteps} mehaničkih koraka (isti broj za svako trajanje hlađenja). Procjena trajanja: oko <b>${i.estMin} min</b>.`;
    const w = [];
    if (P.joint !== 'butt') w.push('Generator izrađuje model sučeljenog spoja; za kutni spoj geometriju treba prilagoditi.');
    const cool = numv($('ccxCool').value);
    if (!Number.isFinite(cool)) w.push('Trajanje hlađenja nije broj, pa se koristi 3000 s.');
    else if (cool < 200) w.push('Trajanje hlađenja manje od 200 s povećano je na 200 s.');
    else if (cool < 1000) w.push(`Uz ${fmt(cool, 0)} s hlađenja ploča još nije na sobnoj temperaturi, pa naprezanja nisu konačna; preporuka je barem 1.000 s.`);
    if (i.estMin > 10) w.push(`Procjena je dulja od 10 minuta. Za prvu provjeru ${$('ccxMesh').value !== 'gruba' ? 'odaberi grubu mrežu ili ' : ''}privremeno smanji duljinu zavara L (npr. na 200 mm) i širinu B (npr. na 120 mm): u sredini dovoljno dugog zavara uzdužna naprezanja gotovo se ne mijenjaju, a račun je nekoliko puta brži.`);
    $('ccxWarn').textContent = w.join(' ');
  }
  const ccxSave = async (which) => {
    if (!P) { $('ccxMsg').textContent = 'Ispravi ulazne podatke prije izrade modela.'; return; }
    $('ccxMsg').textContent = 'Izrađujem datoteku…';
    await new Promise(r => setTimeout(r, 20));
    let name, text;
    if (which === 'py') { name = 'izvuci_rezultate.py'; text = window.CCX.POST; }
    else {
      const b = window.CCX.build(P, ccxOpts());
      name = which === 'th' ? 'toplina.inp' : 'naprezanja.inp';
      text = which === 'th' ? b.toplina : b.naprezanja;
    }
    const r = await saveFile(name, text);
    $('ccxMsg').textContent = r === 'saved' ? `${name} je spremljen (${Math.round(text.length / 1024)} kB). Obje .inp datoteke moraju biti izrađene s istim ulazima.` :
      r === 'unavailable' ? 'Spremanje datoteke ovdje nije dostupno.' : `${name} nije spremljen.`;
  };
  $('ccxTh').addEventListener('click', () => ccxSave('th'));
  $('ccxMe').addEventListener('click', () => ccxSave('me'));
  $('ccxPy').addEventListener('click', () => ccxSave('py'));
  ['ccxMesh', 'ccxCool'].forEach(id => $(id).addEventListener('input', renderCcx));

  /* ---------------- dnevnik zavara ---------------- */
  const LKEY = 'zavarDnevnik.v1';
  let LOG = [];
  function loadLog() { try { LOG = JSON.parse(localStorage.getItem(LKEY) || '[]'); if (!Array.isArray(LOG)) LOG = []; } catch (e) { LOG = []; } }
  function saveLog() { try { localStorage.setItem(LKEY, JSON.stringify(LOG)); } catch (e) { msg('Spremanje u preglednik nije uspjelo; izvezi CSV da ne izgubiš podatke.'); } }
  const msg = t => { $('lgMsg').textContent = t; };

  // U Claude artefaktu dnevnik je zajednički (baza artefakta), drugdje ostaje u pregledniku.
  const STORE = { shared: false, db: null, readOnly: false };
  const COL = 'dnevnik';
  const plain = r => JSON.parse(JSON.stringify(r));
  function dbFail(e) {
    const c = e && e.code;
    if (c === 'invalid_argument') { STORE.readOnly = true; applyReadOnly(); msg('Nemaš dopuštenje za upis u zajednički dnevnik; možeš ga pregledavati i izvesti u CSV.'); }
    else if (c === 'quota_exceeded') msg('Zajednički dnevnik je pun. Izvezi CSV i obriši stare zapise.');
    else if (c === 'resource_exhausted') msg('Previše spremanja odjednom. Pričekaj trenutak i pokušaj ponovno.');
    else msg('Spremanje u zajednički dnevnik nije uspjelo. Pokušaj ponovno.');
    return false;
  }
  async function logAdd(entries) {
    if (!STORE.shared) { LOG.push(...entries); saveLog(); renderLog(); return true; }
    if (STORE.readOnly) { msg('Zajednički dnevnik možeš samo pregledavati.'); return false; }
    try { for (const r of entries) await STORE.db.collection(COL).doc(r.id).set(plain(r)); return true; }
    catch (e) { return dbFail(e); }
  }
  async function logPatch(r, mj) {
    if (!STORE.shared) { Object.assign(r.mj, mj); saveLog(); return true; }
    if (STORE.readOnly) return false;
    try { await STORE.db.collection(COL).doc(r.id).update({ mj: plain(mj) }); return true; }
    catch (e) { return dbFail(e); }
  }
  async function logDelete(ids) {
    if (!STORE.shared) { LOG = LOG.filter(x => !ids.includes(x.id)); saveLog(); renderLog(); return true; }
    if (STORE.readOnly) return false;
    try { for (const id of ids) await STORE.db.collection(COL).doc(id).delete(); return true; }
    catch (e) { return dbFail(e); }
  }
  function applyReadOnly() {
    ['lgSave', 'lgDemo', 'lgClear'].forEach(id => { $(id).disabled = STORE.readOnly; });
    $('lgImport').disabled = STORE.readOnly;
    $('lgMigrateRow').hidden = true;
    renderLog();
  }
  let logRenderPending = false;
  function scheduleLogRender() {                        // ne prekidaj unos u tablici
    if ($('lgTable').contains(document.activeElement)) { logRenderPending = true; return; }
    renderLog();
  }
  $('lgTable').addEventListener('focusout', () => setTimeout(() => {
    if (logRenderPending && !$('lgTable').contains(document.activeElement)) { logRenderPending = false; renderLog(); }
  }, 0));

  async function initSharedLog() {
    if (!window.claude || typeof window.claude.use !== 'function') return;
    const db = await window.claude.use('db').catch(() => null);
    if (!db) return;
    Object.assign(STORE, { shared: true, db });
    const user = await window.claude.use('user').catch(() => null);
    const can = user && typeof user.can === 'function' ? await user.can('data.write').catch(() => null) : null;
    STORE.readOnly = can === false;
    const local = LOG.slice();
    LOG = [];
    $('lgStore').textContent = 'Dnevnik je zajednički: zapise vide i dopunjuju svi kojima je ova stranica podijeljena. Može se izvesti u CSV za daljnju obradu.';
    msg(STORE.readOnly ? 'Zajednički dnevnik možeš pregledavati, ali ne i mijenjati.' : '');
    applyReadOnly();
    db.collection(COL).orderBy('ts').onSnapshot(snap => {
      LOG = snap.docs.map(d => plain(d.data()));
      scheduleLogRender();
      if (ML.use) render();
    }, e => { msg(e && e.code === 'revoked' ? 'Pristup zajedničkom dnevniku više nije dostupan.' : 'Veza sa zajedničkim dnevnikom je prekinuta. Osvježi stranicu.'); });
    if (local.length && !STORE.readOnly) {
      $('lgMigrateRow').hidden = false;
      $('lgMigrate').textContent = `Prenesi ${local.length} ${plural(local.length, 'lokalni zapis', 'lokalna zapisa', 'lokalnih zapisa')} u zajednički dnevnik`;
      $('lgMigrate').onclick = async () => {
        $('lgMigrate').disabled = true;
        if (await logAdd(local)) { try { localStorage.removeItem(LKEY); } catch (e) { /* nije važno */ } $('lgMigrateRow').hidden = true; msg(`Preneseno ${local.length} ${plural(local.length, 'zapis', 'zapisa', 'zapisa')}.`); }
        $('lgMigrate').disabled = false;
      };
    }
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function entryFrom(p, extra = {}) {
    const e = W.evaluate(p);
    return {
      id: uid(), ts: new Date().toISOString(), oznaka: '', zavarivac: '', napomena: '', demo: false,
      in: { mat: p.mat, Re: p.Re, d: p.d, B: p.B, L: p.L, talina: CERT ? CERT.heat || '' : '', CEVcert: CERT && Number.isFinite(CERT.cev) ? CERT.cev : '', joint: p.joint, restr: p.restr, proc: p.proc, HD: p.HD, I: p.I, U: p.U, v: p.v,
        TpWPS: p.TpWPS, T0: p.T0, Ta: p.Ta, RH: p.RH, tmin: p.tmin, tmax: p.tmax, Tmax: p.Tmax, ...p.comp },
      pred: { Q: e.Q, t85: e.t85, HV: e.HV, t85model: e.t85model, HVmodel: e.HVmodel, k: e.k, TpCET: e.TpCET, risk: e.risk, rs: e.rs },
      mj: { t85: '', HV: '', def: '', sig: '', greske: '' }, ...extra
    };
  }

  const MJ = [['t85', 't8/5 izmj., s'], ['HV', 'HV izmj.'], ['def', 'kutna def., °'], ['sig', 'σ izmj., MPa']];
  const GRESKE = ['', 'nema', 'pukotine', 'poroznost', 'nepotpuno protaljivanje', 'ostalo'];

  function renderLog() {
    if (!LOG.length) {
      $('lgTable').innerHTML = '<p class="empty">Dnevnik je prazan. Upiši oznaku uzorka i spremi trenutni zavar.</p>';
    } else {
      const rows = LOG.map(r => `<tr data-id="${r.id}" class="${r.demo ? 'demo-row' : ''}">
        <td class="num">${new Date(r.ts).toLocaleDateString('hr-HR')}</td>
        <td>${esc(r.oznaka) || '–'}</td><td>${esc(r.zavarivac) || '–'}</td><td>${esc(r.in.mat)}</td>
        <td class="num">${fmt(numv(r.in.T0), 0)}</td><td class="num">${fmt(numv(r.pred.Q), 2)}</td>
        <td class="num">${fmt(numv(r.pred.t85), 1)}</td><td class="num">${fmt(numv(r.pred.HV), 0)}</td><td class="num">${fmt(numv(r.pred.risk), 0)}</td>
        ${MJ.map(([k, lab]) => `<td><input type="text" inputmode="decimal" data-k="${k}" value="${r.mj[k] === '' || r.mj[k] == null ? '' : String(r.mj[k]).replace('.', ',')}" aria-label="${esc(lab)}"></td>`).join('')}
        <td><select data-k="greske" aria-label="Greške">${GRESKE.map(g => `<option ${g === r.mj.greske ? 'selected' : ''} value="${g}">${g || '–'}</option>`).join('')}</select></td>
        <td class="num"><button type="button" class="ghost" data-act="load">Učitaj</button> <button type="button" class="ghost" data-act="del" aria-label="Obriši zapis">Obriši</button></td>
        </tr>`).join('');
      $('lgTable').innerHTML = `<table class="t"><thead><tr><th>Datum</th><th>Oznaka</th><th>Zavarivač</th><th>Materijal</th><th>T₀, °C</th><th>Q</th><th>t8/5 pred.</th><th>HV pred.</th><th>Rizik</th>${MJ.map(m => `<th>${m[1]}</th>`).join('')}<th>Greške</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    renderML();
    renderScatter('scHV', 'HV', 'HV');
    renderScatter('scT', 't85', 's');
  }

  $('lgTable').addEventListener('change', ev => {
    const tr = ev.target.closest('tr'); if (!tr) return;
    const r = LOG.find(x => x.id === tr.dataset.id); if (!r) return;
    const k = ev.target.dataset.k;
    let val = k === 'greske' ? ev.target.value : (ev.target.value.trim() === '' ? '' : numv(ev.target.value));
    if (k !== 'greske' && val !== '') {
      // kutna deformacija i naprezanje smiju biti negativni, t8/5 i tvrdoća ne
      if (!Number.isFinite(val) || ((k === 't85' || k === 'HV') && val <= 0)) {
        ev.target.classList.add('bad'); msg(`"${ev.target.value}" nije ispravna vrijednost za ${ev.target.getAttribute('aria-label')}; upiši pozitivan broj (decimalni zarez ili točka).`);
        return;
      }
    }
    ev.target.classList.remove('bad');
    logPatch(r, { ...r.mj, [k]: val }).then(ok => { if (ok && !STORE.shared) { renderML(); renderScatter('scHV', 'HV', 'HV'); renderScatter('scT', 't85', 's'); if (ML.use) render(); } });
  });
  $('lgTable').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    const tr = b.closest('tr'); const r = LOG.find(x => x.id === tr.dataset.id); if (!r) return;
    if (b.dataset.act === 'del') { logDelete([r.id]).then(ok => { if (ok) msg('Zapis je obrisan.'); }); }
    if (b.dataset.act === 'load') {
      loadEntry(r);
      msg(LOADMISS.length ? `Zapis ${r.oznaka || ''} nema: ${LOADMISS.join(', ')}. Ta polja zadržala su prethodne vrijednosti, pa ih provjeri.` : `Ulazi zapisa ${r.oznaka || ''} učitani su u obrazac.`);
      if (P) renderStKey();
      go('ulazi');
    }
  });

  function loadEntry(r) {
    const i = r.in;
    const lab = { Re: 'Re', d: 'debljina', B: 'širina B', L: 'duljina L', I: 'struja', U: 'napon', v: 'brzina', TpWPS: 'propisano predgrijavanje', T0: 'temperatura komada', Ta: 'okolna temperatura', RH: 'vlažnost' };
    const missing = Object.keys(lab).filter(k => i[k] === undefined || i[k] === null || i[k] === '');
    const miss2 = CHEM.filter(k => i[k] === undefined || i[k] === null || i[k] === '');
    LOADMISS = missing.map(k => lab[k]).concat(miss2.length ? ['sastav (' + miss2.join(', ') + ')'] : []);
    if (W.MAT[i.mat]) $('mat').value = i.mat;
    const set = (id, v) => { if (v !== undefined && v !== null && v !== '') $(id).value = v; };
    ['Re', 'd', 'B', 'L', 'joint', 'restr', 'proc', 'I', 'U', 'v', 'TpWPS', 'T0', 'Ta', 'RH', 'tmin', 'tmax', 'Tmax'].forEach(k => set(k, i[k]));
    set('HD', String(i.HD));
    CHEM.forEach(k => set('c' + k, i[k]));
    probeAuto = true; render();
  }

  /* ---------------- učenje iz dnevnika ---------------- */
  // Ulazi zapisa kao parametri za physics.js (za ponovni izračun ocjena uzroka)
  function pFromEntry(r) {
    const i = r.in || {}, comp = {};
    CHEM.forEach(k => { comp[k] = +i[k] || 0; });
    const m = W.MAT[i.mat] || W.MAT.S355J2;
    return { ...i, comp, group: m.group, Re: +i.Re || m.Re, HD: +i.HD || 5, B: +i.B || 300, L: +i.L || 500,
      tmin: +i.tmin || m.tmin, tmax: +i.tmax || m.tmax, Tmax: +i.Tmax || m.Tmax,
      kEff: Number.isFinite(+r.pred?.k) && +r.pred.k > 0 ? +r.pred.k : undefined };
  }
  const DEFECT = g => g === 'nema' ? 0 : (g && g !== '' ? 1 : null);
  // Zapisi s nalazom ispitivanja (ima ili nema greške) i ocjenama uzroka za učenje težina
  function weightRows() {
    return LOG.filter(r => (ML.demo || !r.demo) && DEFECT(r.mj.greske) !== null).map(r => {
      try { const p = pFromEntry(r); if (!Number.isFinite(p.T0) || !Number.isFinite(p.I)) return null; return { r: W.evaluate(p).rs, y: DEFECT(r.mj.greske) }; }
      catch (e) { return null; }
    }).filter(Boolean);
  }
  function mlRows() {
    const num = v => (v === '' || v == null || !Number.isFinite(+v)) ? NaN : +v;
    return LOG.filter(r => ML.demo || !r.demo).map(r => ({ pt: num(r.pred.t85model ?? r.pred.t85), mt: num(r.mj.t85), ph: num(r.pred.HVmodel ?? r.pred.HV), mh: num(r.mj.HV) }));
  }
  function mlCorr() {
    const f = ML.fit; if (!f) return undefined;
    const c = {};
    if (f.t85 && f.t85.useful) c.t85 = f.t85.c;
    if (f.hv && f.hv.useful) c.hv = { a: f.hv.a, b: f.hv.b };
    return (c.t85 || c.hv) ? c : undefined;
  }
  function mlWeights() { const w = ML.fitW; return w && w.useful ? w.w : undefined; }
  function renderML() {
    ML.fit = W.fitCorrections(mlRows());
    const wr = weightRows();
    ML.fitW = wr.length ? W.fitWeights(wr) : null;
    const f = ML.fit, rows = [], fw = ML.fitW;
    const cellErr = (base, loo) => Number.isFinite(loo) ? `<td class="${loo < base ? 'good' : 'bad'}">${fmt(loo, 1)}</td>` : '<td>–</td>';
    if (f.t85) rows.push(`<tr><td>t8/5</td><td>${f.t85.n}</td><td>izmjereno = ${fmt(f.t85.c, 3)} · predviđeno</td><td>${fmt(f.t85.maeBase, 1)} s</td>${cellErr(f.t85.maeBase, f.t85.maeLoo)}<td>${f.t85.useful ? 'da' : 'ne'}</td></tr>`);
    if (f.hv) rows.push(`<tr><td>Tvrdoća ZUT-a</td><td>${f.hv.n}</td><td>${f.hv.model === 'pravac' ? `HV = ${fmt(f.hv.a, 1)} + ${fmt(f.hv.b, 3)} · HVpred` : `HV = HVpred ${f.hv.a >= 0 ? '+' : '−'} ${fmt(Math.abs(f.hv.a), 1)}`}</td><td>${fmt(f.hv.maeBase, 1)} HV</td>${cellErr(f.hv.maeBase, f.hv.maeLoo)}<td>${f.hv.useful ? 'da' : 'ne'}</td></tr>`);
    if (fw) rows.push(`<tr><td>Indeks rizika (težine uzroka)</td><td>${fw.n} (${fw.n1} s greškom)</td><td>težine u tablici ispod ove</td><td>${fmt(fw.brierBase, 3)}</td><td class="${fw.brierLoo < fw.brierBase ? 'good' : 'bad'}">${Number.isFinite(fw.brierLoo) ? fmt(fw.brierLoo, 3) : '–'}</td><td>${fw.useful ? 'da' : 'ne'}</td></tr>`);
    $('mlTable').innerHTML = rows.length ? `<tr><th>Veličina</th><th>Zapisa</th><th>Naučeni model</th><th>Pogreška bez korekcije</th><th>Pogreška s korekcijom (LOO)</th><th>Korisna</th></tr>${rows.join('')}` : '';
    renderWeights();
    const corr = mlCorr() || mlWeights();
    $('mlUse').disabled = !corr;
    if (!corr && ML.use) { ML.use = false; $('mlUse').checked = false; }
    $('mlOut').innerHTML = !rows.length
      ? (LOG.some(r => r.demo) && !ML.demo ? 'Nema zapisa s izmjerenim vrijednostima. Upiši izmjereni t8/5 ili tvrdoću u dnevnik ili uključi primjere.' : 'Nema zapisa s izmjerenim vrijednostima. Upiši izmjereni t8/5 ili tvrdoću u tablicu iznad.')
      : (corr ? `Korekcija smanjuje pogrešku na zapisima koji nisu korišteni za učenje.${ML.use ? ' Uključena je u procjenu na vrhu stranice.' : ''}` : 'Za korisnu korekciju t8/5 i tvrdoće treba barem 3 zapisa, a za težine indeksa rizika barem 6 zapisa s nalazom (od toga barem 2 s greškom i 2 bez nje). Korekcija mora smanjiti pogrešku na izostavljenim zapisima.') +
        (fw ? ' Za indeks rizika pogreška je Brierova ocjena: srednji kvadrat razlike predviđene vjerojatnosti greške i nalaza (0 ili 1); manja je bolja.' : '');
  }
  function renderWeights() {
    const fw = ML.fitW, on = ML.use && !!mlWeights();
    const lab = { hv: 'Tvrdoća ZUT-a', slow: 'Presporo hlađenje', pre: 'Hladniji od predgrijavanja', cond: 'Kondenzacija vlage', hot: 'Topliji od dopuštenog', restr: 'Ukliještenost' };
    $('wTable').innerHTML = $('wTable2').innerHTML = '<tr><th>Uzrok</th><th>Stručna procjena</th><th>Naučeno iz dnevnika</th></tr>' + W.CAUSE_IDS.map(id =>
      `<tr><td>${lab[id]}</td><td>${fmt(W.W0[id], 2)}</td><td>${fw ? (fw.used[id] ? `<b>${fmt(fw.w[id], 2)}</b>` : '<span class="muted">nema podataka</span>') : '–'}</td></tr>`).join('');
    $('wNote').textContent = !fw ? 'Kad u dnevnik upišeš nalaze ispitivanja (stupac "Greške"), ovdje se prikazuju težine naučene iz njih.'
      : on ? `U procjeni se koriste težine naučene iz ${fw.n} zapisa.`
      : fw.useful ? 'Naučene težine bolje predviđaju nalaze od stručne procjene; uključi ih kvačicom "Koristi naučenu korekciju u procjeni" u dijelu Dnevnik zavara.'
      : `Iz ${fw.n} zapisa još se ne može pouzdano učiti; koriste se težine iz stručne procjene.`;
  }
  $('mlDemo').addEventListener('change', () => { ML.demo = $('mlDemo').checked; renderLog(); if (ML.use) render(); });
  $('mlUse').addEventListener('change', () => { ML.use = $('mlUse').checked; render(); renderWeights(); });

  function renderScatter(id, key, unit) {
    // os x: predviđanje modela bez naučene korekcije (na tome se korekcija i uči)
    const pk = key === 'HV' ? 'HVmodel' : 't85model';
    const pts = LOG.filter(r => (ML.demo || !r.demo || !LOG.some(x => !x.demo)) && r.mj[key] !== '' && r.mj[key] != null && Number.isFinite(+r.mj[key]))
      .map(r => ({ p: Number.isFinite(r.pred[pk]) ? r.pred[pk] : r.pred[key], m: +r.mj[key], lab: r.oznaka, demo: r.demo }));
    const svg = $(id);
    if (!pts.length) { svg.innerHTML = `<text x="180" y="150" text-anchor="middle">Nema izmjerenih vrijednosti. Upiši ih u tablicu iznad.</text>`; return; }
    const all = pts.flatMap(q => [q.p, q.m]);
    let a = Math.min(...all), b = Math.max(...all); const pad = (b - a) * 0.12 || Math.abs(a) * 0.1 || 1; a -= pad; b += pad;
    const o = { W: 360, H: 300, L: 50, R: 14, T: 14, B: 40, x0: a, x1: b, y0: a, y1: b, xt: ticks(a, b, 5), yt: ticks(a, b, 5),
      xl: `predviđeno, ${unit}`, yl: `izmjereno, ${unit}`, xf: t => fmt(t, key === 'HV' ? 0 : 0), yf: t => fmt(t, 0) };
    const A = axes(o); let s = A.s;
    const ink = css('--ink'), bronze = css('--bronze'), straw = css('--straw');
    s += `<line x1="${A.X(a)}" y1="${A.Y(a)}" x2="${A.X(b)}" y2="${A.Y(b)}" stroke="${bronze}" stroke-dasharray="5 4"/>`;
    const ff = ML.fit && (key === 'HV' ? ML.fit.hv : ML.fit.t85);
    if (ff && ff.n >= 3) {                                   // naučena korekcija
      const g = x => key === 'HV' ? ff.a + ff.b * x : ff.c * x;
      s += `<line x1="${A.X(a)}" y1="${A.Y(clamp(g(a), a, b))}" x2="${A.X(b)}" y2="${A.Y(clamp(g(b), a, b))}" stroke="${css('--blue')}" stroke-width="2"/>`;
      s += `<text x="${o.W - o.R - 4}" y="${o.H - o.B - 8}" text-anchor="end" style="fill:${css('--blue')}">naučena korekcija</text>`;
    }
    pts.forEach(q => {
      s += q.demo ? `<circle cx="${A.X(q.p)}" cy="${A.Y(q.m)}" r="5.5" fill="none" stroke="${straw}" stroke-width="2.5"/>`
                  : `<circle cx="${A.X(q.p)}" cy="${A.Y(q.m)}" r="5.5" fill="${ink}"/>`;
      if (q.lab) s += `<text x="${A.X(q.p) + 8}" y="${A.Y(q.m) - 6}">${esc(q.lab)}</text>`;
    });
    const mae = pts.reduce((acc, q) => acc + Math.abs(q.m - q.p), 0) / pts.length;
    s += `<text x="${o.L + 6}" y="${o.T + 12}" style="fill:${ink}">n = ${pts.length}, srednje odstupanje ${fmt(mae, 1)} ${unit}</text>`;
    svg.innerHTML = s;
  }

  $('lgSave').addEventListener('click', () => {
    if (!P) { msg('Ispravi ulazne podatke prije spremanja.'); return; }
    const r = entryFrom(P, { oznaka: $('lgId').value.trim(), zavarivac: $('lgWelder').value.trim(), napomena: $('lgNote').value.trim() });
    logAdd([r]).then(ok => { if (ok) { msg(`Zavar ${r.oznaka || 'bez oznake'} je spremljen. Izmjerene rezultate upiši u tablicu.`); $('lgId').value = ''; } });
  });
  let clearArmed = 0;
  $('lgClear').addEventListener('click', () => {
    if (!LOG.length) { msg('Dnevnik je već prazan.'); return; }
    if (Date.now() - clearArmed > 5000) {           // potvrda drugim klikom (dijalozi su u artefaktu blokirani)
      clearArmed = Date.now(); $('lgClear').textContent = 'Klikni ponovno za brisanje';
      msg('Brisanje briše sve zapise. Prije toga možeš izvesti CSV.');
      setTimeout(() => { if (Date.now() - clearArmed >= 5000) $('lgClear').textContent = 'Obriši sve'; }, 5100);
      return;
    }
    clearArmed = 0; $('lgClear').textContent = 'Obriši sve';
    logDelete(LOG.map(x => x.id)).then(ok => { if (ok) msg('Dnevnik je obrisan.'); });
  });
  function demoEntries() {
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const add = [];
    [0, 8, 18, 30, 45, 70].forEach((T, i) => {
      const r = entryFrom({ ...P, T0: T }, { oznaka: 'PR-' + (i + 1), zavarivac: i % 2 ? 'Z2' : 'Z1', napomena: 'PRIMJER, izmišljeni podaci', demo: true });
      r.mj.t85 = +(r.pred.t85 * (1.08 + 0.2 * rnd())).toFixed(1);
      r.mj.HV = Math.round(r.pred.HV + 12 + 30 * rnd());
      r.mj.def = +(1.2 + 0.02 * r.pred.Q * 10 + 0.4 * rnd()).toFixed(2);
      r.mj.greske = T < 10 ? 'pukotine' : 'nema';
      add.push(r);
    });
    return add;
  }
  $('lgDemo').addEventListener('click', () => {
    if (!P) { msg('Ispravi ulazne podatke prije dodavanja primjera.'); return; }
    logAdd(demoEntries()).then(ok => { if (ok) msg('Dodano je 6 primjera s izmišljenim izmjerenim vrijednostima (označeni žutom crtom).'); });
  });

  // CSV: razdjelnik ';', decimalni zarez, UTF-8 s BOM-om (otvara se izravno u hrvatskom Excelu)
  const CSVCOLS = [
    ['datum', r => r.ts], ['oznaka', r => r.oznaka], ['zavarivac', r => r.zavarivac], ['napomena', r => r.napomena], ['primjer', r => r.demo ? 'da' : 'ne'],
    ['materijal', r => r.in.mat], ['talina', r => r.in.talina], ['CEV_certifikat', r => r.in.CEVcert], ...CHEM.map(k => [k, r => r.in[k]]), ['Re_MPa', r => r.in.Re], ['debljina_mm', r => r.in.d], ['sirina_B_mm', r => r.in.B], ['duljina_L_mm', r => r.in.L],
    ['spoj', r => r.in.joint], ['uklijestenost', r => r.in.restr], ['postupak', r => r.in.proc], ['HD', r => r.in.HD],
    ['I_A', r => r.in.I], ['U_V', r => r.in.U], ['v_cm_min', r => r.in.v], ['Tp_WPS_C', r => r.in.TpWPS],
    ['T0_C', r => r.in.T0], ['Ta_C', r => r.in.Ta], ['RH_pct', r => r.in.RH], ['t85_min_s', r => r.in.tmin], ['t85_max_s', r => r.in.tmax], ['Tmax_C', r => r.in.Tmax],
    ['Q_kJ_mm', r => r.pred.Q], ['t85_pred_s', r => r.pred.t85], ['HV_pred', r => r.pred.HV], ['Tp_CET_C', r => r.pred.TpCET], ['rizik_pred', r => r.pred.risk], ...W.CAUSE_IDS.map(id => ['r_' + id, r => { try { return W.evaluate(pFromEntry(r)).rs[id]; } catch (e) { return ''; } }]),
    ['t85_mj_s', r => r.mj.t85], ['HV_mj', r => r.mj.HV], ['kutna_def_mj_deg', r => r.mj.def], ['sigma_mj_MPa', r => r.mj.sig], ['greske', r => r.mj.greske]
  ];
  const cell = v => {
    if (v === '' || v == null) return '';
    if (typeof v === 'number') return String(+v.toFixed(4)).replace('.', ',');
    const s = String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  $('lgExport').addEventListener('click', () => {
    if (!LOG.length) { msg('Dnevnik je prazan, nema se što izvesti.'); return; }
    const lines = [CSVCOLS.map(c => c[0]).join(';'), ...LOG.map(r => CSVCOLS.map(c => cell(c[1](r))).join(';'))];
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const filename = 'dnevnik-zavara-' + new Date().toISOString().slice(0, 10) + '.csv';
    saveFile(filename, blob).then(r => msg(r === 'saved' ? `Izvezeno ${LOG.length} zapisa.` : r === 'unavailable' ? 'Spremanje datoteke ovdje nije dostupno.' : 'Izvoz nije spremljen.'));
  });

  function parseCSV(text) {
    text = text.replace(/^\ufeff/, '');
    const sep = (text.split('\n')[0].match(/;/g) || []).length >= (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === sep) { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f.replace(/\r$/, '')); rows.push(row); }
    return rows.filter(r => r.some(x => x !== ''));
  }
  $('lgImport').addEventListener('change', async ev => {
    const file = ev.target.files[0]; if (!file) return;
    try {
      const rows = parseCSV(await file.text());
      const head = rows.shift(); const ix = n => head.indexOf(n);
      if (ix('T0_C') < 0 || ix('I_A') < 0) { msg('Datoteka nema očekivane stupce. Uvezi CSV izvezen iz ovog dnevnika.'); return; }
      const num = s => { if (s === '' || s == null) return ''; const v = parseFloat(String(s).replace(',', '.')); return Number.isFinite(v) ? v : ''; };
      const get = (r, n) => ix(n) >= 0 ? r[ix(n)] : '';
      const add = [];
      rows.forEach(r => {
        const inp = { mat: get(r, 'materijal'), talina: get(r, 'talina'), CEVcert: num(get(r, 'CEV_certifikat')), Re: num(get(r, 'Re_MPa')), d: num(get(r, 'debljina_mm')), B: num(get(r, 'sirina_B_mm')), L: num(get(r, 'duljina_L_mm')), joint: get(r, 'spoj') || 'butt',
          restr: get(r, 'uklijestenost') || 'mid', proc: get(r, 'postupak') || 'MAG', HD: num(get(r, 'HD')), I: num(get(r, 'I_A')), U: num(get(r, 'U_V')),
          v: num(get(r, 'v_cm_min')), TpWPS: num(get(r, 'Tp_WPS_C')), T0: num(get(r, 'T0_C')), Ta: num(get(r, 'Ta_C')), RH: num(get(r, 'RH_pct')),
          tmin: num(get(r, 't85_min_s')), tmax: num(get(r, 't85_max_s')), Tmax: num(get(r, 'Tmax_C')) };
        CHEM.forEach(k => { inp[k] = num(get(r, k)); });
        add.push({ id: uid(), ts: get(r, 'datum') || new Date().toISOString(), oznaka: get(r, 'oznaka'), zavarivac: get(r, 'zavarivac'),
          napomena: get(r, 'napomena'), demo: get(r, 'primjer') === 'da', in: inp,
          pred: { Q: num(get(r, 'Q_kJ_mm')), t85: num(get(r, 't85_pred_s')), HV: num(get(r, 'HV_pred')), TpCET: num(get(r, 'Tp_CET_C')), risk: num(get(r, 'rizik_pred')) },
          mj: { t85: num(get(r, 't85_mj_s')), HV: num(get(r, 'HV_mj')), def: num(get(r, 'kutna_def_mj_deg')), sig: num(get(r, 'sigma_mj_MPa')), greske: get(r, 'greske') } });
      });
      if (await logAdd(add)) msg(`Uvezeno ${add.length} ${plural(add.length, 'zapis', 'zapisa', 'zapisa')}.`);
    } catch (e) { msg('Datoteku nije moguće pročitati kao CSV.'); }
    ev.target.value = '';
  });

  /* ---------------- certifikat materijala ---------------- */
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) loaded[src] = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.onload = res;
      s.onerror = () => rej(new Error('Biblioteku nije moguće učitati (' + src.split('/')[2] + '). Provjeri internetsku vezu.'));
      document.head.appendChild(s);
    });
    return loaded[src];
  }
  const cstat = t => { $('certStatus').textContent = t; };
  let CERTP = null;   // rezultat čitanja prije potvrde

  // Procjena nagiba fotografije (metoda projekcijskog profila): kut pri kojem su retci teksta najoštriji
  function estimateSkew(src) {
    const sw = Math.min(900, src.width), k = sw / src.width, sh = Math.round(src.height * k);
    const cv = document.createElement('canvas'); cv.width = sw; cv.height = sh;
    const c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(src, 0, 0, sw, sh);
    const d = c.getImageData(0, 0, sw, sh).data;
    let mean = 0; for (let i = 0; i < sw * sh; i++) mean += d[4 * i + 1]; mean /= sw * sh;
    const xs = [], ys = [];
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (d[4 * (y * sw + x) + 1] < mean * 0.6) { xs.push(x); ys.push(y); }
    if (xs.length < 200) return 0;
    const score = deg => {
      const t = Math.tan(deg * Math.PI / 180), bins = new Float64Array(sh * 2 + 10), off = sh;
      for (let i = 0; i < xs.length; i++) { const b = Math.round(ys[i] - xs[i] * t) + off; if (b >= 0 && b < bins.length) bins[b]++; }
      let s = 0; for (const v of bins) s += v * v; return s;
    };
    let best = 0, bs = -1;
    for (let a = -5; a <= 5.001; a += 0.25) { const s = score(a); if (s > bs) { bs = s; best = a; } }
    const c0 = best; for (let a = c0 - 0.25; a <= c0 + 0.25; a += 0.05) { const s = score(a); if (s > bs) { bs = s; best = a; } }
    return Math.abs(best) < 0.1 ? 0 : best;
  }
  function rotateCanvas(src, deg) {
    if (!deg) return src;
    const r = deg * Math.PI / 180, cs = Math.abs(Math.cos(r)), sn = Math.abs(Math.sin(r));
    const w = Math.ceil(src.width * cs + src.height * sn), h = Math.ceil(src.width * sn + src.height * cs);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
    c.translate(w / 2, h / 2); c.rotate(-r); c.imageSmoothingQuality = 'high'; c.drawImage(src, -src.width / 2, -src.height / 2);
    return cv;
  }

  // Priprema slike za OCR: povećanje, sivi tonovi, prag (Otsu), uklanjanje dugih crta tablice, bijeli rub
  function prepForOcr(src0, opts = {}) {
    const skew = opts.deskew === false ? 0 : estimateSkew(src0);
    const src = rotateCanvas(src0, skew);
    const target = opts.targetW || 3000;
    const scale = Math.max(0.5, Math.min(opts.maxScale || 6, target / src.width));
    const w = Math.round(src.width * scale), h = Math.round(src.height * scale), pad = 24;
    const cv = document.createElement('canvas'); cv.width = w + 2 * pad; cv.height = h + 2 * pad;
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(src, pad, pad, w, h);
    const im = c.getImageData(0, 0, cv.width, cv.height), d = im.data, W2 = cv.width, H2 = cv.height, n = W2 * H2;
    const g = new Uint8Array(n), hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) { const v = (0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]) | 0; g[i] = v; hist[v]++; }
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let wB = 0, sB = 0, best = -1, th = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break;
      sB += t * hist[t]; const m = sB / wB - (sum - sB) / wF, v = wB * wF * m * m;
      if (v > best) { best = v; th = t; }
    }
    const dark = new Uint8Array(n); for (let i = 0; i < n; i++) dark[i] = g[i] <= th ? 1 : 0;
    const out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = dark[i];
    const hMin = Math.round(W2 * (opts.hLine || 0.12)), vMin = Math.round(H2 * (opts.vLine || 0.03));
    for (let y = 0; y < H2; y++) {                       // vodoravne crte
      let run = 0;
      for (let x = 0; x <= W2; x++) {
        if (x < W2 && dark[y * W2 + x]) run++;
        else { if (run >= hMin) for (let k = x - run; k < x; k++) out[y * W2 + k] = 0; run = 0; }
      }
    }
    for (let x = 0; x < W2; x++) {                       // okomite crte
      let run = 0;
      for (let y = 0; y <= H2; y++) {
        if (y < H2 && dark[y * W2 + x]) run++;
        else { if (run >= vMin) for (let k = y - run; k < y; k++) out[k * W2 + x] = 0; run = 0; }
      }
    }
    for (let i = 0; i < n; i++) { const v = out[i] ? 0 : 255; d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = v; d[4 * i + 3] = 255; }
    c.putImageData(im, 0, 0);
    return cv;
  }

  async function ocrCanvas(canvas, page, label, opts = {}) {
    await loadScript(TESS);
    cstat(`${label}: priprema slike…`);
    const prepped = prepForOcr(canvas, opts);
    const worker = await window.Tesseract.createWorker('eng', 1, {
      logger: m => { if (m.status === 'recognizing text') cstat(`${label}: prepoznavanje teksta ${Math.round(m.progress * 100)} %`); }
    });
    try {
      await worker.setParameters({ tessedit_pageseg_mode: String(opts.psm || 3), preserve_interword_spaces: '1' });
      const { data } = await worker.recognize(prepped);
      const toks = (data.words || []).map(w => ({ t: w.text, x: w.bbox.x0, y: (w.bbox.y0 + w.bbox.y1) / 2, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0, page }));
      toks.prepped = prepped;            // pripremljena slika, u čijim su koordinatama riječi
      return toks;
    } finally { await worker.terminate(); }
  }

  /* ---- čitanje tablice po ćelijama ----
   * 1) na binarnoj slici traže se crte tablice i iz njih ćelije,
   * 2) zaglavlje se čita s dopuštenim slovima simbola, vrijednosti samo sa znamenkama,
   * 3) svaka ćelija čita se u nekoliko varijanti (povećanje, sivo ili crno-bijelo), a rezultat se bira glasanjem. */
  const WL_NUM = '0123456789.,<-', WL_SYM = 'ABCEFIMNOPSTVWZabeilnoqrstuv%()';

  function grayOf(canvas) {
    const c = canvas.getContext('2d', { willReadFrequently: true });
    const d = c.getImageData(0, 0, canvas.width, canvas.height).data, n = canvas.width * canvas.height;
    const g = new Uint8Array(n);
    for (let i = 0; i < n; i++) g[i] = (0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]) | 0;
    return g;
  }
  function otsu(g) {
    const hist = new Uint32Array(256); for (const v of g) hist[v]++;
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let wB = 0, sB = 0, best = -1, th = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue; const wF = g.length - wB; if (!wF) break;
      sB += t * hist[t]; const m = sB / wB - (sum - sB) / wF, v = wB * wF * m * m; if (v > best) { best = v; th = t; }
    }
    return th;
  }
  function scaled(src, rect, sc) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(rect.w * sc)); cv.height = Math.max(1, Math.round(rect.h * sc));
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, cv.width, cv.height);
    return cv;
  }
  // Slika jedne ćelije za OCR: povećana, pojačan kontrast, po želji crno-bijela, s bijelim rubom
  function cellImage(src, rect0, sc, bin) {
    // ćelija se sužava prema unutra da ostaci crta tablice ne uđu u OCR
    const mx = Math.max(1.2, rect0.w * 0.04), my = Math.max(1, rect0.h * 0.1);
    const rect = { x: rect0.x + mx, y: rect0.y + my, w: Math.max(2, rect0.w - 2 * mx), h: Math.max(2, rect0.h - 2 * my) };
    const cv = scaled(src, rect, sc), w = cv.width, h = cv.height;
    const g = grayOf(cv); let lo = 255, hi = 0; for (const v of g) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const th = bin ? otsu(g) : 0, span = Math.max(1, hi - lo);
    const pad = 30, out = document.createElement('canvas'); out.width = w + 2 * pad; out.height = h + 2 * pad;
    const oc = out.getContext('2d'); oc.fillStyle = '#fff'; oc.fillRect(0, 0, out.width, out.height);
    const im = oc.createImageData(w, h);
    for (let i = 0; i < g.length; i++) {
      const v = bin ? (g[i] <= th ? 0 : 255) : Math.round((g[i] - lo) * 255 / span);
      im.data[4 * i] = im.data[4 * i + 1] = im.data[4 * i + 2] = v; im.data[4 * i + 3] = 255;
    }
    oc.putImageData(im, pad, pad);
    return out;
  }

  // Pronalazak redaka i ćelija iz crta tablice
  function detectGrid(src) {
    const s = Math.max(1, Math.min(8, 2000 / src.width));
    const cv = scaled(src, { x: 0, y: 0, w: src.width, h: src.height }, s), W2 = cv.width, H2 = cv.height;
    const g = grayOf(cv), th = otsu(g), dark = new Uint8Array(g.length);
    for (let i = 0; i < g.length; i++) dark[i] = g[i] <= th ? 1 : 0;
    const cluster = (arr, gap) => { const out = []; arr.forEach(v => { const L = out[out.length - 1]; if (L && v - L[1] <= gap) L[1] = v; else out.push([v, v]); }); return out; };
    const hRows = [];
    for (let y = 0; y < H2; y++) {
      let run = 0, mx = 0;
      for (let x = 0; x < W2; x++) { if (dark[y * W2 + x]) { run++; if (run > mx) mx = run; } else run = 0; }
      if (mx >= 0.25 * W2) hRows.push(y);
    }
    const HL = cluster(hRows, Math.max(3, Math.round(s)));
    const rows = [];
    for (let i = 0; i < HL.length - 1; i++) {
      const y0 = HL[i][1] + 1, y1 = HL[i + 1][0] - 1, bh = y1 - y0;
      if (bh < 10 || bh > 0.25 * H2) continue;
      const cut = Math.max(1, Math.round(bh * 0.08)), vx = [];
      for (let x = 0; x < W2; x++) {
        let c = 0; for (let y = y0 + cut; y <= y1 - cut; y++) c += dark[y * W2 + x];
        if (c >= 0.85 * (bh - 2 * cut + 1)) vx.push(x);
      }
      const VL = cluster(vx, Math.max(2, Math.round(s)));
      const edges = [[-1, -1], ...VL, [W2, W2]], cells = [];
      for (let k = 0; k < edges.length - 1; k++) {
        const x0 = edges[k][1] + 1, x1 = edges[k + 1][0] - 1;
        if (x1 - x0 < 8 * s) continue;
        let ink = 0; const iy0 = y0 + cut, iy1 = y1 - cut, ix0 = x0 + cut, ix1 = x1 - cut;
        for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) ink += dark[y * W2 + x];
        const area = Math.max(1, (iy1 - iy0 + 1) * (ix1 - ix0 + 1));
        cells.push({ x: x0 / s, y: y0 / s, w: (x1 - x0 + 1) / s, h: (y1 - y0 + 1) / s, cx: (x0 + x1) / 2 / s, empty: ink / area < 0.004 });
      }
      if (cells.length >= 3) rows.push({ y: y0 / s, h: bh / s, cells });
    }
    return rows;
  }

  async function readTableCells(src, label) {
    const rows = detectGrid(src);
    if (!rows.length) return { rows: [] };
    await loadScript(TESS);
    const worker = await window.Tesseract.createWorker('eng', 1);
    let mode = null;
    const setMode = async (wl) => { if (mode === wl) return; mode = wl; await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: wl }); };
    const ocr = async (img) => (await worker.recognize(img)).data.text.replace(/\s+/g, ' ').trim();
    const scFor = cell => Math.max(1, Math.min(14, 100 / Math.max(4, cell.h)));
    const variants = cell => { const s = scFor(cell); return [[s, false], [s, true], [s * 1.35, true]]; };
    let calls = 0; const tick = () => { calls++; if (calls % 5 === 0) cstat(`${label}: čitam tablicu po ćelijama (${calls} očitanja)…`); };
    try {
      // 1) zaglavlje: redak s barem četiri simbola elemenata, uključujući C
      let header = null, hi = -1;
      for (let r = 0; r < rows.length && !header; r++) {
        const cells = rows[r].cells.filter(c => !c.empty);
        if (cells.length < 5) continue;
        await setMode(WL_SYM);
        const first = [];
        for (const c of cells) { tick(); first.push(window.Cert.symFromCell(await ocr(cellImage(src, c, scFor(c), true)))); }
        if (first.filter(Boolean).length < 3) continue;
        const cols = [];
        for (const c of cells) {
          const reads = [];
          for (const [sc, bin] of variants(c)) { tick(); reads.push(await ocr(cellImage(src, c, sc, bin))); }
          const sym = window.Cert.voteSymbols(reads);
          if (sym && !cols.some(q => q.sym === sym)) cols.push({ sym, cell: c });
        }
        if (cols.length >= 4 && cols.some(q => q.sym === 'C')) { header = cols; hi = r; }
      }
      if (!header) return { rows: [] };
      const firstX = Math.min(...header.map(q => q.cell.x));
      // 2) retci vrijednosti ispod zaglavlja
      const out = [];
      for (let r = hi + 1; r < Math.min(rows.length, hi + 9); r++) {
        const row = rows[r];
        if (row.y - (rows[r - 1].y + rows[r - 1].h) > 3 * row.h) break;      // razmak: nova tablica
        // drugačiji raspored stupaca znači da je počela druga tablica (npr. mehanička svojstva)
        const same = header.filter(col => row.cells.some(q => Math.abs(q.x - col.cell.x) < 0.2 * col.cell.w && Math.abs(q.w - col.cell.w) < 0.3 * col.cell.w)).length;
        if (same < 0.6 * header.length) break;
        await setMode('');
        const labCells = row.cells.filter(c => !c.empty && c.x + c.w <= firstX + 2);
        let lab = '';
        for (const c of labCells) {
          // oznaka retka čita se u dvije varijante; uzima se ona s više slova i znamenki
          const a = []; for (const bin of [true, false]) { tick(); a.push(await ocr(cellImage(src, c, scFor(c), bin))); }
          a.sort((x, y) => (y.match(/[A-Za-z0-9]/g) || []).length - (x.match(/[A-Za-z0-9]/g) || []).length);
          lab += ' ' + a[0];
          if (a.some(t => window.Cert.isSpecLabel(t))) lab += ' Max';
        }
        lab = lab.replace(/[|\[\]_]/g, ' ').replace(/\s+/g, ' ').trim();
        if (window.Cert.isSpecLabel(lab)) continue;
        const labOk = /[A-Za-z0-9]{2,}/.test(lab);
        await setMode(WL_NUM);
        const values = {}, flags = {};
        let found = 0, dashes = 0;
        for (const col of header) {
          const c = row.cells.find(q => q.x <= col.cell.cx && q.x + q.w >= col.cell.cx);
          if (!c || c.empty) continue;
          const reads = [];
          for (const [sc, bin] of variants(c)) { tick(); reads.push(await ocr(cellImage(src, c, sc, bin))); }
          if (reads.filter(t => /^[-–—]+$/.test(t.replace(/\s/g, ''))).length >= 2) { dashes++; continue; }
          const v = window.Cert.voteNumbers(reads);
          if (!v) continue;
          const fit = window.Cert.fitRange(col.sym, v.value, 1);
          values[col.sym] = +fit.v.toPrecision(4); found++;
          if (fit.f !== 1) flags[col.sym] = 'preračunato ×' + fit.f;
          if (v.agree < v.total) flags[col.sym] = `nesigurno pročitano (${v.agree} od ${v.total} očitanja se slaže)`;
          if (fit.bad) flags[col.sym] = 'izvan uobičajenog raspona';
        }
        if (found < 2) { if (out.length) break; else continue; }
        if (values.C === undefined) continue;
        // granice iz norme: crtice umjesto vrijednosti i bez čitljive oznake retka
        if (dashes && !labOk) continue;
        out.push({ label: lab || ('redak ' + (out.length + 1)), values, flags, page: 1, labOk });
      }
      // ako barem jedan redak ima čitljivu oznaku (npr. M14x70), retci bez oznake su granice ili zaglavlja
      let named = out.filter(r => r.labOk);
      // kad oznake stvarnih redaka imaju znamenke (M14x70, broj taline), kratka oznaka bez znamenki je pogrešno pročitan "Max"/"Min"
      if (named.some(r => /\d/.test(r.label))) named = named.filter(r => /\d/.test(r.label) || r.label.replace(/[^A-Za-z]/g, '').length > 3);
      return { rows: (named.length ? named : out).map(({ labOk, ...r }) => r) };
    } finally { await worker.terminate(); }
  }

  // Ponovno čitanje vrijednosti na položajima stupaca iz zaglavlja (za tablice bez crta):
  // svaka vrijednost čita se samo sa znamenkama u tri varijante, a glasa i prvo očitanje
  async function refineByColumns(res, pages, label) {
    const blocks = (res.blocks || []).filter(b => pages && pages[b.page]);
    if (!blocks.length) return 0;
    await loadScript(TESS);
    const worker = await window.Tesseract.createWorker('eng', 1);
    await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: WL_NUM });
    let changed = 0, n = 0;
    try {
      for (const b of blocks) {
        const src = pages[b.page], sc = Math.max(1, Math.min(8, 70 / Math.max(6, b.hMed)));
        for (const r of b.rows) {
          const row = res.rows[r.row];
          for (const c of b.cols) {
            if (['CEV', 'CET', 'PCM'].includes(c.sym) && row.values[c.sym] === undefined) continue;
            const rect = { x: Math.max(0, c.x - 0.48 * b.gap), y: Math.max(0, r.y - 0.85 * b.hMed), w: 0.96 * b.gap, h: 1.7 * b.hMed };
            if (rect.x + rect.w > src.width) rect.w = src.width - rect.x;
            if (rect.y + rect.h > src.height) rect.h = src.height - rect.y;
            const reads = [];
            for (const [k, bin] of [[sc, false], [sc, true], [sc * 1.3, true]]) {
              reads.push((await worker.recognize(cellImage(src, rect, k, bin))).data.text.replace(/\s+/g, ''));
              if (++n % 5 === 0) cstat(`${label}: provjeravam vrijednosti (${n} očitanja)…`);
            }
            const prev = row.values[c.sym];
            if (prev !== undefined) reads.push(String(prev));
            // glasaju samo očitanja u uobičajenom rasponu elementa (zarez pročitan kao znamenka daje npr. "0611")
            const R = window.Cert.RANGE[c.sym];
            const ok = reads.filter(t => { const q = window.Cert.normCellNum(t); return q && (!R || parseFloat(q.s) <= R[1]); });
            const v = window.Cert.voteNumbers(ok.length ? ok : reads);
            if (!v) continue;
            const fit = window.Cert.fitRange(c.sym, v.value, 1);
            const nv = +fit.v.toPrecision(4);
            if (prev === undefined || Math.abs(nv - prev) > 1e-9) {
              row.values[c.sym] = nv; changed++;
              row.flags[c.sym] = prev === undefined ? 'pročitano ponovnim čitanjem stupca' : `ispravljeno ponovnim čitanjem (bilo ${String(prev).replace('.', ',')})`;
            }
            if (v.agree < v.total) row.flags[c.sym] = (row.flags[c.sym] ? row.flags[c.sym] + '; ' : '') + `${v.agree} od ${v.total} očitanja se slaže`;
          }
        }
      }
    } finally { await worker.terminate(); }
    return changed;
  }

  async function readPdf(file, opts = {}) {
    cstat('Učitavam čitač PDF-a…');
    await loadScript(PDFJS);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const tokens = [], pages = {}, canvases = {}, scanned = []; let preview = null, ocr = false;
    for (let pn = 1; pn <= Math.min(doc.numPages, 3); pn++) {
      const page = await doc.getPage(pn);
      const vp1 = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = tc.items.filter(it => it.str && it.str.trim());
      const vp = page.getViewport({ scale: 2 });
      const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      if (pn === 1) preview = cv;
      canvases[pn] = cv;
      if (items.map(it => it.str).join('').length > 40) {
        for (const it of items) {
          const h = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
          tokens.push({ t: it.str, x: it.transform[4], y: vp1.height - it.transform[5] - h / 2, w: it.width, h, page: pn });
        }
      } else if (opts.ocr === false) {
        scanned.push(pn);                      // OCR se radi tek ako zatreba
      } else {
        ocr = true;
        const t = await ocrCanvas(cv, pn, `Stranica ${pn} je skenirana`);
        tokens.push(...t); pages[pn] = t.prepped;
      }
    }
    return { tokens, preview, ocr, pages, canvases, scanned };
  }

  async function readImage(file, opts = {}) {
    const url = URL.createObjectURL(file);
    const img = new Image(); img.src = url; await img.decode();
    const scale = Math.min(1, 4000 / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * scale); cv.height = Math.round(img.naturalHeight * scale);
    const c = cv.getContext('2d'); c.drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(url);
    if (opts.ocr === false) return { tokens: [], preview: cv, ocr: false, pages: {}, canvases: { 1: cv }, scanned: [1] };
    const tokens = await ocrCanvas(cv, 1, 'Fotografija');
    return { tokens, preview: cv, ocr: true, pages: { 1: tokens.prepped }, canvases: { 1: cv }, scanned: [] };
  }

  /* ---- čitanje certifikata Claudeom ----
   * Kad je stranica otvorena kao Claude artefakt, slika certifikata šalje se Claudeu, koji vraća
   * podatke kao JSON (na računu osobe koja gleda stranicu). Inače, ili ako Claude nije dostupan,
   * koristi se OCR u pregledniku. */
  const SAMPLE = { fn: null, types: [], maxBytes: 0, ok: false };
  const sampleReady = (async () => {
    try {
      if (!window.claude || typeof window.claude.use !== 'function') return false;
      const fn = await window.claude.use('sample');
      if (!fn) return false;
      const lim = await fn.limits().catch(() => null);
      if (!lim || !lim.images) return false;
      Object.assign(SAMPLE, { fn, types: lim.images.mediaTypes || [], maxBytes: lim.images.maxInputBytes || 0, ok: true });
      if (!$('certPanel').hidden) return true;
      cstat('PDF ili fotografija certifikata prema EN 10204 (3.1). Certifikat čita Claude na tvom Claude računu; slika se šalje samo za to čitanje.');
      return true;
    } catch (e) { return false; }
  })();

  const CLAUDE_ELEMS = ['C', 'Si', 'Mn', 'P', 'S', 'Cr', 'Mo', 'Ni', 'Cu', 'V', 'Nb', 'Ti', 'Al', 'B', 'N'];
  const CLAUDE_PROMPT = (part) => `Na slici je ${part} certifikata o ispitivanju materijala (npr. prema EN 10204, tip 3.1). Pročitaj podatke i vrati SAMO jedan JSON objekt, bez ikakvog drugog teksta, ovog oblika:
{"grade": "S355J2+N" ili null, "heat": "broj taline" ili null, "cev": broj ili null, "reh": broj ili null,
 "rows": [{"label": "oznaka retka", ${CLAUDE_ELEMS.map(k => `"${k}": broj ili null`).join(', ')}}],
 "unsure": ["simboli elemenata čije su znamenke slabo čitljive"]}
Pravila:
- "rows" su retci STVARNE kemijske analize (npr. talina/ladle, proizvod/product ili oznaka uzorka ili proizvoda). Retke s granicama iz norme ili narudžbe (Min, Max, Specified, Required, Soll) NE uključuj.
- Vrijednosti su maseni udjeli u postocima, kao decimalni brojevi s točkom (0,226 piše se 0.226). Ako tablica navodi faktor (npr. ×100 ili ×1000), preračunaj u postotke.
- Element koji nije naveden ili ima crticu umjesto vrijednosti je null. Ne nagađaj i ne računaj vrijednosti koje ne pišu.
- "cev": ekvivalent ugljika (CEV, CE, Ceq) samo ako je naveden; inače null.
- "reh": granica tečenja ReH ili Rp0,2 u MPa ako je navedena (prvi uzorak); inače null.
- "heat": broj taline (Heat No., Cast No., Schmelze, Talina); "grade": oznaka čelika ili kvalitete; inače null.
- U "unsure" navedi samo elemente čije vrijednosti nisu jasno čitljive na slici.`;

  const canvasBlob = cv => new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('slika')), 'image/png'));
  const numOrNull = x => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x))) ? null : Number(x);

  function fromClaude(j) {
    if (!j || typeof j !== 'object') throw { code: 'invalid_json' };
    const unsure = new Set((Array.isArray(j.unsure) ? j.unsure : []).map(String));
    const rows = (Array.isArray(j.rows) ? j.rows : []).map((r, i) => {
      const values = {}, flags = {};
      CLAUDE_ELEMS.forEach(k => {
        const v = numOrNull(r && r[k]); if (v === null || v < 0) return;
        values[k] = v;
        const R = window.Cert.RANGE[k];
        if (R && v > R[1]) flags[k] = 'izvan uobičajenog raspona';
        if (unsure.has(k)) flags[k] = 'Claude: slabo čitljivo na slici';
      });
      return { label: String((r && r.label) || ('redak ' + (i + 1))).slice(0, 60), values, flags, page: 1 };
    }).filter(r => r.values.C !== undefined && Object.keys(r.values).length >= 2);
    let cev = numOrNull(j.cev); if (cev !== null && (cev < 0.15 || cev > 0.95)) cev = null;
    let reh = numOrNull(j.reh); if (reh !== null && (reh < 100 || reh > 1500)) reh = null;
    const str = v => (typeof v === 'string' && v.trim()) ? v.trim().slice(0, 40) : null;
    return { rows, cev, ReH: reh, grade: str(j.grade), heat: str(j.heat), warnings: [], blocks: [] };
  }

  const CLAUDE_OFF = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'images_unavailable'];
  const claudeMsg = code => ({
    not_granted: 'Čitanje Claudeom nije odobreno, pa se koristi OCR u pregledniku.',
    rate_limited: 'Claude je trenutno ograničen (previše zahtjeva ili dosegnut limit računa), pa se koristi OCR. Pokušaj kasnije.',
    session_expired: 'Prijava na Claude je istekla; prijavi se ponovno. Zasad se koristi OCR.',
    image_rejected: 'Claude nije prihvatio sliku, pa se koristi OCR.',
    refused: 'Claude nije pročitao ovu sliku, pa se koristi OCR.',
    invalid_json: 'Claudeov odgovor nije bilo moguće obraditi, pa se koristi OCR.'
  })[code] || 'Claude trenutno nije dostupan, pa se koristi OCR.';

  async function readWithClaude(blob, part, label) {
    const t0 = Date.now();
    const timer = setInterval(() => cstat(`${label}: Claude čita certifikat… ${Math.round((Date.now() - t0) / 1000)} s (obično 10–60 s)`), 1000);
    try {
      const j = await SAMPLE.fn.json(CLAUDE_PROMPT(part), { images: [blob] });
      return fromClaude(j);
    } catch (e) {
      const code = e && e.code ? e.code : 'upstream_error';
      if (CLAUDE_OFF.includes(code)) SAMPLE.ok = false;
      throw { code, msg: claudeMsg(code) + ` (kod: ${code})` };
    } finally { clearInterval(timer); }
  }

  // Slika za Claudea uvijek se iscrta na stranici i šalje kao JPEG (isto za fotografiju i PDF),
  // najviše 2400 px po duljoj stranici; platforma je ionako smanjuje na oko 1,2 megapiksela.
  async function imageForClaude(src) {
    const k = Math.min(1, 2400 / Math.max(src.width, src.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(src.width * k); cv.height = Math.round(src.height * k);
    const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
    c.imageSmoothingQuality = 'high'; c.drawImage(src, 0, 0, cv.width, cv.height);
    const jpg = await new Promise(r => cv.toBlob(b => r(b), 'image/jpeg', 0.92));
    return jpg || canvasBlob(cv);
  }

  // OCR naknadno, za stranice koje su preskočene dok se čekao Claude
  async function ensureOcr(out) {
    for (const pn of out.scanned || []) {
      const t = await ocrCanvas(out.canvases[pn], pn, pn === 1 && !out.isPdf ? 'Fotografija' : `Stranica ${pn} je skenirana`);
      out.tokens.push(...t); out.pages[pn] = t.prepped; out.ocr = true;
    }
    out.scanned = [];
  }

  const CERT_FIELDS = ['C', 'Si', 'Mn', 'Cr', 'Mo', 'Ni', 'Cu', 'V'];
  function showCertRow() {
    const r = CERTP.res.rows[+$('certRow').value || 0];
    $('certChem').innerHTML = CERT_FIELDS.map(k => {
      const v = r && r.values[k] !== undefined ? r.values[k] : '';
      const fl = r && r.flags[k];
      return `<label class="${fl || v === '' ? 'flag' : ''}" title="${esc(fl || (v === '' ? 'nije pronađeno' : ''))}">${k}<input type="text" inputmode="decimal" data-el="${k}" value="${v}"></label>`;
    }).join('') + `<label>ReH, MPa<input type="text" inputmode="decimal" data-el="ReH" value="${CERTP.res.ReH ?? ''}"></label>` +
      `<label>CEV<input type="text" inputmode="decimal" data-el="CEV" value="${(r && r.values.CEV !== undefined ? r.values.CEV : CERTP.res.cev) ?? ''}"></label>`;
    const notes = [];
    if (r) Object.entries(r.flags).filter(([k]) => CERT_FIELDS.includes(k) || k === 'CEV').forEach(([k, f]) => notes.push(`${k}: ${f.replace(/\./g, ',')}`));
    const miss = r ? CERT_FIELDS.filter(k => r.values[k] === undefined) : CERT_FIELDS;
    if (miss.length) notes.push('nije pronađeno: ' + miss.join(', ') + ' (ostaje dosadašnja vrijednost ako polje ostane prazno)');
    if (CERTP.source === 'claude') notes.push('vrijednosti je pročitao Claude; usporedi ih sa slikom prije upisa');
    else if (CERTP.ocr) notes.push('tekst je prepoznat OCR-om, provjeri svaku vrijednost prema slici');
    $('certWarn').textContent = notes.length ? 'Provjeri: ' + notes.join('; ') + '.' : '';
  }

  $('certFile').addEventListener('change', async ev => {
    const file = ev.target.files[0]; ev.target.value = '';
    if (!file) return;
    $('certPanel').hidden = true;
    try {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      await Promise.race([sampleReady, new Promise(r => setTimeout(r, 1500))]);
      const viaClaude = SAMPLE.ok;
      const out = isPdf ? await readPdf(file, { ocr: !viaClaude }) : await readImage(file, { ocr: !viaClaude });
      out.isPdf = isPdf;
      let res = null, source = 'tekst', note = '';
      if (out.tokens.length && !out.scanned.length) {
        res = window.Cert.parse(out.tokens);            // PDF s tekstom: brzo i točno, bez slanja
      }
      if (SAMPLE.ok && (!res || !res.rows.length)) {
        try {
          res = await readWithClaude(await imageForClaude(out.preview), 'stranica', 'Certifikat');
          source = 'claude';
          if (!res.rows.length) { note = 'Claude na slici nije pronašao tablicu kemijskog sastava. '; res = null; }
        } catch (e) { note = (e && e.msg) || claudeMsg('upstream_error'); note += ' '; res = null; }
      }
      if (!res) {
        source = 'ocr';
        try { await ensureOcr(out); res = window.Cert.parse(out.tokens); }
        catch (e) {                               // npr. u artefaktu, gdje OCR biblioteka nije dostupna
          res = { rows: [], cev: null, ReH: null, grade: null, heat: null, warnings: [], blocks: [] };
          note += 'OCR ovdje nije dostupan. ';
        }
      }
      if (source !== 'claude') {
      // Kod OCR-a: ako tablica nije pročitana ili joj nedostaju glavni elementi, čita se po ćelijama
      const weak = r => !r.rows.length || ['C', 'Si', 'Mn'].some(k => r.rows[0].values[k] === undefined);
      if (out.ocr && res.rows.length) {
        try { await refineByColumns(res, out.pages, 'Stranica'); } catch (e) { /* ostaje prvo očitanje */ }
      }
      // Tablica s crtama: čita se i po ćelijama, a zadržava se potpuniji rezultat
      const hasGrid = () => detectGrid(out.preview).filter(r => r.cells.filter(c => !c.empty).length >= 4).length >= 3;
      if (out.ocr && (weak(res) || hasGrid())) {
        try {
          const byCells = await readTableCells(out.preview, 'Stranica');
          const cnt = rows => rows.reduce((a, r) => a + Object.keys(r.values).length, 0) + 2 * rows.length;
          if (byCells.rows.length && cnt(byCells.rows) >= cnt(res.rows)) res.rows = byCells.rows;
        } catch (e) { /* ostaje rezultat čitanja teksta */ }
      }
      }
      CERTP = { res, ocr: out.ocr, source, name: file.name, file, canvas: out.preview, sel: null };
      $('certPrev').innerHTML = '<div class="selbox" id="certSel" hidden></div>';
      out.preview.setAttribute('aria-label', 'Pregled certifikata; mišem se može označiti tablica kemijskog sastava');
      $('certPrev').prepend(out.preview); bindSelection(out.preview);
      $('certCrop').disabled = true;
      $('certMeta').innerHTML = (source === 'claude' ? '<span class="srcbadge">Pročitao Claude</span> ' : '') + [
        res.grade ? `Oznaka: <b>${esc(res.grade)}</b>` : 'Oznaka čelika nije pronađena',
        res.heat ? `talina <b>${esc(res.heat)}</b>` : null,
        Number.isFinite(res.cev) ? `CEV <b>${fmt(res.cev, 2)}</b>` : 'CEV nije pronađen',
        Number.isFinite(res.ReH) ? `ReH <b>${fmt(res.ReH, 0)} MPa</b>` : null
      ].filter(Boolean).join(', ');
      $('certRow').innerHTML = res.rows.map((r, i) => `<option value="${i}">${esc(r.label)}</option>`).join('') || '<option value="0">nije pronađeno</option>';
      $('certRowWrap').hidden = res.rows.length < 2;
      showCertRow();
      $('certPanel').hidden = false;
      cstat(note + (res.rows.length ? `Pročitano iz "${file.name}". Provjeri vrijednosti uz pregled certifikata pa ih upiši u obrazac.`
                                    : `Iz "${file.name}" nije prepoznata tablica kemijskog sastava. Vrijednosti možeš upisati ručno ispod.`));
    } catch (e) {
      cstat('Certifikat nije moguće pročitati: ' + (e && e.message ? e.message : e));
    }
  });
  $('certRow').addEventListener('change', showCertRow);

  // Označavanje tablice na pregledu: OCR samo na izrezu, uz jače povećanje
  function bindSelection(cv) {
    let start = null;
    const pt = ev => { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left) * cv.width / r.width, y: (ev.clientY - r.top) * cv.height / r.height, r }; };
    const draw = (a, b) => {
      const r = cv.getBoundingClientRect(), k = r.width / cv.width, box = $('certSel');
      Object.assign(box.style, { left: Math.min(a.x, b.x) * k + 'px', top: Math.min(a.y, b.y) * k + 'px', width: Math.abs(b.x - a.x) * k + 'px', height: Math.abs(b.y - a.y) * k + 'px' });
      box.hidden = false;
    };
    cv.addEventListener('pointerdown', ev => { start = pt(ev); cv.setPointerCapture(ev.pointerId); ev.preventDefault(); });
    cv.addEventListener('pointermove', ev => { if (start) draw(start, pt(ev)); });
    cv.addEventListener('pointerup', ev => {
      if (!start) return; const end = pt(ev);
      const sel = { x: Math.max(0, Math.min(start.x, end.x)), y: Math.max(0, Math.min(start.y, end.y)), w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };
      start = null;
      if (sel.w < 20 || sel.h < 10) { $('certSel').hidden = true; CERTP.sel = null; $('certCrop').disabled = true; return; }
      CERTP.sel = sel; $('certCrop').disabled = false;
      cstat('Područje je označeno. Klikni "Pročitaj označeno područje".');
    });
  }
  $('certCrop').addEventListener('click', async () => {
    if (!CERTP || !CERTP.sel) return;
    const s = CERTP.sel, crop = document.createElement('canvas');
    crop.width = Math.round(s.w); crop.height = Math.round(s.h);
    crop.getContext('2d').drawImage(CERTP.canvas, s.x, s.y, s.w, s.h, 0, 0, crop.width, crop.height);
    $('certCrop').disabled = true;
    try {
      let r2 = { rows: [] }, src = 'ocr', note = '';
      if (SAMPLE.ok) {
        try { r2 = await readWithClaude(await imageForClaude(crop), 'isječak s tablicom kemijskog sastava', 'Označeno područje'); src = 'claude'; }
        catch (e) { note = (e && e.msg) || ''; r2 = { rows: [] }; }
      }
      if (!r2.rows.length) {
        src = 'ocr';
        try { r2 = await readTableCells(crop, 'Označeno područje'); }
        catch (e) { r2 = { rows: [] }; note += (note ? ' ' : '') + 'OCR ovdje nije dostupan.'; }
      }
      if (!r2.rows.length && !/OCR ovdje nije dostupan/.test(note)) {
        const toks = await ocrCanvas(crop, 1, 'Označeno područje', { psm: 6, targetW: 3200, maxScale: 10, hLine: 0.15, vLine: 0.45 });
        r2 = window.Cert.parse(toks);
      }
      if (r2.rows.length) {
        CERTP.res.rows = r2.rows; CERTP.ocr = src === 'ocr'; CERTP.source = src;
        if (src === 'claude') { ['grade', 'heat', 'ReH'].forEach(k => { if (r2[k] != null && CERTP.res[k] == null) CERTP.res[k] = r2[k]; }); }
        if (Number.isFinite(r2.cev)) CERTP.res.cev = r2.cev;
        $('certRow').innerHTML = r2.rows.map((r, i) => `<option value="${i}">${esc(r.label)}</option>`).join('');
        $('certRowWrap').hidden = r2.rows.length < 2;
        showCertRow();
        cstat(note + (note ? ' ' : '') + `Iz označenog područja pročitano je ${r2.rows.length} ${r2.rows.length === 1 ? 'redak' : 'retka'} analize. Provjeri vrijednosti prema slici.`);
      } else cstat('Ni u označenom području nije prepoznata tablica. Pokušaj označiti tablicu zajedno sa zaglavljem (C, Si, Mn…) ili upiši vrijednosti ručno.');
    } catch (e) { cstat('Čitanje označenog područja nije uspjelo: ' + (e && e.message ? e.message : e)); }
    $('certCrop').disabled = false;
  });
  $('certCancel').addEventListener('click', () => { $('certPanel').hidden = true; cstat('Učitavanje certifikata je otkazano.'); });
  $('certApply').addEventListener('click', () => {
    const val = k => { const el = $('certChem').querySelector(`[data-el="${k}"]`); const v = el ? numv(el.value) : NaN; return Number.isFinite(v) ? v : null; };
    const preset = window.Cert.presetFor(CERTP.res.grade);
    const have = CERT_FIELDS.filter(k => val(k) !== null);
    if (!have.length && val('ReH') === null) { cstat('Na certifikatu nije prepoznata nijedna vrijednost (sastav ni ReH), pa nema što primijeniti. Upiši vrijednosti u tablicu ili označi područje s kemijskim sastavom.'); return; }
    if (preset && $('mat').value !== preset) { $('mat').value = preset; applyMaterial(); }
    CERT_FIELDS.forEach(k => { const v = val(k); if (v !== null) $('c' + k).value = v; });
    const reh = val('ReH'); if (reh !== null) $('Re').value = reh;
    CERT = { cev: val('CEV'), heat: CERTP.res.heat, grade: CERTP.res.grade, file: CERTP.name };
    $('certPanel').hidden = true;
    $('certInfo').innerHTML = `Podaci iz certifikata <b>${esc(CERT.file)}</b>${CERT.grade ? ', ' + esc(CERT.grade) : ''}${CERT.heat ? ', talina ' + esc(CERT.heat) : ''}.`;
    const miss = CERT_FIELDS.filter(k => val(k) === null).concat(val('ReH') === null ? ['ReH'] : []);
    CERT.miss = miss;
    cstat('Vrijednosti iz certifikata upisane su u obrazac.' + (miss.length ? ' Nisu na certifikatu (ostale su tipične vrijednosti za ' + $('mat').value + '): ' + miss.join(', ') + '.' : ''));
    if (miss.length) $('certInfo').innerHTML += ` <span class="warnline" style="display:inline">Tipične vrijednosti zadržane za: ${esc(miss.join(', '))}.</span>`;
    probeAuto = true; render();
  });

  /* ---------------- rezultati iz CalculiX-a ---------------- */
  function parseTwoCols(text) {
    const out = [];
    text.replace(/^\ufeff/, '').split(/\r?\n/).forEach(line => {
      if (!line.trim() || /^[#!*]/.test(line.trim())) return;
      let parts = line.includes(';') ? line.split(';') : line.includes('\t') ? line.split('\t')
        : (line.match(/,/g) || []).length === 1 && !/\d,\d+\s+\S/.test(line) ? line.split(',') : line.trim().split(/\s+/);
      parts = parts.map(x => x.trim()).filter(Boolean);
      if (parts.length < 2) return;
      const a = parseFloat(parts[0].replace(',', '.')), b = parseFloat(parts[1].replace(',', '.'));
      if (Number.isFinite(a) && Number.isFinite(b)) out.push([a, b]);
    });
    return out.sort((p, q) => p[0] - q[0]);
  }
  // Vrsta rezultata iz zaglavlja (y_mm;sigma_x… ili x_mm;sigma_y…), a bez zaglavlja iz podataka:
  // poprečni profil ima negativne udaljenosti (obje strane zavara), profil duž zavara samo pozitivne
  function femKindOf(text, pts) {
    const head = text.replace(/^\ufeff/, '').split(/\r?\n/)[0].toLowerCase();
    if (/sigma_?x|σx|sx\b/.test(head) || /^\s*y/.test(head)) return 'x';
    if (/sigma_?y|σy|sy\b/.test(head) || /^\s*x/.test(head)) return 'y';
    return pts.some(q => q[0] < 0) ? 'x' : 'y';
  }
  $('femFile').addEventListener('change', async ev => {
    const files = [...ev.target.files]; ev.target.value = ''; if (!files.length) return;
    const ok = [], bad = [];
    for (const f of files) {
      const text = await f.text(); let pts = parseTwoCols(text);
      const head = text.replace(/^\ufeff/, '').split(/\r?\n/)[0].toLowerCase();
      if (pts.length < 3) { bad.push(`U "${f.name}" nisu pronađena barem tri retka s dva broja.`); continue; }
      if (/temp|°c|\bt_?c\b|vrijeme|time|\bt_?s\b/.test(head) && !/sigma|σ|\bs[xy]\b|mpa/.test(head)) { bad.push(`"${f.name}" izgleda kao toplinski ciklus (vrijeme i temperatura); učitaj ga na kartici Toplina.`); continue; }
      let note = '';
      if (/\bpa\b|\(pa\)|_pa\b/.test(head) && !/mpa/.test(head)) { pts = pts.map(q => [q[0], q[1] / 1e6]); note = ' (pretvoreno iz Pa u MPa)'; }
      if (pts.some(q => Math.abs(q[1]) > 5000)) { bad.push(`U "${f.name}" ima naprezanja većih od 5.000 MPa. Jesu li vrijednosti u Pa? Zapiši ih u MPa ili u zaglavlje stavi jedinicu Pa.`); continue; }
      const kind = femKindOf(text, pts);
      FEM[kind] = pts; FEM.sig = sigFem(P);
      ok.push(`"${f.name}": ${pts.length} ${plural(pts.length, 'točka', 'točke', 'točaka')}, ${kind === 'x' ? 'uzdužno naprezanje σx preko zavara' : 'poprečno naprezanje σy duž zavara'}${note}.`);
    }
    $('femStatus').textContent = (ok.length ? 'Učitano: ' + ok.join(' ') : '') + (bad.length ? (ok.length ? ' Nije učitano: ' : 'Nije učitano: ') + bad.join(' ') + ((FEM.x || FEM.y) && !ok.length ? ' Prethodno učitani rezultati ostaju.' : '') : '');
    if (P) renderStress();
  });
  $('femClear').addEventListener('click', () => { FEM.x = null; FEM.y = null; FEM.sig = ''; $('femStatus').textContent = 'Učitani rezultati su uklonjeni.'; if (P) renderStress(); });
  ['smMM', 'smOK', 'smSU'].forEach(id => $(id).addEventListener('change', () => { if (P) renderStress(); }));

  /* ---------------- vođeni primjer ---------------- */
  // Ulazi za koje je izračunat priloženi primjer iz CalculiX-a (primjer-calculix/*.csv)
  const PRIMJER = { mat: 'S355J2', d: 12, B: 120, L: 200, joint: 'butt', restr: 'mid', proc: 'MAG', HD: '5', I: 260, U: 27, v: 25, TpWPS: 50, T0: 20, Ta: 18, RH: 60 };
  async function showExample() {
    const st = t => { $('exMsg').textContent = t; };
    $('exBtn').disabled = true; st('Učitavam primjer…');
    $('mat').value = PRIMJER.mat; applyMaterial();
    Object.entries(PRIMJER).forEach(([k, v]) => { if (k !== 'mat') $(k).value = v; });
    KCAL.on = false; KCAL.k = NaN; probeAuto = true;
    render();
    const done = [];
    const get = async f => { const r = await fetch('primjer-calculix/' + f); if (!r.ok) throw new Error(f); return r.text(); };
    try {
      FEM.x = parseTwoCols(await get('profil_sx.csv'));
      FEM.y = parseTwoCols(await get('profil_sy.csv'));
      FEM.sig = sigFem(P);
      $('femStatus').textContent = 'Učitan primjer rezultata iz CalculiX-a za ove ulaze (σx i σy).';
      const pts = parseTwoColsTime(await get('ciklus_T.csv'));
      Object.assign(MC, { pts, name: 'ciklus_T.csv (primjer iz CalculiX-a)', stats: W.cycleStats(pts), sig: sigCyc(P) });
      $('mcY').value = 6; probeY = 6; probeAuto = false;
      $('mcStatus').textContent = 'Učitan simulirani ciklus iz CalculiX-a, 6 mm od osi zavara (ZUT).';
      done.push('rezultati CalculiX-a (naprezanja i toplinski ciklus)');
    } catch (e) { st('Rezultati CalculiX-a nisu dostupni na ovoj adresi; ostatak primjera je učitan.'); }
    if (!STORE.shared && !LOG.some(r => r.demo)) { await logAdd(demoEntries()); done.push('6 izmišljenih zapisa u dnevniku'); }
    if (LOG.some(r => r.demo)) { ML.demo = true; $('mlDemo').checked = true; }
    renderLog(); render();
    $('exBtn').disabled = false;
    st(`Upisani su ulazi za sučeljeni spoj S355J2, 12 mm${done.length ? '; učitani su i ' + done.join(' te ') : ''}. Prođi kroz korake 2 do 4.`);
  }
  $('exBtn').addEventListener('click', showExample);

  /* ---------------- događaji ---------------- */
  let pending = false;
  const schedule = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; render(); }); };

  $('mat').addEventListener('change', () => {
    applyMaterial(); probeAuto = true;
    if (CERT) { CERT = null; $('certInfo').innerHTML = 'Promijenjen je materijal, pa su podaci s certifikata zamijenjeni tipičnim vrijednostima za ' + esc($('mat').value) + '.'; }
    schedule();
  });
  $('proc').addEventListener('change', () => { applyProcess(); schedule(); });
  $('f').addEventListener('input', ev => { LOADMISS = []; if (ev.target.id !== 'mat' && ev.target.id !== 'proc') schedule(); });
  ['TA', 'TB'].forEach(id => $(id).addEventListener('input', () => { if (P) { renderCompare(); if (pwMode !== 'meas') renderPW(); } }));

  $('yProbe').addEventListener('input', () => { probeY = parseFloat($('yProbe').value); probeAuto = false; if (P) { renderCycle(); if (!playing) drawField(); } });
  $('probeHAZ').addEventListener('click', () => { probeAuto = true; schedule(); });
  fcv.addEventListener('click', ev => {
    const r = fcv.getBoundingClientRect();
    const y = Math.abs((FH / 2 - (ev.clientY - r.top) * FH / r.height) / SC);
    probeY = clamp(Math.round(y * 10) / 10, 0.5, 30); probeAuto = false;
    if (P) { renderCycle(); if (!playing) drawField(); }
  });
  fcv.addEventListener('keydown', ev => {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
    ev.preventDefault(); probeY = clamp(probeY + (ev.key === 'ArrowUp' ? 0.5 : -0.5), 0.5, 30); probeAuto = false;
    if (P) { renderCycle(); if (!playing) drawField(); }
  });
  function setPlay(on) {
    playing = on; $('playBtn').setAttribute('aria-pressed', on); $('playBtn').textContent = on ? 'Zaustavi' : 'Pokreni';
    lastT = 0; if (!on) drawField();
  }
  $('playBtn').addEventListener('click', () => setPlay(!playing));

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(en => { visible = en[0].isIntersecting; lastT = 0; }).observe(fcv);
  }

  if ($('toggleNotes')) $('toggleNotes').addEventListener('click', e => {
    const open = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    document.querySelectorAll('details.how').forEach(d => { d.open = open; });
    e.currentTarget.setAttribute('aria-pressed', open);
    e.currentTarget.textContent = open ? 'Sakrij sve napomene' : 'Prikaži sve napomene';
  });
  $('printBtn').addEventListener('click', () => window.print());
  // Unutar Claude artefakta ispis i obične veze za preuzimanje ne rade; primjer certifikata sprema se kroz Claude
  if (window.claude && typeof window.claude.use === 'function') {
    $('printBtn').hidden = true;
    $('sampleCert').addEventListener('click', async ev => {
      ev.preventDefault();
      const dl = await window.claude.use('downloads').catch(() => null);
      if (!dl) { cstat('Preuzimanje ovdje nije dostupno. Primjer certifikata nalazi se i na GitHub stranici projekta.'); return; }
      try {
        const blob = await (await fetch('primjer-certifikata.pdf')).blob();
        await dl.save({ filename: 'primjer-certifikata.pdf', data: blob });
      } catch (e) { if (e && e.code !== 'declined') cstat('Primjer certifikata nije spremljen.'); }
    });
  }
  // Koja je verzija otvorena: u Claude artefaktu certifikat čita Claude, a dnevnik je zajednički
  const ARTEFAKT = 'https://claude.ai/artifact/8PoWP6bv6DsQC6ZmSix36p';
  const GITHUB = 'https://ea11599.github.io/zavar-test/';
  if (window.claude && typeof window.claude.use === 'function') {
    $('verNote').innerHTML = `Ova verzija radi unutar Claudea: certifikate (i fotografije) čita Claude, a dnevnik zavara zajednički je svima kojima je stranica podijeljena. Javna verzija bez prijave: <a href="${GITHUB}" target="_blank" rel="noopener">GitHub Pages</a>.`;
  } else {
    $('verNote').innerHTML = `Ovo je javna verzija: certifikate čita prepoznavanje teksta (OCR) u pregledniku, a dnevnik ostaje na ovom računalu (razmjena preko CSV-a). U <a href="${ARTEFAKT}" target="_blank" rel="noopener">verziji unutar Claudea</a> certifikate čita Claude, što je pouzdanije za fotografije i skenove, a dnevnik je zajednički. Ta se verzija otvara uz Claude račun kojem je podijeljena.`;
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { fieldStateDirty = true; if (P) render(); });

  /* ---------------- prva kartica: ključne vrijednosti naprezanja ---------------- */
  function renderStKey() {
    const box = (v, unit, lab, sub) => `<div class="metric"><b>${v}${unit ? ' <small>' + unit + '</small>' : ''}</b><span>${lab}${sub ? '<br>' + sub : ''}</span></div>`;
    const M = W.stressModels(P, P.T0);
    if (SU.pred) {
      const o = SU.pred.out, iv = (q, d) => `95 % interval ${fmt(q.vlo, d)} do ${fmt(q.vup, d)}${q.vclip ? '*' : ''}`;
      $('stKey').innerHTML = box(fmt(o.sxMax.val, 0), 'MPa', 'najveće uzdužno naprezanje σx', iv(o.sxMax, 0)) +
        box('±' + fmt(o.b0.val, 1), 'mm', 'širina vlačne zone (od osi zavara)', iv(o.b0, 1)) +
        box(fmt(o.syMid.val, 0), 'MPa', 'poprečno naprezanje σy u sredini zavara', iv(o.syMid, 0));
      const rel = 100 * o.sxMax.val / P.Re;
      let note = `Surogatni model naučen na proračunima u CalculiX-u. Najveće naprezanje iznosi ${fmt(rel, 0)} % granice tečenja i nalazi se u ZUT-u, nekoliko milimetara od osi zavara; u samom zavaru je niže. ` +
        `Analitički model Masubuchija i Martina daje ${fmt(M.MM.peak, 0)} MPa i vlačnu zonu ±${fmt(M.MM.b, 1)} mm.`;
      let wt = $('suWarn').textContent;
      if (!['sxMax', 'b0', 'syMid'].some(k => o[k].vclip)) wt = wt.replace(SU.clipMsg, '').trim();   // zvjezdica se ovdje odnosi samo na prikazane vrijednosti
      if (wt) note += ` <span class="warnline" style="display:inline">${esc(wt)}</span>`;
      $('stKeyNote').innerHTML = note;
    } else {
      $('stKey').innerHTML = box(fmt(M.MM.peak, 0), 'MPa', 'najveće uzdužno naprezanje σx', 'analitički model') +
        box('±' + fmt(M.MM.b, 1), 'mm', 'širina vlačne zone', 'Masubuchi i Martin') + box(fmt(M.TR.at(P.L / 2), 0), 'MPa', 'σy u sredini zavara', 'analitički model');
      $('stKeyNote').textContent = SU.err || '';
    }
    if (LOADMISS.length) $('stKeyNote').insertAdjacentHTML('afterbegin', `<span class="warnline" style="display:block;margin:0 0 6px">Učitani zapis iz dnevnika nema: ${esc(LOADMISS.join(', '))}; ta polja zadržala su prethodne vrijednosti.</span>`);
    if (femStale() || mcStale()) $('stKeyNote').insertAdjacentHTML('beforeend', ` <span class="warnline" style="display:block;margin-top:6px">${femStale() ? 'Učitani rezultati iz CalculiX-a' : 'Učitani toplinski ciklus'}${femStale() && mcStale() ? ' i toplinski ciklus' : ''} izračunati su za druge ulaze nego što su sada upisani.</span>`);
    $('stSide').innerHTML = box(fmt(E.Q, 2), 'kJ/mm', 'unos topline' + (KCAL.on ? `<br>kalibrirani k = ${fmt(KCAL.k, 2)}` : '')) + box(fmt(E.t85, 1), 's', 't8/5 (EN 1011-2)') +
      box(String(Math.round(E.HV)), 'HV', 'najveća tvrdoća ZUT-a') + box(String(Math.round(E.risk)), '', 'indeks rizika od grešaka', verdict(E.risk)[0]);
  }

  /* ---------------- stranice (kartice) ---------------- */
  // Svaka kartica je <div class="tab">; adresa (#polje, #dnevnik…) bira karticu, a dublja sidra (#prozor) i mjesto na njoj.
  const TAB_ROOTS = { naprezanja: 't-naprezanja', surogat: 't-surogat', polje: 't-toplina', dnevnik: 't-dnevnik', procjena: 't-rizik', plan: 't-orad' };
  function route(ev) {
    const h = decodeURIComponent(location.hash.slice(1)) || 'naprezanja';
    let el = document.getElementById(h);
    let tab = el ? (el.classList.contains('tab') ? el : el.closest('.tab')) : null;
    if (!tab) { tab = $('t-naprezanja'); el = null; }
    document.querySelectorAll('.tab').forEach(t => { t.hidden = t !== tab; });
    document.querySelectorAll('nav.tabs a').forEach(a => { if (a.dataset.tab === tab.id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $('inSum').hidden = tab.id === 't-naprezanja';
    // preglednik nakon promjene adrese sam skoči na sidro; to se poništava u sljedećem okviru
    const place = () => { if (el && !TAB_ROOTS[h]) el.scrollIntoView({ behavior: 'auto', block: 'start' }); else window.scrollTo(0, 0); };
    setTimeout(place, 60);   // preglednik ponekad skoči na sidro tek kad kartica postane vidljiva
    requestAnimationFrame(() => {
      place();
      // nakon promjene kartice tipkovnicom ili čitačem zaslona fokus ide na naslov kartice
      if (ev && TAB_ROOTS[h]) { const h2 = tab.querySelector('h2'); if (h2) { h2.setAttribute('tabindex', '-1'); h2.focus({ preventScroll: true }); } }
    });
    fieldStateDirty = true; lastT = 0;
    if (P && tab.id === 't-toplina' && !playing) drawField();
  }
  function go(h) { if (location.hash === '#' + h) route(); else location.hash = h; }
  window.addEventListener('hashchange', route);
  // klik na karticu mijenja adresu bez skoka preglednika na sidro
  document.querySelectorAll('nav.tabs a').forEach(a => a.addEventListener('click', ev => {
    if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button) return;
    ev.preventDefault(); const h = a.getAttribute('href');
    if (location.hash !== h) history.pushState(null, '', h);
    route(ev);
  }));
  window.addEventListener('popstate', () => route());
  { const nv = document.querySelector('nav.tabs'); const upd = () => nv.classList.toggle('end', nv.scrollLeft + nv.clientWidth >= nv.scrollWidth - 4);
    nv.addEventListener('scroll', upd, { passive: true }); window.addEventListener('resize', upd); upd(); }
  // sažetak ulaza na ostalim karticama
  function renderInSum() {
    if (!P) { $('inSum').innerHTML = 'Ulazni podaci nisu potpuni. <a href="#ulazi">Ispravi ih na prvoj kartici</a>.'; return; }
    $('inSum').innerHTML = `${esc(P.mat)}, ${fmt(P.d, 0)} mm, ${P.joint === 'butt' ? 'sučeljeni spoj' : 'kutni spoj'}; ${P.proc} ${fmt(P.I, 0)} A, ${fmt(P.U, 1)} V, ${fmt(P.v, 0)} cm/min; ` +
      `komad ${fmt(P.T0, 0)} °C. <a href="#ulazi">Promijeni ulaze</a>`;
  }

  /* ---------------- pokretanje ---------------- */
  applyMaterial();
  $('HD').value = '5';
  legend();
  suOptions(); suInit(); renderSuValidation();
  loadLog(); renderLog(); initSharedLog();
  if (!playing) { xs = 120; setPlay(false); }
  render();
  route();
  requestAnimationFrame(tick);
})();
