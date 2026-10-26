// Prüft den Rechenkern: node test.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const D = req("./deals.js");

assert.equal(D.parseBetrag("1.500"), 150000);
assert.equal(D.parseBetrag("250,50"), 25050);
assert.equal(D.parseBetrag(""), 0);
assert.equal(D.parseBetrag("abc"), null);
assert.equal(D.euro(150000), "1.500,00 €");
assert.equal(D.naechsterStatus("anfrage"), "verhandlung");
assert.equal(D.naechsterStatus("rechnung"), "bezahlt");
assert.equal(D.naechsterStatus("bezahlt"), null);
assert.equal(D.naechsterStatus("abgesagt"), null);
assert.equal(D.tageBis("2026-10-01", "2026-09-29"), 2);
assert.equal(D.tageBis("2026-03-30", "2026-03-28"), 2); // Zeitumstellung
assert.equal(D.tageBis("2026-09-27", "2026-09-29"), -2);

const basis = { id: "abc123", t: 1, marke: "Hautwerk", status: "produktion", plattform: "Instagram", leistung: "1 Reel",
  honorar: 150000, sachwert: 8000, fristEntwurf: "2026-10-01", fristOnline: "2026-10-05", fristZahlung: "2026-11-05",
  bezahltAm: "", branche: "Kosmetik", exklusivBis: "2026-12-31", rechteBis: "", werbung: false, kontakt: "", notiz: "" };
assert.deepEqual(D.saeubern(basis), basis);
assert.equal(D.saeubern({ ...basis, marke: "  " }), null);
assert.equal(D.saeubern({ ...basis, status: "quatsch" }), null);
assert.equal(D.saeubern({ ...basis, id: "<script>" }), null);
assert.equal(D.saeubern({ ...basis, honorar: -5 }).honorar, 0);
assert.equal(D.saeubern({ ...basis, fristOnline: "2026-02-30" }).fristOnline, "");

// Fristen: in Produktion zählen alle drei; online nur noch die Zahlung.
const f1 = D.anstehend([basis], "2026-10-03");
assert.deepEqual(f1.map((f) => [f.art, f.tage]), [["Entwurf fällig", -2], ["Veröffentlichung", 2], ["Zahlung fällig", 33]]);
assert.deepEqual(D.anstehend([{ ...basis, status: "online" }], "2026-10-03").map((f) => f.art), ["Zahlung fällig"]);
assert.equal(D.anstehend([{ ...basis, status: "bezahlt" }], "2026-10-03").length, 0);

// Summen
const deals = [
  basis,
  { ...basis, id: "def456", status: "rechnung", honorar: 40000, sachwert: 0 },
  { ...basis, id: "ghi789", status: "bezahlt", bezahltAm: "2026-02-10", honorar: 90000, sachwert: 12000 },
  { ...basis, id: "jkl012", status: "bezahlt", bezahltAm: "2025-12-30", honorar: 70000 },
  { ...basis, id: "mno345", status: "abgesagt", honorar: 99900 },
];
const s = D.summen(deals, 2026);
assert.equal(s.offen, 40000);
assert.equal(s.zugesagt, 150000);
assert.equal(s.bezahlt, 90000);
assert.equal(s.anzahlBezahlt, 1);
assert.equal(s.sachwert, 12000);

// Exklusivität: andere Marke, gleiche Branche, noch laufend
const neu = { ...basis, id: "neu999", marke: "Glanzstück", branche: " kosmetik " };
assert.deepEqual(D.exklusivKonflikte(deals, neu, "2026-10-01").map((d) => d.id), ["abc123", "def456", "ghi789", "jkl012"]);
assert.equal(D.exklusivKonflikte(deals, neu, "2027-01-01").length, 0);
assert.equal(D.exklusivKonflikte(deals, { ...neu, marke: "hautwerk" }, "2026-10-01").length, 0);

// Sicherung hin und zurück, Zusammenführen nach id und Zeitstempel
const zurueck = D.sicherungLesen(D.sicherung(deals));
assert.equal(zurueck.kaputt, 0);
assert.deepEqual(zurueck.deals, deals);
assert.equal(D.sicherungLesen("{}"), null);
assert.equal(D.sicherungLesen("kein json"), null);
assert.equal(D.sicherungLesen(JSON.stringify({ app: "dealbuch", deals: [{ id: "x" }] })).kaputt, 1);
const m = D.zusammenfuehren(deals.slice(0, 2), [{ ...basis, t: 5, notiz: "neuer" }, { ...basis, id: "zzz999" }, { ...deals[1], t: 0 }]);
assert.equal(m.dazu, 1);
assert.equal(m.aktualisiert, 1);
assert.equal(m.liste.find((d) => d.id === "abc123").notiz, "neuer");

// Tabelle: Formel-Schutz und Anführungszeichen
const t = D.tabelle([{ ...basis, marke: "=HACK()", notiz: 'a;"b"' }]);
assert.ok(t.startsWith("﻿Marke;Status;"));
assert.ok(t.includes("'=HACK();In Produktion;"));
assert.ok(t.includes('"a;""b"""'));

