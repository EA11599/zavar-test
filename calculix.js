/* Generator ulazne datoteke za CalculiX (ccx 2.x) za sučeljeni spoj ploča.
 *
 * Model: polovica ploče (simetrija u ravnini zavara y = 0), heksaedarski elementi C3D8,
 * spregnuta toplinsko-mehanička analiza (*COUPLED TEMPERATURE-DISPLACEMENT).
 * Izvor topline: Goldakov dvostruki elipsoid koji se kreće duž zavara. Budući da CalculiX bez
 * korisničke potprograme (dflux.f) nema pomični izvor, svaki element u zoni izvora dobiva vlastitu
 * krivulju volumnog toplinskog toka u vremenu (*AMPLITUDE + *DFLUX BF), uzorkovanu iz Goldakove
 * raspodjele dok izvor prolazi. Ukupna snaga normira se na k·U·I/2 (polovica modela).
 *
 * Jedinice: mm, s, t (tona), N, MPa, mJ, mW. Tada je W/(m·K) = mW/(mm·K), J/(kg·K) × 1e6 = mJ/(t·K),
 * W/(m²·K) × 1e-3 = mW/(mm²·K).
 */
(function (root) {
  'use strict';

  // Svojstva ugljičnog čelika ovisna o temperaturi prema EN 1993-1-2:2005 (Eurokod 3, dio 1-2), točke 3.2 i 3.4:
  // toplinska vodljivost (3.4.1.3), specifični toplinski kapacitet (3.4.1.2, s vrhom na 735 °C zbog
  // magnetske pretvorbe), toplinsko produljenje (3.4.1.1) i faktori smanjenja k_y,θ i k_E,θ (tablica 3.1).
  // Norma vrijedi do 1200 °C; iznad toga vrijednosti su numeričke pretpostavke (označene u PROPS.src).
  const EC3 = {
    lambda: T => T < 800 ? 54 - 3.33e-2 * T : 27.3,
    c: T => T < 600 ? 425 + 7.73e-1 * T - 1.69e-3 * T * T + 2.22e-6 * T ** 3
      : T < 735 ? 666 + 13002 / (738 - T)
      : T < 900 ? 545 + 17820 / (T - 731) : 650,
    elong: T => T < 750 ? 1.2e-5 * T + 0.4e-8 * T * T - 2.416e-4
      : T < 860 ? 1.1e-2 : 2e-5 * T - 6.2e-3,
    // tablica 3.1: θ, k_y (efektivna granica tečenja), k_E (nagib elastičnog dijela)
    tab: [[20, 1, 1], [100, 1, 1], [200, 1, .9], [300, 1, .8], [400, 1, .7], [500, .78, .6], [600, .47, .31],
      [700, .23, .13], [800, .11, .09], [900, .06, .0675], [1000, .04, .045], [1100, .02, .0225], [1200, 0, 0]]
  };
  const interp = (T, col) => {
    const t = EC3.tab;
    if (T <= t[0][0]) return t[0][col];
    for (let i = 1; i < t.length; i++) if (T <= t[i][0]) {
      const f = (T - t[i - 1][0]) / (t[i][0] - t[i - 1][0]); return t[i - 1][col] + f * (t[i][col] - t[i - 1][col]);
    }
    return t[t.length - 1][col];
  };
  // Najmanje vrijednosti iznad ~1000 °C: krutost i čvrstoća ne smiju pasti na nulu (numerička stabilnost)
  const E_MIN = 0.05, KY_MIN = 0.05;
  const PROPS = (() => {
    const T = [20, 100, 200, 300, 400, 500, 600, 650, 700, 750, 800, 860, 900, 1000, 1100, 1200, 1450, 1700, 3000];
    // Vrh c na 735 °C (širok samo nekoliko stupnjeva) ruši konvergenciju toplinske analize. Između 600 i 900 °C
    // zato se uzima srednja vrijednost c na intervalu ±50 °C: entalpija (površina ispod krivulje) ostaje ista.
    const cAvg = t => { const D = 50, n = 400; let h = 0; for (let i = 0; i < n; i++) h += EC3.c(t - D + (i + .5) * 2 * D / n); return h / n; };
    const o = { T, k: [], c: [], E: [], alpha: [], yieldFactor: [], src: [] };
    T.forEach(t => {
      const tt = Math.min(t, 1200);
      // iznad tališta vodljivost raste kao zamjena za strujanje taline (pretpostavka, nije iz norme)
      o.k.push(t <= 1450 ? EC3.lambda(tt) : t <= 1700 ? 70 : 90);
      o.c.push(t >= 600 && t <= 900 ? cAvg(t) : EC3.c(tt));
      o.E.push(210000 * Math.max(E_MIN, interp(tt, 2)));
      const el = t <= 1200 ? EC3.elong(t) : EC3.elong(1200) + 2e-5 * (t - 1200);
      o.alpha.push(el / (t - 20 || 1) || 1.2e-5);      // sekantni koeficijent od 20 °C (*EXPANSION, ZERO=20)
      o.yieldFactor.push(Math.max(KY_MIN, interp(tt, 1)));
      o.src.push(t <= 1200 ? 'EN 1993-1-2' : 'pretpostavka');
    });
    o.alpha[0] = 1.2e-5 + 0.8e-8 * 20;                   // derivacija u 20 °C
    return o;
  })();
  const RHO = 7.85e-9;          // t/mm³
  const NU = 0.3;
  const FILM = 10;              // W/(m²·K)
  const EMISS = 0.8;

  const MESH = {
    gruba:   { hx: 4.0, hf: 1.5, nzMin: 3 },
    srednja: { hx: 2.5, hf: 1.0, nzMin: 4 },
    fina:    { hx: 1.5, hf: 0.75, nzMin: 5 }
  };

  const f = (x, n = 6) => {
    if (!Number.isFinite(x)) return '0.';
    const s = Math.abs(x) >= 1e5 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(n - 1) : String(+x.toPrecision(n));
    return /[.eE]/.test(s) ? s : s + '.';
  };

  // Goldakovi parametri iz širine taline (Rosenthal) i debljine
  function goldakParams(p, yF) {
    const b = Math.max(2, yF);                        // poluširina kupke, mm
    const c = Math.min(p.d, Math.max(2, 1.2 * yF));   // dubina, mm
    return { b, c, af: b, ar: 2 * b, ff: 0.6, fr: 1.4 };
  }

  function goldak(g, Q, dx, y, zd) {                   // dx = x − x_izvora (+ ispred), zd = dubina ispod površine
    const front = dx >= 0, a = front ? g.af : g.ar, fr = front ? g.ff : g.fr;
    const q0 = 6 * Math.sqrt(3) * fr * Q / (a * g.b * g.c * Math.PI * Math.sqrt(Math.PI));
    return q0 * Math.exp(-3 * dx * dx / (a * a) - 3 * y * y / (g.b * g.b) - 3 * zd * zd / (g.c * g.c));
  }

  // Koordinate čvorova u smjeru y: fina zona uz zavar, zatim geometrijski rast prema rubu
  function gradedY(half, hf, wf) {
    const ys = [0];
    while (ys[ys.length - 1] < Math.min(wf, half) - 1e-9) ys.push(Math.min(ys[ys.length - 1] + hf, Math.min(wf, half)));
    let h = hf;
    while (ys[ys.length - 1] < half - 1e-9) {
      h = Math.min(h * 1.3, half / 6);
      const nxt = ys[ys.length - 1] + h;
      ys.push(half - nxt < 0.5 * h ? half : Math.min(nxt, half));
    }
    return ys;
  }

  function build(p, opts = {}) {
    const W = opts.Weld || root.Weld;
    const m = MESH[opts.mesh || 'srednja'];
    const L = p.L, half = p.B / 2, d = p.d;
    const T0 = Math.min(p.T0, 450), Ta = p.Ta;
    const v = p.v * 10 / 60;                                    // mm/s
    const Qtot = W.kOf(p) * p.U * p.I * 1000;                // mW (k iz norme ili kalibriran)
    const Qhalf = Qtot / 2;
    const yF = Math.max(1, W.stressProfile(p, T0).yF);
    const g = goldakParams(p, yF);
    // izvor mora obuhvatiti nekoliko elemenata, inače temperature u pojedinom elementu postaju nerealne
    g.b = Math.max(g.b, 2 * m.hf); g.c = Math.min(p.d, Math.max(g.c, 2 * p.d / Math.max(m.nzMin, Math.round(p.d / 3))));
    g.af = Math.max(g.af, 1.5 * m.hx); g.ar = Math.max(g.ar, 2 * g.af);

    const nx = Math.max(10, Math.round(L / m.hx));
    const xs = Array.from({ length: nx + 1 }, (_, i) => L * i / nx);
    const ys = gradedY(half, m.hf, Math.min(half, Math.max(3 * g.b, 6)));
    const nz = Math.max(m.nzMin, Math.round(d / 3));
    const zs = Array.from({ length: nz + 1 }, (_, k) => d * k / nz);
    const NX = nx + 1, NY = ys.length, NZ = nz + 1;
    const nid = (i, j, k) => 1 + i + NX * (j + NY * k);
    const eid = (i, j, k) => 1 + i + nx * (j + (NY - 1) * k);
    const nodes = NX * NY * NZ, elems = nx * (NY - 1) * nz;
    const tWeld = L / v;
    const dt = Math.min(m.hx / v / 2, tWeld / 50);
    const incWeld = Math.ceil(tWeld / dt);
    const nSteps = (opts.nHeat || 40) + (opts.nCool || 25);
    // procjena trajanja (oba dijela), prilagođena na 37 proračuna ovim generatorom na računalu s dvije jezgre
    // (po dva proračuna istodobno): t ≈ 8,0·10⁻⁴ · čvorovi^1,567 s, rasipanje oko ±9 %
    const estMin = Math.max(1, Math.round(8.0e-4 * Math.pow(nodes, 1.567) / 60));
    const baseInfo = { nodes, elems, nx, ny: NY - 1, nz, g, Qtot: Qtot / 1000, tWeld, dt, incWeld, nSteps, estMin, half, L, d };
    if (opts.infoOnly) return { info: baseInfo };

    const fmtHdr = (title) => [
      `** ${title}. Generirao: Provjera parametara zavarivanja.`,
      '** Sučeljeni spoj, polovica modela (simetrija y = 0); jedinice: mm, s, t, N, MPa, mJ.',
      `** Materijal: ${p.mat || 'čelik'}, Re = ${p.Re} MPa; d = ${d} mm, B = ${p.B} mm, L = ${L} mm`,
      `** Postupak ${p.proc}: I = ${p.I} A, U = ${f(p.U, 4)} V, v = ${p.v} cm/min, k = ${f(W.kOf(p), 3)}, Q = ${f(Qtot / 1000, 5)} W`,
      `** Goldak: b = ${f(g.b, 3)} mm, c = ${f(g.c, 3)} mm, af = ${f(g.af, 3)} mm, ar = ${f(g.ar, 3)} mm, ff = ${g.ff}, fr = ${g.fr}`,
      `** Temperatura komada ${T0} °C, okolina ${Ta} °C.`
    ];

    // ---- zajednički dio: čvorovi, elementi i skupovi ----
    const meshLines = [];
    const mp = s => meshLines.push(s);
    mp('*NODE, NSET=Nall');
    for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++)
      mp(`${nid(i, j, k)}, ${f(xs[i])}, ${f(ys[j])}, ${f(zs[k])}`);
    const elemLines = [];
    for (let k = 0; k < nz; k++) for (let j = 0; j < NY - 1; j++) for (let i = 0; i < nx; i++)
      elemLines.push(`${eid(i, j, k)}, ${nid(i, j, k)}, ${nid(i + 1, j, k)}, ${nid(i + 1, j + 1, k)}, ${nid(i, j + 1, k)}, ` +
        `${nid(i, j, k + 1)}, ${nid(i + 1, j, k + 1)}, ${nid(i + 1, j + 1, k + 1)}, ${nid(i, j + 1, k + 1)}`);
    const setLines = [];
    const set = (kw, name, ids) => { setLines.push(`*${kw}, ${kw}=${name}`); for (let a = 0; a < ids.length; a += 16) setLines.push(ids.slice(a, a + 16).join(', ') + ','); };
    const eTop = [], eBot = [];
    for (let j = 0; j < NY - 1; j++) for (let i = 0; i < nx; i++) { eTop.push(eid(i, j, nz - 1)); eBot.push(eid(i, j, 0)); }
    set('ELSET', 'Etop', eTop); set('ELSET', 'Ebot', eBot);
    const nSym = [], nOuter = [];
    for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) { nSym.push(nid(i, 0, k)); nOuter.push(nid(i, NY - 1, k)); }
    set('NSET', 'Nsym', nSym); set('NSET', 'Nrub', nOuter);
    const iMid = Math.round(nx / 2);
    // "termoparovi": čvorovi gornje površine na sredini duljine, do 25 mm od osi; skripta za rezultate
    // među njima bira točku u ZUT-u (najviši vrh ispod solidusa), jer se rub taline ne zna unaprijed
    const probes = []; ys.forEach((y, j) => { if (y <= 25 + 1e-9) probes.push(nid(iMid, j, nz)); });
    set('NSET', 'Ntermopar', probes);
    const eProf = [], eWeld = [];
    for (let j = 0; j < NY - 1; j++) eProf.push(eid(iMid, j, nz - 1));
    for (let i = 0; i < nx; i++) eWeld.push(eid(i, 0, nz - 1));
    set('ELSET', 'Eprofil', eProf); set('ELSET', 'Ezavar', eWeld);
    const common = (type) => [...meshLines, `*ELEMENT, TYPE=${type}, ELSET=Eall`, ...elemLines, ...setLines];

    // ---- vremenski promjenjiv toplinski tok po elementima (Goldak) ----
    const reach = 3 * Math.max(g.ar, g.af);
    const cand = [];
    for (let k = 0; k < nz; k++) {
      const ze = (zs[k] + zs[k + 1]) / 2, zd = d - ze;
      if (zd > 3 * g.c) continue;
      for (let j = 0; j < NY - 1; j++) {
        const ye = (ys[j] + ys[j + 1]) / 2;
        if (ye > 3 * g.b) continue;
        for (let i = 0; i < nx; i++) {
          const xe = (xs[i] + xs[i + 1]) / 2;
          const vol = (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]) * (zs[k + 1] - zs[k]);
          cand.push({ id: eid(i, j, k), xe, ye, zd, vol });
        }
      }
    }
    // normiranje snage: uz izvor na sredini, zbroj q·V mora biti Q/2 (polovica modela)
    const xm = L / 2;
    let S = 0; cand.forEach(e => { S += goldak(g, 1, e.xe - xm, e.ye, e.zd) * e.vol; });
    const scale = S > 0 ? Qhalf / S : 0;
    const NS = 16;
    const ampLines = [], fluxLines = [];
    cand.forEach(e => {
      const t1 = Math.max(0, (e.xe - reach) / v), t2 = Math.min(tWeld, (e.xe + reach) / v);
      if (t2 <= t1) return;
      const pts = [];
      if (t1 > 0) pts.push([Math.max(0, t1 - 1e-3), 0]);
      let qmax = 0;
      for (let s2 = 0; s2 <= NS; s2++) {
        const t = t1 + (t2 - t1) * s2 / NS;
        const q = goldak(g, 1, e.xe - v * t, e.ye, e.zd) * scale;
        qmax = Math.max(qmax, q); pts.push([t, q]);
      }
      if (t2 < tWeld) pts.push([t2 + 1e-3, 0]);
      if (qmax * e.vol < 1e-5 * Qhalf) return;                      // zanemariv doprinos
      const name = 'Q' + e.id;
      ampLines.push(`*AMPLITUDE, NAME=${name}, TIME=TOTAL TIME`);
      for (let a = 0; a < pts.length; a += 4) ampLines.push(pts.slice(a, a + 4).map(q => `${f(q[0], 6)}, ${f(q[1], 5)}`).join(', ') + ',');
      fluxLines.push(`*DFLUX, AMPLITUDE=${name}`, `${e.id}, BF, 1.`);
    });

    // ---- vremena izlaza: na tim trenucima mehanička analiza učitava temperature ----
    const tCool = opts.tCool || 3000;
    const nH = opts.nHeat || 40, nC = opts.nCool || 25;
    const tpHeat = Array.from({ length: nH }, (_, a) => tWeld * (a + 1) / nH);
    const tpCool = Array.from({ length: nC }, (_, a) => tCool * Math.pow((a + 1) / nC, 2.5));
    const film = () => ['*FILM', `Etop, F2, ${f(Ta)}, ${f(FILM * 1e-3)}`, `Ebot, F1, ${f(Ta)}, ${f(FILM * 1e-3)}`,
                        '*RADIATE', `Etop, R2, ${f(Ta)}, ${f(EMISS)}`, `Ebot, R1, ${f(Ta)}, ${f(EMISS)}`];

    // ===== toplina.inp: nestacionarna toplinska analiza =====
    // Svaki trenutak koji mehanička analiza učitava zaseban je korak analize: *TEMPERATURE, BSTEP=k čita
    // posljednji ispis k-tog KORAKA u .frd datoteci (ne k-ti ispis), pa jedan ispis po koraku daje točno
    // preslikavanje. Krivulje toka zato su zadane u ukupnom vremenu (TIME=TOTAL TIME).
    const th = [...fmtHdr('Toplinska analiza (prvi dio)'), '*HEADING', 'Zavarivanje - toplinska analiza',
      ...common('DC3D8'),
      '*MATERIAL, NAME=CELIK', '*DENSITY', f(RHO),
      '*CONDUCTIVITY', ...PROPS.T.map((T, a) => `${f(PROPS.k[a])}, ${f(T)}`),
      '*SPECIFIC HEAT', ...PROPS.T.map((T, a) => `${f(PROPS.c[a] * 1e6)}, ${f(T)}`),
      '*SOLID SECTION, ELSET=Eall, MATERIAL=CELIK',
      '*PHYSICAL CONSTANTS, ABSOLUTE ZERO=-273.15, STEFAN BOLTZMANN=5.669E-11',
      '*INITIAL CONDITIONS, TYPE=TEMPERATURE', `Nall, ${f(T0)}`,
      '*CONTROLS, PARAMETERS=TIME INCREMENTATION', '8, 10, 9, 64, 10, 8, , 12, , ',
      ...ampLines];
    const tEnds = [...tpHeat, ...tpCool.map(t => tWeld + t)];
    let tPrev = 0;
    tEnds.forEach((tEnd, k) => {
      const dur = tEnd - tPrev, heat = k < nH;
      const dtMax = heat ? dt : Math.max(dt, Math.min(100, dur));
      th.push(`** Korak ${k + 1}: ${heat ? 'zavarivanje' : 'hlađenje'} do t = ${f(tEnd, 5)} s`,
        '*STEP, INC=100000', '*HEAT TRANSFER', `${f(Math.min(dt, dur), 4)}, ${f(dur, 6)}, ${f(Math.min(dt, dur) * 1e-4, 4)}, ${f(dtMax, 4)}`);
      if (k === 0) th.push(...film(), ...fluxLines);
      if (k === nH) th.push('*DFLUX, OP=NEW');
      th.push('*NODE FILE, FREQUENCY=100000', 'NT', '*NODE PRINT, NSET=Ntermopar, FREQUENCY=100000', 'NT', '*END STEP');
      tPrev = tEnd;
    });

    // ===== naprezanja.inp: mehanička analiza s temperaturama iz toplina.frd =====
    const mech = [...fmtHdr('Mehanička analiza (drugi dio, pokreće se nakon toplina.inp)'), '*HEADING', 'Zavarivanje - zaostala naprezanja',
      ...common('C3D8'),
      '*MATERIAL, NAME=CELIK',
      '*ELASTIC', ...PROPS.T.map((T, a) => `${f(PROPS.E[a])}, ${f(NU)}, ${f(T)}`),
      '*EXPANSION, ZERO=20.', ...PROPS.T.map((T, a) => `${f(PROPS.alpha[a])}, ${f(T)}`),
      '*PLASTIC'];
    PROPS.T.forEach((T, a) => { const sy = Math.max(10, p.Re * PROPS.yieldFactor[a]); mech.push(`${f(sy)}, 0., ${f(T)}`, `${f(sy * 1.1)}, 0.1, ${f(T)}`); });
    mech.push('*SOLID SECTION, ELSET=Eall, MATERIAL=CELIK',
      '*INITIAL CONDITIONS, TYPE=TEMPERATURE', `Nall, ${f(T0)}`,
      '*CONTROLS, PARAMETERS=TIME INCREMENTATION', '8, 10, 9, 64, 10, 8, , 12, , ',
      '*BOUNDARY', 'Nsym, 2, 2',                                  // simetrija: uy = 0
      `${nid(0, 0, 0)}, 1, 1`, `${nid(0, 0, 0)}, 3, 3`, `${nid(nx, 0, 0)}, 3, 3`, `${nid(0, NY - 1, 0)}, 3, 3`);
    if (p.restr === 'mid') mech.push('Nrub, 2, 2');                // rub ploče ne može se primicati zavaru
    if (p.restr === 'high') mech.push('Nrub, 1, 3');               // rub ploče potpuno ukliješten
    for (let s2 = 1; s2 <= nSteps; s2++) {
      mech.push(`** temperature iz ${s2}. izlaza toplinske analize (t = ${f(s2 <= nH ? tpHeat[s2 - 1] : tWeld + tpCool[s2 - nH - 1], 4)} s)`,
        '*STEP, INC=1000', '*STATIC', '1., 1., 1e-5, 1.', `*TEMPERATURE, FILE=toplina.frd, BSTEP=${s2}`, '*END STEP');
    }
    mech.push('** završno stanje: cijela ploča na temperaturi okoline',
      '*STEP, INC=1000', '*STATIC', '1., 1., 1e-5, 1.', '*TEMPERATURE', `Nall, ${f(Ta)}`,
      '*NODE FILE', 'U', '*EL FILE', 'S, PEEQ',
      '*EL PRINT, ELSET=Eprofil', 'S', '*EL PRINT, ELSET=Ezavar', 'S', '*END STEP');

    return {
      toplina: th.join('\n') + '\n',
      naprezanja: mech.join('\n') + '\n',
      info: { ...baseInfo, nAmp: fluxLines.length / 2, nProbes: probes.length }
    };
  }

  // Python skripta (bez dodatnih paketa) koja iz rezultata izdvaja CSV-ove za uvoz u aplikaciju
  const POST = String.raw`#!/usr/bin/env python3
"""Izdvajanje rezultata CalculiX analize za aplikaciju "Provjera parametara zavarivanja".

Redoslijed:   ccx -i toplina
              ccx -i naprezanja
              python izvuci_rezultate.py
Ulaz:   naprezanja.inp i naprezanja.dat (naprezanja u integracijskim točkama),
        toplina.dat (temperature čvorova uz površinu, do 25 mm od osi)
Izlaz:  profil_sx.csv  - y (mm); sigma_x (MPa)   preko zavara, na sredini duljine
        profil_sy.csv  - x (mm); sigma_y (MPa)   duž osi zavara
        ciklus_T.csv   - t (s); T (°C)           toplinski ciklus u ZUT-u: od čvorova uz površinu bira se
                                                 onaj s najvišim vrhom ispod solidusa (1450 °C), a njegova
                                                 udaljenost od osi upisuje se u prvi redak (# y_mm = …)
Naprezanja su prosjeci integracijskih točaka elemenata gornjeg sloja (središte elementa),
što je pouzdanije od vrijednosti u čvorovima, koje se ekstrapoliraju.
"""
import sys, re

mapa = sys.argv[1].rstrip("/\\") + "/" if len(sys.argv) > 1 else ""

def citaj_mrezu(path):
    """Čvorovi {id: (x,y,z)} i elementi {id: [čvorovi]} iz ulazne datoteke."""
    cvorovi, elementi, blok = {}, {}, None
    with open(path) as fh:
        for red in fh:
            r = red.strip()
            if not r or r.startswith("**"):
                continue
            if r.startswith("*"):
                k = r.upper()
                blok = "N" if k.startswith("*NODE,") or k == "*NODE" else "E" if k.startswith("*ELEMENT") else None
                continue
            d = [x for x in r.split(",") if x.strip()]
            if blok == "N":
                cvorovi[int(d[0])] = tuple(float(x) for x in d[1:4])
            elif blok == "E":
                elementi[int(d[0])] = [int(x) for x in d[1:]]
    return cvorovi, elementi

def citaj_naprezanja(path):
    """Zadnji ispis naprezanja po skupu: {SKUP: {element: [sxx, syy, szz, sxy, sxz, syz] prosjek}}."""
    rez, skup, zbroj = {}, None, None
    with open(path) as fh:
        for red in fh:
            m = re.search(r"stresses \(elem, integ\.pnt\.,sxx,syy,szz,sxy,sxz,syz\) for set (\S+) and time", red)
            if m:
                skup = m.group(1).upper(); zbroj = {}; rez[skup] = zbroj
                continue
            if skup is None:
                continue
            d = red.split()
            if len(d) == 8:
                try:
                    e = int(d[0]); v = [float(x) for x in d[2:]]
                except ValueError:
                    skup = None; continue
                s = zbroj.setdefault(e, [0.0] * 6 + [0])
                for a in range(6):
                    s[a] += v[a]
                s[6] += 1
            elif d:
                skup = None
    return {k: {e: [s[a] / s[6] for a in range(6)] for e, s in v.items()} for k, v in rez.items()}

def citaj_termopar(path):
    """Temperature čvorova skupa NTERMOPAR iz .dat datoteke: {čvor: [(vrijeme, T), ...]}."""
    nizovi, t = {}, None
    with open(path) as fh:
        for red in fh:
            m = re.search(r"temperatures for set NTERMOPAR and time\s+([-+0-9.Ee]+)", red, re.I)
            if m:
                t = float(m.group(1)); continue
            if t is None:
                continue
            d = red.split()
            if len(d) == 2:
                try:
                    nizovi.setdefault(int(d[0]), []).append((t, float(d[1])))
                    continue
                except ValueError:
                    pass
            if d:
                t = None
    return nizovi

SOLIDUS = 1450.0
cvorovi, elementi = citaj_mrezu(mapa + "naprezanja.inp")
s = citaj_naprezanja(mapa + "naprezanja.dat")
if "EPROFIL" not in s or "EZAVAR" not in s:
    sys.exit("U naprezanja.dat nema naprezanja za skupove Eprofil i Ezavar. Je li mehanička analiza završila?")

def sredina(e):
    c = [cvorovi[n] for n in elementi[e]]
    return tuple(sum(q[k] for q in c) / len(c) for k in range(3))

red = sorted((sredina(e)[1], v[0]) for e, v in s["EPROFIL"].items())
with open("profil_sx.csv", "w") as fh:
    fh.write("y_mm;sigma_x_MPa\n")
    for y, v in [(-y, v) for y, v in reversed(red)] + red:      # zrcaljenje preko ravnine simetrije
        fh.write(f"{y:.3f};{v:.2f}\n".replace(".", ","))
with open("profil_sy.csv", "w") as fh:
    fh.write("x_mm;sigma_y_MPa\n")
    for x, v in sorted((sredina(e)[0], v[1]) for e, v in s["EZAVAR"].items()):
        fh.write(f"{x:.3f};{v:.2f}\n".replace(".", ","))
nizovi = citaj_termopar(mapa + "toplina.dat")
# točka u ZUT-u: najviši vrh ispod solidusa (krupnozrnati ZUT uz rub taline); ako je nema, vrh najbliži 1250 °C
vrh = {n: max(T for _, T in v) for n, v in nizovi.items()}
zut = [n for n in vrh if 800.0 < vrh[n] < SOLIDUS]
izbor = max(zut, key=lambda n: vrh[n]) if zut else min(vrh, key=lambda n: abs(vrh[n] - 1250.0))
y_izbor = cvorovi[izbor][1]
tocke = sorted(nizovi[izbor])
with open("ciklus_T.csv", "w") as fh:
    fh.write(f"# y_mm = {y_izbor:.2f}; vrh {vrh[izbor]:.0f} C\n".replace(".", ","))
    fh.write("t_s;T_C\n")
    for t, T in tocke:
        fh.write(f"{t:.3f};{T:.2f}\n".replace(".", ","))
print(f"Toplinski ciklus: {y_izbor:.2f} mm od osi zavara, vrh {vrh[izbor]:.0f} °C".replace(".", ","))
print("Zapisano: profil_sx.csv, profil_sy.csv, ciklus_T.csv (" + str(len(tocke)) + " točaka ciklusa)")
`;

  const api = { build, goldak, goldakParams, gradedY, PROPS, EC3, MESH, POST };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CCX = api;
})(typeof window !== 'undefined' ? window : globalThis);
