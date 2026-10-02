# Provjera parametara zavarivanja – demo

Prototip web-aplikacije za diplomski rad: procjena rizika od grešaka i zaostalih naprezanja u zavarenom spoju na temelju stvarnih uvjeta na radnom mjestu i parametara zavarivanja, uz prijedlog korekcije parametara.

Stranica: https://ea11599.github.io/zavar-demo/

## Što računa

- unos topline i vrijeme hlađenja t8/5 prema EN 1011-2 (2D/3D odvođenje)
- ekvivalente ugljika CE (IIW) i CET te potrebno predgrijavanje prema EN 1011-2, metoda B (uz razred vodika HD)
- najveću tvrdoću ZUT-a (model Yurioke i sur.) s granicom iz EN ISO 15614-1
- rosište (Magnusova formula) i rizik od kondenzacije
- temperaturno polje pomičnog izvora i toplinski ciklus (Rosenthalovo rješenje, animirano)
- modele zaostalih naprezanja: uzdužno (Masubuchi i Martin, Okerblom) i poprečno duž zavara, uz uvoz rezultata iz CalculiX-a (CSV)
- čitanje certifikata materijala (EN 10204 3.1) iz PDF-a ili fotografije: sastav, CEV, oznaka čelika, talina, ReH
- procesni prozor: kartu rizika u ravnini struja–brzina
- indeks rizika i preporuku parametara unutar ±25 % unosa topline
- dnevnik zavara s unosom izmjerenih rezultata, izvozom i uvozom CSV-a

Indeks rizika i raspodjela naprezanja su pojednostavljeni modeli za prikaz ideje; u sljedećim fazama zamjenjuju ih MKE simulacije (CalculiX) i model treniran na eksperimentalnim podacima.

## Datoteke

| Datoteka | Sadržaj |
|---|---|
| `index.html` | struktura stranice i napomene |
| `style.css` | izgled |
| `physics.js` | svi izračuni, bez ovisnosti o sučelju |
| `app.js` | sučelje, grafikoni, animacija, dnevnik, certifikat |
| `cert.js` | prepoznavanje sastava i CEV-a u certifikatu |
| `primjer-certifikata.pdf` | izmišljeni certifikat za isprobavanje |
| `tests/physics.test.js` | automatski testovi izračuna |
| `tests/cert.test.js` | automatski testovi čitanja certifikata |

## Pokretanje i testovi

Stranica radi bez instalacije: otvori `index.html` u pregledniku (sve datoteke moraju biti u istoj mapi).

Testovi izračuna (potreban Node.js 18 ili noviji):

```
node --test tests/physics.test.js tests/cert.test.js
```

Testovi provjeravaju, između ostalog, da se Rosenthalovo rješenje poklapa s izrazima za t8/5 iz EN 1011-2.