// Nebenbei-Export lässt sich von Nebenbei selbst einlesen (App-übergreifend)
const N = req("../nebenbei/rechnen.js");
const nb = N.csvLesen(D.fuerNebenbei(deals));
assert.equal(nb.kaputt, 0);
assert.deepEqual(nb.eintraege.map((e) => [e.datum, e.typ, e.betrag, e.quelle, e.notiz]).sort(), [
  ["2025-12-30", "ein", 70000, "Hautwerk", "1 Reel"],
  ["2025-12-30", "ein", 8000, "Hautwerk", "Sachwert"],
  ["2026-02-10", "ein", 12000, "Hautwerk", "Sachwert"],
  ["2026-02-10", "ein", 90000, "Hautwerk", "1 Reel"],
].sort());

// Kalender: gültiger Rahmen, ganztägig, keine Zeile über 75 Bytes, eindeutige UIDs
const ics = D.kalender([basis, { ...basis, id: "lang01", marke: "Ä".repeat(60) }], new Date("2026-09-29T10:00:00Z"));
assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
assert.ok(ics.includes("DTSTART;VALUE=DATE:20261001\r\nDTEND;VALUE=DATE:20261002"));
for (const zeile of ics.split("\r\n")) assert.ok(Buffer.byteLength(zeile) <= 75, zeile);
const uids = ics.split("\r\n").filter((z) => z.startsWith("UID:"));
assert.equal(new Set(uids).size, uids.length);
assert.equal(uids.length, 6);
assert.ok(D.kalender([{ ...basis, marke: "A,B;C" }], new Date()).includes("SUMMARY:Entwurf fällig: A\\,B\\;C"));

// Emojis: kein Absturz, keine Zeile über 75 Bytes, Faltung lässt sich rückgängig machen.
const feuer = D.kalender([{ ...basis, marke: "🔥".repeat(40) }], new Date("2026-09-29T10:00:00Z"));
for (const zeile of feuer.split("\r\n")) assert.ok(Buffer.byteLength(zeile) <= 75, zeile);
assert.ok(feuer.replace(/\r\n /g, "").includes("SUMMARY:Entwurf fällig: " + "🔥".repeat(40)));

// Produktwert ohne Veröffentlichungsdatum zählt im Jahr der letzten Änderung.
const ohne = { ...basis, status: "online", fristOnline: "", sachwert: 500, t: Date.parse("2026-05-01T10:00:00Z") };
assert.equal(D.summen([ohne], 2026).sachwert, 500);
assert.equal(D.summen([ohne], 2025).sachwert, 0);

// Absurder Zeitstempel aus einer fremden Sicherung darf die Übersicht nicht abstürzen lassen.
const wild = D.saeubern({ ...basis, t: 1e17, fristOnline: "", bezahltAm: "", status: "online" });
assert.equal(wild.t, 0);
assert.doesNotThrow(() => D.summen([wild], 2026));

// Branche gleich, auch anders getippt (1.4); verschiedene Wörter bleiben verschieden.
assert.equal(D.brancheSchluessel("  Haut-Pflege "), D.brancheSchluessel("haut pflege"));
assert.equal(D.brancheSchluessel("Getränke"), D.brancheSchluessel("Getraenke"));
assert.equal(D.brancheSchluessel("Getra\u0308nke"), D.brancheSchluessel("Getränke"), "zerlegtes ä (NFD) gleich");
assert.equal(D.brancheSchluessel("Fußball"), D.brancheSchluessel("FUSSBALL"));
assert.notEqual(D.brancheSchluessel("Kosmetik"), D.brancheSchluessel("Beauty"));
assert.equal(D.brancheSchluessel("Möbel/Öl_Ü."), D.brancheSchluessel("moebeloelue"));
assert.equal(D.brancheSchluessel("Haut\u2013Pflege"), D.brancheSchluessel("Hautpflege"), "langer Strich wie Bindestrich");
assert.equal(D.brancheSchluessel(""), "");
assert.equal(D.brancheSchluessel(undefined), "");
const exA = D.saeubern({ ...basis, id: "exk001", marke: "Firma A", branche: "Haut-Pflege", exklusivBis: "2026-12-31", status: "zugesagt" });
const exNeu = { ...basis, id: "exk002", marke: "Firma B", branche: "hautpflege" };
assert.equal(D.exklusivKonflikte([exA], exNeu, "2026-10-26").length, 1, "Haut-Pflege gleich hautpflege");
assert.equal(D.exklusivKonflikte([exA], { ...exNeu, branche: "haut pflege" }, "2026-10-26").length, 1);
assert.equal(D.exklusivKonflikte([exA], { ...exNeu, branche: "Kosmetik" }, "2026-10-26").length, 0);
assert.equal(D.exklusivKonflikte([{ ...exA, branche: "" }], { ...exNeu, branche: "---" }, "2026-10-26").length, 0, "nur Trennzeichen löst nichts aus");
assert.equal(D.exklusivKonflikte([{ ...exA, branche: "---" }], { ...exNeu, branche: "Kosmetik" }, "2026-10-26").length, 0);

console.log("deals.js: alle Prüfungen bestanden");
