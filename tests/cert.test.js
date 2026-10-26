// Pokretanje: node --test tests/cert.test.js
const test = require('node:test');
const assert = require('node:assert');
const Cert = require('../cert.js');

// Pomoćna funkcija: tablica kao riječi s položajem, kao da dolaze iz PDF-a ili OCR-a
function table(lines, x0 = 50, dx = 40, y0 = 100, dy = 14) {
  const tokens = [];
  lines.forEach((cells, r) => cells.forEach((t, c) => {
    if (t !== '') tokens.push({ t, x: x0 + c * dx, y: y0 + r * dy, w: 6 * t.length, h: 10, page: 1 });
  }));
  return tokens;
}

test('decimalni zarez, CEV stupac', () => {
  const r = Cert.parse(table([
    ['', 'C', 'Si', 'Mn', 'P', 'S', 'Cr', 'Ni', 'Cu', 'CEV'],
    ['Ladle', '0,16', '0,24', '1,42', '0,012', '0,006', '0,04', '0,05', '0,12', '0,42']
  ]));
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.rows[0].values.Mn, 1.42);
  assert.strictEqual(r.cev, 0.42);
});

test('zapis ×100 / ×1000', () => {
  const toks = table([
    ['', 'C', 'Si', 'Mn', 'P', 'S', 'Nb'],
    ['Heat', '12', '35', '155', '12', '4', '28']
  ]);
  toks.push({ t: 'Gehalte in % x 100 / x 1000', x: 50, y: 86, w: 160, h: 10, page: 1 });
  const v = Cert.parse(toks).rows[0].values;
  assert.strictEqual(v.C, 0.12); assert.strictEqual(v.Mn, 1.55);
  assert.strictEqual(v.P, 0.012); assert.strictEqual(v.S, 0.004); assert.strictEqual(v.Nb, 0.028);
});

test('CEV iz teksta, oznaka, talina i ReH', () => {
  const toks = table([
    ['', 'C', 'Mn', 'Si', 'Cr', 'Mo'],
    ['', '0.15', '1.21', '0.29', '0.31', '0.29'],
    ['', '', '', '', '', ''],
    ['', 'ReH', 'Rm', 'A'],
    ['', '742', '812', '17']
  ]);
  toks.push({ t: 'Grade: S690QL Heat number: B90215 CEV = 0,51', x: 50, y: 40, w: 300, h: 10, page: 1 });
  const r = Cert.parse(toks);
  assert.strictEqual(r.grade, 'S690QL'); assert.strictEqual(r.heat, 'B90215');
  assert.strictEqual(r.cev, 0.51); assert.strictEqual(r.ReH, 742);
  assert.strictEqual(Cert.presetFor(r.grade), 'S690QL');
});

test('dva retka analize (talina i proizvod)', () => {
  const r = Cert.parse(table([
    ['', 'C', 'Si', 'Mn', 'P', 'S'],
    ['Talina', '0,16', '0,24', '1,42', '0,012', '0,006'],
    ['Proizvod', '0,17', '0,25', '1,44', '0,013', '0,005']
  ]));
  assert.deepStrictEqual(r.rows.map(x => x.label), ['Talina', 'Proizvod']);
  assert.strictEqual(r.rows[1].values.C, 0.17);
});

test('bez tablice: upozorenje, bez rezultata', () => {
  const r = Cert.parse([{ t: 'Neki tekst bez tablice', x: 10, y: 10, w: 100, h: 10, page: 1 }]);
  assert.strictEqual(r.rows.length, 0); assert.ok(r.warnings.length);
});

test('tipične OCR pogreške u zaglavlju i oznaci čelika', () => {
  const toks = table([
    ['', 'Cc', 'si', 'Mn', 'P', 'Ss', 'Vv', '§86CEV'],
    ['Ladle', '0.16', '0,24', '1,42', '0,012', '0,006', '0,003', '0,42']
  ]);
  toks.push({ t: 'Steel grade: $355J2+N', x: 50, y: 40, w: 140, h: 10, page: 1 });
  const r = Cert.parse(toks);
  assert.strictEqual(r.rows[0].values.C, 0.16); assert.strictEqual(r.rows[0].values.S, 0.006);
  assert.strictEqual(r.rows[0].values.V, 0.003); assert.strictEqual(r.cev, 0.42);
  assert.strictEqual(r.grade, 'S355J2+N');
});

