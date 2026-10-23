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
- dnevnik zavara s unosom izmjerenih rezultata, izvozom i uvozom CSV-a; u Claude artefaktu dnevnik je zajednički
- učitavanje izmjerenog (termopar) ili simuliranog toplinskog ciklusa i kalibraciju toplinske iskoristivosti k
- učenje korekcija t8/5 i tvrdoće ZUT-a iz dnevnika, s unakrsnom validacijom "izostavi jedan"
- učenje težina indeksa rizika iz nalaza ispitivanja upisanih u dnevnik (najveća vjerodostojnost uz sidro na stručnoj procjeni, provjera Brierovom ocjenom)
- hibridni surogatni model zaostalih naprezanja: analitički model + Gaussova procesna regresija naučena na 36 proračuna u CalculiX-u, s 95 % intervalom i upozorenjem izvan raspona
- vođeni primjer ("Prikaži primjer") koji učitava stvarni proračun iz CalculiX-a i primjere u dnevniku
- popis izvora za sve izraze i tablicu pretpostavki koje tek treba potvrditi
- generator ulaznih datoteka za CalculiX (toplinska i mehanička analiza sučeljenog spoja, Goldakov izvor, svojstva čelika prema EN 1993-1-2) i Python skriptu koja rezultate izdvaja u CSV za uvoz u aplikaciju

Početne težine indeksa rizika i amplitude poprečnih naprezanja su pretpostavke (popisane na stranici u dijelu "Izvori i pretpostavke"); zamjenjuju ih podaci iz pokusa i MKE simulacija.

## Datoteke

| Datoteka | Sadržaj |
|---|---|
| `index.html` | struktura stranice i napomene |
| `style.css` | izgled |
| `physics.js` | svi izračuni, bez ovisnosti o sučelju |
| `app.js` | sučelje, grafikoni, animacija, dnevnik, certifikat |
| `cert.js` | prepoznavanje sastava i CEV-a u certifikatu |
| `surrogate.js` | Gaussova procesna regresija i hibridni surogatni model |
| `surogat-podaci.js` | rezultati 36 proračuna u CalculiX-u i naučeni hiperparametri |
| `calculix.js` | generator ulaznih datoteka za CalculiX i skripta za rezultate |
| `primjer-certifikata.pdf` | izmišljeni certifikat za isprobavanje |
| `primjer-calculix/` | rezultati stvarnog proračuna u CalculiX-u za vođeni primjer (S355J2, 12 mm, B = 120 mm, L = 200 mm, srednja mreža) |
| `tests/physics.test.js` | automatski testovi izračuna |
| `tests/cert.test.js` | automatski testovi čitanja certifikata |
| `tests/calculix.test.js` | automatski testovi generatora za CalculiX |
| `tests/podaci/` | stvarno očitanje certifikata za test |

## Pokretanje i testovi

Stranica radi bez instalacije: otvori `index.html` u pregledniku (sve datoteke moraju biti u istoj mapi).

Testovi izračuna (potreban Node.js 18 ili noviji):

```
node --test tests/physics.test.js tests/cert.test.js tests/calculix.test.js tests/surrogate.test.js
```

Testovi provjeravaju, između ostalog, da se Rosenthalovo rješenje poklapa s izrazima za t8/5 iz EN 1011-2.
