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
  function applyProcess() { $('HD').value = String(W.HD_DEFAULT[$('proc').value]); }

  function read() {
    const g = id => parseFloat($(id).value);
    const comp = {}; CHEM.forEach(k => { comp[k] = g('c' + k); });
    return {
      T0: g('T0'), Ta: g('Ta'), RH: g('RH'), Re: g('Re'), d: g('d'), joint: $('joint').value,
      restr: $('restr').value, proc: $('proc').value, HD: g('HD'), I: g('I'), U: g('U'), v: g('v'),
      TpWPS: g('TpWPS'), tmin: g('tmin'), tmax: g('tmax'), Tmax: g('Tmax'),
      group: W.MAT[$('mat').value].group, mat: $('mat').value, comp, coupleU: $('coupleU').checked
    };
  }

  function invalid(p) {
    const need = { T0: 'temperatura komada', Ta: 'okolna temperatura', RH: 'relativna vlažnost', Re: 'granica tečenja',
      d: 'debljina lima', I: 'struja', U: 'napon', v: 'brzina zavarivanja', TpWPS: 'propisano predgrijavanje',
      tmin: 'ciljani t8/5 od', tmax: 'ciljani t8/5 do', Tmax: 'najveća temperatura komada' };
    for (const k in need) if (!Number.isFinite(p[k])) return 'Upiši vrijednost: ' + need[k] + '.';
    for (const k of CHEM) if (!Number.isFinite(p.comp[k]) || p.comp[k] < 0) return 'Upiši udio elementa ' + k + ' (0 ili više).';
    if (p.comp.C <= 0 || p.comp.C > 0.5) return 'Udio ugljika mora biti između 0 i 0,5 %.';
    if (p.d <= 0 || p.I <= 0 || p.U <= 0 || p.v <= 0) return 'Debljina, struja, napon i brzina moraju biti veći od nule.';
    if (p.RH < 1 || p.RH > 100) return 'Relativna vlažnost mora biti između 1 i 100 %.';
    if (p.T0 >= 450) return 'Temperatura komada mora biti ispod 450 °C.';
    if (p.tmin >= p.tmax) return 'Ciljani t8/5 "od" mora biti manji od "do".';
    return null;
  }

  /* ---------------- stanje ---------------- */
  let P = null, E = null, REC = null, ST = null;
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
    renderSummary(); renderReco(); renderStress(); renderCycle(); renderCompare(); renderPW();
    fieldStateDirty = true;
    if (!playing) drawField();
  }

  function showError(msg) {
    P = null;
    $('risk').textContent = '–'; $('verdict').textContent = msg; $('verdict').style.color = 'var(--bad)';
    ['mQ', 'mT85', 'mHV', 'mTp', 'mDew', 'mB'].forEach(id => { $(id).textContent = '–'; });
    $('causes').innerHTML = ''; $('cetWarn').textContent = ''; $('ceOut').textContent = '';
    $('reco').innerHTML = '<p class="note">Preporuka će se prikazati kad su svi ulazni podaci ispravni.</p>';
    ['cycle', 'stress', 'chart'].forEach(id => { $(id).innerHTML = ''; });
    $('cycleOut').textContent = ''; $('stressOut').textContent = ''; $('dA').innerHTML = ''; $('dB').innerHTML = '';
    const c = $('pw').getContext('2d'); c.clearRect(0, 0, 760, 420);
  }

  function renderSummary() {
    const p = P, e = E;
    $('risk').textContent = Math.round(e.risk);
    const [vt, col] = verdict(e.risk);
    $('verdict').textContent = vt; $('verdict').style.color = col;
    $('pin').style.left = clamp(e.risk, 0, 100) + '%';
    $('tint').setAttribute('aria-label', 'Indeks rizika ' + Math.round(e.risk) + ' od 100');
    $('mQ').textContent = fmt(e.Q, 2);
    $('mT85').textContent = fmt(e.t85, 1);
    $('mT85l').textContent = `t8/5, s (${e.is2D ? '2D' : '3D'} odvođenje; cilj ${fmt(p.tmin, 0)}–${fmt(p.tmax, 0)})`;
    $('mHV').textContent = Math.round(e.HV);
    $('mHVl').textContent = `najveća tvrdoća ZUT-a, HV (granica ${e.HVlim})`;
    $('mHVbox').classList.toggle('alert', e.HV > e.HVlim);
    if (e.TpCET <= 0) { $('mTp').textContent = '0'; $('mTpl').textContent = 'potrebno predgrijavanje (CET), °C: nije potrebno'; }
    else { $('mTp').textContent = Math.round(e.TpCET); $('mTpl').textContent = 'potrebno predgrijavanje (CET), °C'; }
    $('mDew').textContent = fmt(e.Td, 1);
    $('mB').textContent = fmt(2 * ST.b, 0);
    $('cetWarn').textContent = e.cetWarn.length ? 'Izraz za predgrijavanje primijenjen izvan područja valjanosti: ' + e.cetWarn.join(', ') + '.' : '';
    $('ceOut').innerHTML = `CE = <b>${fmt(e.CE, 2)}</b>, CET = <b>${fmt(e.CET, 2)}</b>, skupina materijala ${p.group}`;
    $('causes').innerHTML = e.causes.map(c => `
      <div class="cause"><span>${c.k}</span>
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
      ${row(q.T0 > p.T0 ? 'Temperatura komada (predgrijati na)' : 'Temperatura komada', p.T0, q.T0, '°C')}
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
      $('T0').value = q.T0; $('I').value = Ir; $('U').value = Math.round(q.U * 2) / 2; $('v').value = Math.round(q.v);
      render();
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
    const o = { W: 520, H: 300, L: 50, R: 14, T: 14, B: 40, x0: c.pts[0][0], x1: tEnd, y0: 0,
      y1: Math.min(Math.max(c.peak * 1.08, 900), 1700) };
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
    s += `<circle id="cycMark" r="5" fill="${ink}" cx="-20" cy="-20"/>`;
    $('cycle').innerHTML = s;
    CYC.axes = A; CYC.o = o;
    let txt = `Vršna temperatura <b>${fmt(Math.min(c.peak, 3000), 0)} °C</b>. `;
    if (c.peak >= W.T_MELT) txt += 'Točka je u talini. ';
    if (Number.isFinite(c.t85)) txt += `t8/5 s krivulje: <b>${fmt(c.t85, 1)} s</b> (Rosenthal, F = 1); prema EN 1011-2: <b>${fmt(E.t85, 1)} s</b>.`;
    else txt += 'Točka ne doseže 800 °C, pa za nju t8/5 nije definiran.';
    $('cycleOut').innerHTML = txt;
  }

  /* ---------------- zaostala naprezanja ---------------- */
  function renderStress() {
    const st = ST, p = P;
    const ym = clamp(Math.ceil(4 * st.b / 10) * 10, 30, 150);
    const o = { W: 760, H: 300, L: 56, R: 16, T: 16, B: 40, x0: -ym, x1: ym, y0: -0.6 * p.Re, y1: 1.15 * p.Re };
    o.xt = ticks(-ym, ym, 8); o.yt = ticks(o.y0, o.y1, 6); o.xl = 'udaljenost od osi zavara, mm'; o.yl = 'σx, MPa';
    const A = axes(o); let s = A.s;
    const bronze = css('--bronze'), blue = css('--blue'), ink = css('--ink'), straw = css('--straw');
    // talina
    s += `<rect x="${A.X(-st.yF)}" y="${o.T}" width="${A.X(st.yF) - A.X(-st.yF)}" height="${o.H - o.T - o.B}" fill="${straw}" opacity=".35"/>`;
    const pos = [], neg = [], all = [];
    for (let i = 0; i <= 300; i++) {
      const y = -ym + 2 * ym * i / 300, sv = st.at(y);
      all.push([A.X(y), A.Y(sv)]);
      pos.push([A.X(y), A.Y(Math.max(sv, 0))]); neg.push([A.X(y), A.Y(Math.min(sv, 0))]);
    }
    const y0 = A.Y(0);
    const area = arr => `M${arr[0][0]},${y0} ` + arr.map(q => `L${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ') + ` L${arr[arr.length - 1][0]},${y0} Z`;
    s += `<path d="${area(pos)}" fill="${bronze}" opacity=".35"/><path d="${area(neg)}" fill="${blue}" opacity=".3"/>`;
    s += `<line x1="${o.L}" x2="${o.W - o.R}" y1="${y0}" y2="${y0}" stroke="${ink}" opacity=".7"/>`;
    s += `<polyline fill="none" stroke="${ink}" stroke-width="2.2" points="${all.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ')}"/>`;
    s += `<line x1="${o.L}" x2="${o.W - o.R}" y1="${A.Y(p.Re)}" y2="${A.Y(p.Re)}" stroke="${bronze}" stroke-dasharray="5 4"/><text x="${o.W - o.R - 4}" y="${A.Y(p.Re) - 5}" text-anchor="end">Re = ${fmt(p.Re, 0)} MPa</text>`;
    for (const sg of [-1, 1]) s += `<line x1="${A.X(sg * st.b)}" x2="${A.X(sg * st.b)}" y1="${o.T}" y2="${o.H - o.B}" stroke="${ink}" stroke-dasharray="2 4"/>`;
    s += `<text x="${A.X(st.b) + 4}" y="${o.T + 12}">b</text><text x="${A.X(0)}" y="${o.T + 12}" text-anchor="middle">talina</text>`;
    s += `<text x="${A.X(-Math.sqrt(3) * st.b)}" y="${A.Y(-0.2 * p.Re)}" text-anchor="middle" style="fill:${ink}">tlak</text><text x="${A.X(Math.sqrt(3) * st.b)}" y="${A.Y(-0.2 * p.Re)}" text-anchor="middle" style="fill:${ink}">tlak</text><text x="${A.X(0)}" y="${A.Y(0.45 * p.Re)}" text-anchor="middle" style="fill:${ink};font-weight:600">vlak</text>`;
    $('stress').innerHTML = s;
    $('stressOut').innerHTML = `Vrh σₘ ≈ Re = <b>${fmt(p.Re, 0)} MPa</b>. Vlačna zona ±b = <b>±${fmt(st.b, 1)} mm</b>, talina ±${fmt(st.yF, 1)} mm (model). Najveće tlačno naprezanje ≈ <b>${fmt(-0.446 * p.Re, 0)} MPa</b> na ±${fmt(Math.sqrt(3) * st.b, 1)} mm od osi.`;
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
    if (pwMode === 'A') return parseFloat($('TA').value);
    if (pwMode === 'B') return parseFloat($('TB').value);
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
      ctx.fillText(q.T0 > P.T0 ? `preporuka, uz ${Math.round(q.T0)} °C` : 'preporuka', x + 15, y + 16);
    }
    $('pwReco').disabled = !(REC && REC.best && REC.best.p.T0 > P.T0);
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
    const TA = parseFloat($('TA').value), TB = parseFloat($('TB').value);
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

  /* ---------------- dnevnik zavara ---------------- */
  const LKEY = 'zavarDnevnik.v1';
  let LOG = [];
  function loadLog() { try { LOG = JSON.parse(localStorage.getItem(LKEY) || '[]'); if (!Array.isArray(LOG)) LOG = []; } catch (e) { LOG = []; } }
  function saveLog() { try { localStorage.setItem(LKEY, JSON.stringify(LOG)); } catch (e) { msg('Spremanje u preglednik nije uspjelo; izvezi CSV da ne izgubiš podatke.'); } }
  const msg = t => { $('lgMsg').textContent = t; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function entryFrom(p, extra = {}) {
    const e = W.evaluate(p);
    return {
      id: uid(), ts: new Date().toISOString(), oznaka: '', zavarivac: '', napomena: '', demo: false,
      in: { mat: p.mat, Re: p.Re, d: p.d, joint: p.joint, restr: p.restr, proc: p.proc, HD: p.HD, I: p.I, U: p.U, v: p.v,
        TpWPS: p.TpWPS, T0: p.T0, Ta: p.Ta, RH: p.RH, tmin: p.tmin, tmax: p.tmax, Tmax: p.Tmax, ...p.comp },
      pred: { Q: e.Q, t85: e.t85, HV: e.HV, TpCET: e.TpCET, risk: e.risk },
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
        <td class="num">${fmt(r.in.T0, 0)}</td><td class="num">${fmt(r.pred.Q, 2)}</td>
        <td class="num">${fmt(r.pred.t85, 1)}</td><td class="num">${Math.round(r.pred.HV)}</td><td class="num">${Math.round(r.pred.risk)}</td>
        ${MJ.map(([k]) => `<td><input type="number" step="any" data-k="${k}" value="${r.mj[k] === '' || r.mj[k] == null ? '' : r.mj[k]}" aria-label="${k}"></td>`).join('')}
        <td><select data-k="greske" aria-label="Greške">${GRESKE.map(g => `<option ${g === r.mj.greske ? 'selected' : ''} value="${g}">${g || '–'}</option>`).join('')}</select></td>
        <td class="num"><button type="button" class="ghost" data-act="load">Učitaj</button> <button type="button" class="ghost" data-act="del" aria-label="Obriši zapis">Obriši</button></td>
        </tr>`).join('');
      $('lgTable').innerHTML = `<table class="t"><thead><tr><th>Datum</th><th>Oznaka</th><th>Zavarivač</th><th>Materijal</th><th>T₀, °C</th><th>Q</th><th>t8/5 pred.</th><th>HV pred.</th><th>Rizik</th>${MJ.map(m => `<th>${m[1]}</th>`).join('')}<th>Greške</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    renderScatter('scHV', 'HV', 'HV');
    renderScatter('scT', 't85', 's');
  }

  $('lgTable').addEventListener('change', ev => {
    const tr = ev.target.closest('tr'); if (!tr) return;
    const r = LOG.find(x => x.id === tr.dataset.id); if (!r) return;
    const k = ev.target.dataset.k;
    r.mj[k] = k === 'greske' ? ev.target.value : (ev.target.value === '' ? '' : parseFloat(ev.target.value));
    saveLog(); renderScatter('scHV', 'HV', 'HV'); renderScatter('scT', 't85', 's');
  });
  $('lgTable').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    const tr = b.closest('tr'); const r = LOG.find(x => x.id === tr.dataset.id); if (!r) return;
    if (b.dataset.act === 'del') { LOG = LOG.filter(x => x !== r); saveLog(); renderLog(); msg('Zapis je obrisan.'); }
    if (b.dataset.act === 'load') { loadEntry(r); msg(`Ulazi zapisa ${r.oznaka || ''} učitani su u obrazac.`); $('procjena').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }); }
  });

  function loadEntry(r) {
    const i = r.in;
    if (W.MAT[i.mat]) $('mat').value = i.mat;
    const set = (id, v) => { if (v !== undefined && v !== null && v !== '') $(id).value = v; };
    ['Re', 'd', 'joint', 'restr', 'proc', 'I', 'U', 'v', 'TpWPS', 'T0', 'Ta', 'RH', 'tmin', 'tmax', 'Tmax'].forEach(k => set(k, i[k]));
    set('HD', String(i.HD));
    CHEM.forEach(k => set('c' + k, i[k]));
    probeAuto = true; render();
  }

  function renderScatter(id, key, unit) {
    const pts = LOG.filter(r => r.mj[key] !== '' && r.mj[key] != null && Number.isFinite(+r.mj[key]))
      .map(r => ({ p: r.pred[key], m: +r.mj[key], lab: r.oznaka, demo: r.demo }));
    const svg = $(id);
    if (!pts.length) { svg.innerHTML = `<text x="180" y="150" text-anchor="middle">Nema izmjerenih vrijednosti. Upiši ih u tablicu iznad.</text>`; return; }
    const all = pts.flatMap(q => [q.p, q.m]);
    let a = Math.min(...all), b = Math.max(...all); const pad = (b - a) * 0.12 || Math.abs(a) * 0.1 || 1; a -= pad; b += pad;
    const o = { W: 360, H: 300, L: 50, R: 14, T: 14, B: 40, x0: a, x1: b, y0: a, y1: b, xt: ticks(a, b, 5), yt: ticks(a, b, 5),
      xl: `predviđeno, ${unit}`, yl: `izmjereno, ${unit}`, xf: t => fmt(t, key === 'HV' ? 0 : 0), yf: t => fmt(t, 0) };
    const A = axes(o); let s = A.s;
    const ink = css('--ink'), bronze = css('--bronze'), straw = css('--straw');
    s += `<line x1="${A.X(a)}" y1="${A.Y(a)}" x2="${A.X(b)}" y2="${A.Y(b)}" stroke="${bronze}" stroke-dasharray="5 4"/>`;
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
    LOG.push(r); saveLog(); renderLog();
    msg(`Zavar ${r.oznaka || 'bez oznake'} je spremljen. Izmjerene rezultate upiši u tablicu.`);
    $('lgId').value = '';
  });
  $('lgClear').addEventListener('click', () => {
    if (!LOG.length) { msg('Dnevnik je već prazan.'); return; }
    if (confirm('Obrisati sve zapise iz dnevnika? Prije toga možeš izvesti CSV.')) { LOG = []; saveLog(); renderLog(); msg('Dnevnik je obrisan.'); }
  });
  $('lgDemo').addEventListener('click', () => {
    if (!P) { msg('Ispravi ulazne podatke prije dodavanja primjera.'); return; }
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    [0, 8, 18, 30, 45, 70].forEach((T, i) => {
      const r = entryFrom({ ...P, T0: T }, { oznaka: 'PR-' + (i + 1), zavarivac: i % 2 ? 'Z2' : 'Z1', napomena: 'PRIMJER, izmišljeni podaci', demo: true });
      r.mj.t85 = +(r.pred.t85 * (1.08 + 0.2 * rnd())).toFixed(1);
      r.mj.HV = Math.round(r.pred.HV + 12 + 30 * rnd());
      r.mj.def = +(1.2 + 0.02 * r.pred.Q * 10 + 0.4 * rnd()).toFixed(2);
      r.mj.greske = T < 10 ? 'pukotine' : 'nema';
      LOG.push(r);
    });
    saveLog(); renderLog(); msg('Dodano je 6 primjera s izmišljenim izmjerenim vrijednostima (označeni žutom crtom).');
  });

  // CSV: razdjelnik ';', decimalni zarez, UTF-8 s BOM-om (otvara se izravno u hrvatskom Excelu)
  const CSVCOLS = [
    ['datum', r => r.ts], ['oznaka', r => r.oznaka], ['zavarivac', r => r.zavarivac], ['napomena', r => r.napomena], ['primjer', r => r.demo ? 'da' : 'ne'],
    ['materijal', r => r.in.mat], ...CHEM.map(k => [k, r => r.in[k]]), ['Re_MPa', r => r.in.Re], ['debljina_mm', r => r.in.d],
    ['spoj', r => r.in.joint], ['uklijestenost', r => r.in.restr], ['postupak', r => r.in.proc], ['HD', r => r.in.HD],
    ['I_A', r => r.in.I], ['U_V', r => r.in.U], ['v_cm_min', r => r.in.v], ['Tp_WPS_C', r => r.in.TpWPS],
    ['T0_C', r => r.in.T0], ['Ta_C', r => r.in.Ta], ['RH_pct', r => r.in.RH], ['t85_min_s', r => r.in.tmin], ['t85_max_s', r => r.in.tmax], ['Tmax_C', r => r.in.Tmax],
    ['Q_kJ_mm', r => r.pred.Q], ['t85_pred_s', r => r.pred.t85], ['HV_pred', r => r.pred.HV], ['Tp_CET_C', r => r.pred.TpCET], ['rizik_pred', r => r.pred.risk],
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
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'dnevnik-zavara-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    msg(`Izvezeno ${LOG.length} zapisa.`);
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
      let n = 0;
      rows.forEach(r => {
        const inp = { mat: get(r, 'materijal'), Re: num(get(r, 'Re_MPa')), d: num(get(r, 'debljina_mm')), joint: get(r, 'spoj') || 'butt',
          restr: get(r, 'uklijestenost') || 'mid', proc: get(r, 'postupak') || 'MAG', HD: num(get(r, 'HD')), I: num(get(r, 'I_A')), U: num(get(r, 'U_V')),
          v: num(get(r, 'v_cm_min')), TpWPS: num(get(r, 'Tp_WPS_C')), T0: num(get(r, 'T0_C')), Ta: num(get(r, 'Ta_C')), RH: num(get(r, 'RH_pct')),
          tmin: num(get(r, 't85_min_s')), tmax: num(get(r, 't85_max_s')), Tmax: num(get(r, 'Tmax_C')) };
        CHEM.forEach(k => { inp[k] = num(get(r, k)); });
        LOG.push({ id: uid(), ts: get(r, 'datum') || new Date().toISOString(), oznaka: get(r, 'oznaka'), zavarivac: get(r, 'zavarivac'),
          napomena: get(r, 'napomena'), demo: get(r, 'primjer') === 'da', in: inp,
          pred: { Q: num(get(r, 'Q_kJ_mm')), t85: num(get(r, 't85_pred_s')), HV: num(get(r, 'HV_pred')), TpCET: num(get(r, 'Tp_CET_C')), risk: num(get(r, 'rizik_pred')) },
          mj: { t85: num(get(r, 't85_mj_s')), HV: num(get(r, 'HV_mj')), def: num(get(r, 'kutna_def_mj_deg')), sig: num(get(r, 'sigma_mj_MPa')), greske: get(r, 'greske') } });
        n++;
      });
      saveLog(); renderLog(); msg(`Uvezeno ${n} zapisa.`);
    } catch (e) { msg('Datoteku nije moguće pročitati kao CSV.'); }
    ev.target.value = '';
  });

  /* ---------------- događaji ---------------- */
  let pending = false;
  const schedule = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; render(); }); };

  $('mat').addEventListener('change', () => { applyMaterial(); probeAuto = true; schedule(); });
  $('proc').addEventListener('change', () => { applyProcess(); schedule(); });
  $('f').addEventListener('input', ev => { if (ev.target.id !== 'mat' && ev.target.id !== 'proc') schedule(); });
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

  $('toggleNotes').addEventListener('click', e => {
    const open = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    document.querySelectorAll('details.how').forEach(d => { d.open = open; });
    e.currentTarget.setAttribute('aria-pressed', open);
    e.currentTarget.textContent = open ? 'Sakrij sve napomene' : 'Prikaži sve napomene';
  });
  $('printBtn').addEventListener('click', () => window.print());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { fieldStateDirty = true; if (P) render(); });

  /* ---------------- pokretanje ---------------- */
  applyMaterial(); applyProcess();
  $('HD').value = '5';
  legend();
  loadLog(); renderLog();
  if (!playing) { xs = 120; setPlay(false); }
  render();
  requestAnimationFrame(tick);
})();