test('retci s granicama (Min/Max) nisu analiza', () => {
  const r = Cert.parse(table([
    ['', 'C%', 'S%', 'P%', 'Si%', 'Mn%', 'B%'],
    ['Max.', '0.40', '0.025', '0.025', '0.30', '1.00', '.003'],
    ['M14x70', '0.346', '0.007', '0.018', '0.226', '0.748', '0.0022']
  ]));
  assert.deepStrictEqual(r.rows.map(x => x.label), ['M14x70']);
  assert.strictEqual(r.rows[0].values.Mn, 0.748);
});

test('čitanje po ćelijama: normalizacija i glasanje', () => {
  assert.strictEqual(Cert.normCellNum('0007').s, '0.007');
  assert.strictEqual(Cert.normCellNum(',25').s, '0.25');
  assert.strictEqual(Cert.normCellNum('<0,005').lt, true);
  assert.strictEqual(Cert.normCellNum('0.4.5'), null);
  const v = Cert.voteNumbers(['001', '0018', '0018']);           // otpala zadnja znamenka
  assert.strictEqual(v.value, 0.018); assert.strictEqual(v.agree, 2);
  assert.deepStrictEqual(['C%', 'PA', 'Si%', 'Mn%', 'Br%', 'Description'].map(Cert.symFromCell), ['C', 'P', 'Si', 'Mn', 'B', null]);
  assert.strictEqual(Cert.voteSymbols(['Mn%', 'BMr%', 'Birt']), 'Mn');
});

test('dva bloka sastava bez crta tablice, talina po položaju', () => {
  const toks = table([
    ['Quantity kg', 'MO number', 'Heat Number'],
    ['1358,0', '1289794', '6024638E']
  ], 50, 120, 40, 14);
  toks.push(...table([
    ['6024638E', 'C', 'Si', 'Mn', 'P', 'S'],
    ['', '6,21', '0,24', '1,48', '0,', '0,006'],
    ['', 'Cr', 'Ni', 'Mo', 'Cu', 'V'],
    ['', '0,24', '0,02', '0,03', '0,02', '0,11']
  ], 50, 60, 120, 16));
  toks.push({ t: '017', x: 50 + 4 * 60 + 14, y: 136, w: 18, h: 10, page: 1 });   // "0," + "017" razlomljeno
  const r = Cert.parse(toks);
  assert.strictEqual(r.rows.length, 1);
  const v = r.rows[0].values;
  assert.strictEqual(v.C, 0.21); assert.ok(r.rows[0].flags.C);                    // 6,21 -> 0,21 i označeno
  assert.strictEqual(v.P, 0.017); assert.strictEqual(v.Mo, 0.03); assert.strictEqual(v.V, 0.11);
  assert.strictEqual(r.rows[0].label, '6024638E');
  assert.strictEqual(r.heat, '6024638E');
});

test('poznate OCR zamjene simbola uz znak %', () => {
  const r = Cert.parse(table([
    ['', 'C', '%', 'Si', '%', 'fin', '%', 'P', '%'],
    ['', '0,21', '', '0,24', '', '1,48', '', '0,017', '']
  ], 50, 30));
  assert.strictEqual(r.rows[0].values.Mn, 1.48);
});

test('stvarno očitanje Tesseract.js-om (certifikat Ovako): iskrivljeni simboli i znamenke', () => {
  // riječi kako ih Tesseract.js 5.1.1 vraća za sliku certifikata; "C %" je pročitano kao "[o", 0,24 kao "C,24"
  const d = require('./podaci/ovako-tesseractjs.json')[0].map(a => ({ t: a[0], x: a[1], y: a[2], w: a[3], h: a[4], page: 1 }));
  const r = Cert.parse(d);
  assert.strictEqual(r.rows.length, 1);
  assert.deepStrictEqual(r.rows[0].values, { C: 0.21, Si: 0.24, Mn: 1.48, P: 0.017, S: 0.006, Cr: 0.24, Ni: 0.02, Mo: 0.03, Cu: 0.02, V: 0.11 });
  assert.ok(r.rows[0].flags.C, 'pretpostavljeni C mora biti označen');
  assert.strictEqual(r.heat, '6024638E');
});
