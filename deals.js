// Rechenkern von Dealbuch: Beträge, Status, Fristen, Summen, Exklusivität,
// Sicherung und Exporte (Tabelle, Kalender, Nebenbei). Läuft im Browser
// (window.Deals) und in Node (require) für test.mjs. Beträge in Cent.
(function (wurzel) {
  "use strict";

  var STATUS = [
    ["anfrage", "Anfrage"], ["verhandlung", "Verhandlung"], ["zugesagt", "Zugesagt"],
    ["produktion", "In Produktion"], ["online", "Online"], ["rechnung", "Rechnung gestellt"],
    ["bezahlt", "Bezahlt"], ["abgesagt", "Abgesagt"]
  ];
  var STATUS_NAME = {};
  STATUS.forEach(function (s) { STATUS_NAME[s[0]] = s[1]; });
  var FRISTEN = [["fristEntwurf", "Entwurf fällig"], ["fristOnline", "Veröffentlichung"], ["fristZahlung", "Zahlung fällig"]];
  // Welche Frist zählt in welchem Status noch (danach ist sie erledigt).
  var FRIST_OFFEN = {
    fristEntwurf: ["anfrage", "verhandlung", "zugesagt", "produktion"],
    fristOnline: ["anfrage", "verhandlung", "zugesagt", "produktion"],
    fristZahlung: ["anfrage", "verhandlung", "zugesagt", "produktion", "online", "rechnung"]
  };

  function datumOk(t) {
    if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(t))) return false;
    return new Date(t + "T12:00:00Z").toISOString().slice(0, 10) === t;
  }

  // "12,50", "1.234,56", "1.234", "500" werden zu Cent; leer ergibt 0, Unsinn null.
  function parseBetrag(text) {
    var s = String(text == null ? "" : text).replace(/[\s€\u00a0]/g, "");
    if (!s) return 0;
    if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
    else {
      var teile = s.split(".");
      if (!(teile.length === 2 && teile[1].length <= 2)) s = teile.join("");
    }
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    var cent = Math.round(parseFloat(s) * 100);
    return cent <= 10000000000 ? cent : null;
  }

  function euro(cent) {
    var abs = Math.abs(Math.round(cent));
    var ganz = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    var rest = String(abs % 100);
    if (rest.length < 2) rest = "0" + rest;
    return (cent < 0 ? "−" : "") + ganz + "," + rest + " €";
  }

  function tageBis(datum, heute) {
    return Math.round((Date.parse(datum + "T12:00:00Z") - Date.parse(heute + "T12:00:00Z")) / 86400000);
  }

  function naechsterStatus(status) {
    var reihe = ["anfrage", "verhandlung", "zugesagt", "produktion", "online", "rechnung", "bezahlt"];
    var i = reihe.indexOf(status);
    return i >= 0 && i < reihe.length - 1 ? reihe[i + 1] : null;
  }

  // Bringt einen Deal aus Formular oder Sicherung in sichere Form; null, wenn unbrauchbar.
  function saeubern(d) {
    if (!d || typeof d !== "object") return null;
    var marke = String(d.marke || "").trim().slice(0, 60);
    if (!marke || !STATUS_NAME[d.status]) return null;
    function text(k, n) { return String(d[k] == null ? "" : d[k]).trim().slice(0, n); }
    function geld(k) { var v = d[k]; return Number.isInteger(v) && v >= 0 && v <= 10000000000 ? v : 0; }
    function tag(k) { return datumOk(d[k]) ? d[k] : ""; }
    var id = /^[a-z0-9]{6,40}$/.test(String(d.id || "")) ? String(d.id) : null;
    if (!id) return null;
    return {
      // t höchstens bis zur Grenze des Date-Bereichs, sonst stürzt summen() ab.
      id: id, t: Number.isFinite(d.t) && Math.abs(d.t) <= 8.64e15 ? d.t : 0, marke: marke, status: d.status,
      plattform: text("plattform", 60), leistung: text("leistung", 120),
      honorar: geld("honorar"), sachwert: geld("sachwert"),
      fristEntwurf: tag("fristEntwurf"), fristOnline: tag("fristOnline"), fristZahlung: tag("fristZahlung"),
      bezahltAm: tag("bezahltAm"), branche: text("branche", 40), exklusivBis: tag("exklusivBis"),
      rechteBis: tag("rechteBis"), werbung: d.werbung === true, kontakt: text("kontakt", 120), notiz: text("notiz", 500)
    };
  }

  // Alle offenen Fristen, nach Datum sortiert, mit Tagen bis dahin (negativ = überfällig).
  function anstehend(deals, heute) {
    var liste = [];
    deals.forEach(function (d) {
      FRISTEN.forEach(function (f) {
        var datum = d[f[0]];
        if (datum && FRIST_OFFEN[f[0]].indexOf(d.status) >= 0) {
          liste.push({ id: d.id, marke: d.marke, feld: f[0], art: f[1], datum: datum, tage: tageBis(datum, heute) });
        }
      });
    });
    return liste.sort(function (a, b) { return a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0; });
  }

  // Geld im Überblick: offene Rechnungen, zugesagt und noch nicht abgerechnet, im Jahr bezahlt.
  function summen(deals, jahr) {
    var s = { offen: 0, zugesagt: 0, bezahlt: 0, sachwert: 0, anzahlBezahlt: 0 };
    var p = String(jahr) + "-";
    deals.forEach(function (d) {
      if (d.status === "rechnung") s.offen += d.honorar;
      else if (["zugesagt", "produktion", "online"].indexOf(d.status) >= 0) s.zugesagt += d.honorar;
      else if (d.status === "bezahlt" && d.bezahltAm.indexOf(p) === 0) { s.bezahlt += d.honorar; s.anzahlBezahlt++; }
      // Sachwert (Produkte zum Behalten) zählt, sobald der Beitrag online ist: im Jahr der
      // Bezahlung, sonst im Jahr der Veröffentlichung.
      // Ohne beides zählt der Tag der letzten Änderung, sonst fiele der Wert aus jedem Jahr heraus.
      var sDatum = d.bezahltAm || d.fristOnline || (d.t ? new Date(d.t).toISOString().slice(0, 10) : "");
      if (d.sachwert && ["online", "rechnung", "bezahlt"].indexOf(d.status) >= 0 && sDatum.indexOf(p) === 0) s.sachwert += d.sachwert;
    });
    return s;
  }

  // Laufende Exklusivitäten anderer Deals in derselben Branche (ohne Groß/Klein und Leerzeichen).
  function exklusivKonflikte(deals, deal, heute) {
    var b = (deal.branche || "").trim().toLowerCase();
    if (!b) return [];
    return deals.filter(function (x) {
      return x.id !== deal.id && x.status !== "abgesagt" && x.exklusivBis && x.exklusivBis >= heute &&
        (x.branche || "").trim().toLowerCase() === b && x.marke.toLowerCase() !== deal.marke.toLowerCase();
    });
  }

  // Sicherung einspielen: gleiche id gewinnt die neuere Fassung (t), neue kommen dazu.
  function zusammenfuehren(vorhanden, neue) {
    var nachId = {}, dazu = 0, aktualisiert = 0;
    vorhanden.forEach(function (d) { nachId[d.id] = d; });
    neue.forEach(function (d) {
      var alt = nachId[d.id];
      if (!alt) { nachId[d.id] = d; dazu++; }
      else if (d.t > alt.t) { nachId[d.id] = d; aktualisiert++; }
    });
    var liste = Object.keys(nachId).map(function (k) { return nachId[k]; });
    return { liste: liste, dazu: dazu, aktualisiert: aktualisiert };
  }

  function sicherungLesen(text) {
    var d;
    try { d = JSON.parse(String(text || "")); } catch (e) { return null; }
    if (!d || d.app !== "dealbuch" || !Array.isArray(d.deals)) return null;
    var gut = [], kaputt = 0;
    d.deals.forEach(function (x) { var s = saeubern(x); if (s) gut.push(s); else kaputt++; });
    return { deals: gut, kaputt: kaputt };
  }

  function sicherung(deals) {
    return JSON.stringify({ app: "dealbuch", v: 1, deals: deals }, null, 1);
  }

  function csvFeld(t) {
    var s = String(t == null ? "" : t);
    if (/^'*[=+\-@]/.test(s)) s = "'" + s;
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function kommaBetrag(cent) { return (cent / 100).toFixed(2).replace(".", ","); }

  // Übersicht für Tabellenprogramme und Steuerberatung.
  function tabelle(deals) {
    var z = ["Marke;Status;Plattform;Leistung;Honorar;Sachwert;Entwurf fällig;Veröffentlichung;Zahlung fällig;Bezahlt am;Branche;Exklusiv bis;Rechte bis;Werbung gekennzeichnet;Kontakt;Notiz"];
    deals.forEach(function (d) {
      z.push([csvFeld(d.marke), STATUS_NAME[d.status], csvFeld(d.plattform), csvFeld(d.leistung), kommaBetrag(d.honorar),
        kommaBetrag(d.sachwert), d.fristEntwurf, d.fristOnline, d.fristZahlung, d.bezahltAm, csvFeld(d.branche),
        d.exklusivBis, d.rechteBis, d.werbung ? "ja" : "nein", csvFeld(d.kontakt), csvFeld(d.notiz)].join(";"));
    });
    return "\ufeff" + z.join("\r\n") + "\r\n";
  }

  // Bezahlte Deals im Format, das Nebenbei unter "Sicherung einspielen" liest.
  function fuerNebenbei(deals) {
    var z = ["Datum;Art;Betrag;Quelle;Notiz"];
    deals.filter(function (d) { return d.status === "bezahlt" && d.bezahltAm; }).forEach(function (d) {
      if (d.honorar) z.push([d.bezahltAm, "Einnahme", kommaBetrag(d.honorar), csvFeld(d.marke.slice(0, 40)), csvFeld(d.leistung.slice(0, 80))].join(";"));
      if (d.sachwert) z.push([d.bezahltAm, "Einnahme", kommaBetrag(d.sachwert), csvFeld(d.marke.slice(0, 40)), "Sachwert"].join(";"));
    });
    return "\ufeff" + z.join("\r\n") + "\r\n";
  }

  // Kalender (iCalendar, RFC 5545): ganztägige Termine je offener Frist.
  function kalender(deals, jetzt) {
    function esc(t) { return String(t).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
    function falten(zeile) {
      // Zeilen höchstens 75 Bytes, Fortsetzung beginnt mit einem Leerzeichen.
      // Über ganze Zeichen laufen (Array.from), damit Emojis nicht zerteilt werden.
      var out = [], teil = "", bytes = 0;
      Array.from(zeile).forEach(function (c) {
        var b = unescape(encodeURIComponent(c)).length;
        if (bytes + b > (out.length ? 74 : 75)) { out.push(teil); teil = ""; bytes = 0; }
        teil += c; bytes += b;
      });
      out.push(teil);
      return out.join("\r\n ");
    }
    function tag(d) { return d.replace(/-/g, ""); }
    function folgetag(d) { return new Date(Date.parse(d + "T12:00:00Z") + 86400000).toISOString().slice(0, 10).replace(/-/g, ""); }
    var stempel = jetzt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    var z = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//klickmill//Dealbuch//DE", "CALSCALE:GREGORIAN"];
    anstehend(deals, "0000-01-01").forEach(function (f) {
      z.push("BEGIN:VEVENT", "UID:" + f.id + "-" + f.feld + "@dealbuch.klickmill.app",
        "DTSTAMP:" + stempel, "DTSTART;VALUE=DATE:" + tag(f.datum), "DTEND;VALUE=DATE:" + folgetag(f.datum),
        falten("SUMMARY:" + esc(f.art + ": " + f.marke)), "END:VEVENT");
    });
    z.push("END:VCALENDAR");
    return z.join("\r\n") + "\r\n";
  }

  var api = { STATUS: STATUS, STATUS_NAME: STATUS_NAME, datumOk: datumOk, parseBetrag: parseBetrag, euro: euro,
    tageBis: tageBis, naechsterStatus: naechsterStatus, saeubern: saeubern, anstehend: anstehend, summen: summen,
    exklusivKonflikte: exklusivKonflikte, zusammenfuehren: zusammenfuehren, sicherung: sicherung,
    sicherungLesen: sicherungLesen, tabelle: tabelle, fuerNebenbei: fuerNebenbei, kalender: kalender };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else wurzel.Deals = api;
})(this);
