/**
 * German copy, keyed by dot names. English stays in index.html (and in the t() calls),
 * so a missing key just shows the English text; tests/i18n.test.ts keeps the two in sync.
 * Left in English on purpose: names (projects, technologies, "HiWi", "B.Sc. Informatik").
 */
export const DE: Record<string, string> = {
  // page
  'title.light': 'Dipu Balamurugan | Portfolio',
  'title.dark': 'Dipu Balamurugan | Laternenfluss',
  'meta.description':
    'Portfolio von Dipu Balamurugan, B.Sc. Informatik an der Universität des Saarlandes: Projekte, Ausbildung, Kenntnisse und ein spielbares Spiel auf einem nächtlichen Fluss.',

  // skip link, language switch, theme buttons
  'nav.skip': 'Zum Inhalt springen',
  'lang.group': 'Sprache',
  'cta.back': 'Zur Website',
  'cta.play': 'Zum Spiel',

  // light navigation
  'nav.primary': 'Hauptnavigation',
  'nav.brand': 'Dipu Balamurugan, zurück nach oben',
  'nav.projects': 'Projekte',
  'nav.experience': 'Erfahrung',
  'nav.skills': 'Kenntnisse',
  'nav.contact': 'Kontakt',
  'nav.openMenu': 'Menü öffnen',
  'nav.closeMenu': 'Menü schließen',

  // email
  'link.email': 'E-Mail',
  'email.aria': 'E-Mail an Dipu schreiben',

  // section headings
  'sec.education': 'Ausbildung',
  'sec.experience': 'Berufserfahrung',
  'sec.projects': 'Projekte',
  'sec.skills': 'Kenntnisse',
  'sec.languages': 'Sprachen',
  'sec.contact': 'Kontakt',

  // spoken languages
  'lang.en': 'Englisch',
  'lang.de': 'Deutsch',
  'lang.ml': 'Malayalam',
  'lang.hi': 'Hindi',

  // hero
  'hero.chip': 'B.Sc. Informatik · Universität des Saarlandes',
  'hero.title': 'Hey, ich bin Dipu.',
  'hero.sub':
    'Ich studiere Informatik in Saarbrücken und entwickle Software vom Prozessor aufwärts, mit Schwerpunkt auf Sicherheit, Datennetzen und Software Engineering.',
  'hero.cta': 'Projekte ansehen',
  'hero.proof.ects': '130+ ECTS ·',
  'hero.proof.msc': 'Zusage für den M.Sc. ·',
  'hero.proof.hiwi': 'HiWi am MPI für Informatik',
  'hero.scroll': 'Scrollen',
  'hero.scrollAria': 'Zu den Projekten scrollen',
  'tagline.aria': 'In einem Satz',
  'tagline.1': 'Von MIPS-Registern bis zur Multi-Agent-KI',
  'tagline.2': 'baue ich gern den ganzen Stack.',

  // education
  'edu.stack': 'Universität des Saarlandes & Studienkolleg Jena',
  'edu.uds':
    '<strong>B.Sc. Informatik</strong>, Universität des Saarlandes — seit April 2023. Mehr als 130 ECTS, voraussichtlicher Abschluss bis September 2027. Zusage für den M.Sc. Informatik.',
  'edu.kolleg': '<strong>Studienkolleg Jena</strong> (T-Kurs, Note 2,2) — April 2022 bis Januar 2023.',

  // experience
  'exp.stack': 'HiWi, Campus-Bibliothek Informatik + Mathematik (Max-Planck-Institut für Informatik)',
  'exp.1': 'Seit April 2024.',
  'exp.2': 'Technischer Support für Bibliotheksnutzer am Infoschalter.',
  'exp.3': 'Digitalisierung von Materialien mit GIMP.',
  'exp.4': 'Python-Skripte und Plugins geschrieben, die den GIMP-Digitalisierungsworkflow automatisieren.',

  // projects
  'proj.rail.sub': ' — Zonenparallele Eisenbahnsimulation',
  'proj.rail.sum': 'Teamprojekt: eine Eisenbahnsimulation, auf Threads verteilt, ohne Locks und mit derselben Ausgabe wie die sequentielle Referenz.',
  'proj.rail.1':
    'Eine Eisenbahnsimulation in Rust mit einem Thread pro Zone parallelisiert, sodass Regionen des Netzes gleichzeitig simuliert werden.',
  'proj.rail.2':
    'Threads koordinieren sich nur über Nachrichten in Channels: keine Locks, kein geteilter veränderlicher Zustand; jeder Thread besitzt die Daten seiner Zone.',
  'proj.rail.3':
    'Synchronisations- und Shutdown-Protokoll entworfen, sodass die Ergebnisse immer der sequentiellen Version entsprechen; eine KI-gestützte interaktive Visualisierung ergänzt (unten verlinkt).',
  'proj.rail.live': 'Live-Visualisierung',
  'proj.rail.link': 'Concurrency Bahn auf GitHub',

  'proj.orion.sub': ' — Multi-Agent-KI-Plattform',
  'proj.orion.sum': 'Solo-Hackathon-Projekt: 10 KI-Agenten für Unternehmensabläufe.',
  'proj.orion.1':
    'Allein beim MonaAI Hackathon entwickelt: 10 fachspezifische Agenten für Unternehmensabläufe (Dokumentenprüfung, Schichtersatz im Personalwesen, Erkennung gefälschter Lebensläufe, Preisgestaltung).',
  'proj.orion.2':
    'Die Prompts für jeden Agenten auf Gemini 2.5 Flash entworfen, z. B. ein Rechnungsagent, der Rechnungsdaten extrahiert, an die richtige Abteilung weiterleitet und die nächsten Schritte zusammenfasst.',
  'proj.orion.3':
    'Die Pipeline für den Dokumenten-Upload (PDF, DOCX, Bilder) ins Modell gebaut, mit Frontend in Next.js 14 und Tailwind.',
  'proj.orion.link': 'Orion auf GitHub',

  'proj.saardew.sub': ' — Farming-Simulation',
  'proj.saardew.sum': 'Teamprojekt: tickbasierte Farming-Simulation, UML zuerst, getestet und analysiert.',
  'proj.saardew.1': 'Im Softwarepraktikum an der Universität des Saarlandes im Team eine tickbasierte Simulation entwickelt.',
  'proj.saardew.2':
    'Mit dem UML-Entwurf begonnen, die Arbeit nach Modulen aufgeteilt und die Implementierung angepasst, als sich die Anforderungen mitten im Projekt änderten.',
  'proj.saardew.3':
    'Gegenseitige Code-Reviews sowie Unit- und Systemtests, statische Analyse (Detekt) und Testabdeckung (JaCoCo) für die Codequalität eingesetzt.',
  'proj.saardew.link': 'Saardew auf GitHub',

  'proj.2048.sub': ' — 2048 mit CPU-Spieler',
  'proj.2048.sum': 'Testgetriebene Spiellogik und ein heuristischer CPU-Spieler.',
  'proj.2048.1':
    'Zuerst die Tests für die Spiellogik geschrieben, dann implementiert: Zusammenführen der Kacheln, Punktezählung und Spielzustandsverwaltung.',
  'proj.2048.2': 'Die Spiellogik nach objektorientierten Prinzipien strukturiert.',
  'proj.2048.3':
    'Einen CPU-Spieler ergänzt, der seine Züge per heuristischer Bewertung wählt (z. B. möglichst viele freie Felder, höchste Kachel in der Ecke).',
  'proj.2048.link': '2048 auf GitHub',

  'proj.pagerank.sub': ' — PageRank in C',
  'proj.pagerank.sum': 'PageRank mit Random Surfer auf speichereffizienten Graphen.',
  'proj.pagerank.1':
    'Den PageRank-Algorithmus von Google von Grund auf in C implementiert, um graphbasierte Linkstrukturen zu analysieren.',
  'proj.pagerank.2': 'Graphtraversierung, iterative Rangberechnung und Konvergenzprüfungen umgesetzt.',
  'proj.pagerank.3': 'Schwerpunkt auf speichereffizienten Datenstrukturen für größere Graphdatensätze.',
  'proj.pagerank.link': 'PageRank auf GitHub',

  'proj.edge.sub': ' — Kantenerkennung in C',
  'proj.edge.sum': 'Gaußscher Weichzeichner, Gradienten, Betrag, Schwellenwert.',
  'proj.edge.1': 'Verfahren zur Kantenerkennung implementiert, um Objektgrenzen in digitalen Bildern zu finden.',
  'proj.edge.2': 'Pixeldaten von Bildern verarbeitet und Filteroperationen angewendet, um Merkmale zu extrahieren.',
  'proj.edge.3': 'Mit systemnaher Speicherverwaltung und performanceorientiertem C gearbeitet.',
  'proj.edge.link': 'Kantenerkennung auf GitHub',


  'more.title': 'Weitere Projekte',
  'more.mips': ' — ein interaktives Spiel komplett in MIPS-Assembler: Spielzustand, Eingabe, Verzweigungen und Punktezählung.',
  'more.django':
    ' — Django-ORM-Datenbankoperationen, Anbindung einer externen REST-API, HTML/CSS-Frontend (Kursprojekt).',
  'card.details': 'Details',
  'card.hide': 'Details ausblenden',

  // skills
  'skills.also': 'Außerdem:',
  'skills.programming': 'Programmiersprachen',
  'skills.tools': 'Tools',

  // contact and footer
  'contact.title': 'Sprechen wir.',
  'contact.sub': 'Offen für Werkstudentenstellen und Praktika in Deutschland.',
  'contact.emailLabel': 'E-Mail:',
  'footer.text': '© 2026 Dipu Balamurugan · Gebaut mit Vite, PixiJS und ziemlich viel Physik',
  'modal.close': 'Dialog schließen',

  // the game: Lantern River
  'river.title': 'Laternenfluss',
  'river.wip': 'Spiel noch in Entwicklung',
  'river.hint.keys': 'Mit den Pfeiltasten oder WASD paddeln. Laternen anzünden, an einem Steg anlegen und ein Projekt öffnen, und den Krokodilen nicht zu nahe kommen.',
  'river.hint.touch': 'Zum Paddeln ziehen oder aufs Wasser tippen, um dorthin zu fahren. Laternen anzünden, an einem Steg anlegen und ein Projekt öffnen, und den Krokodilen nicht zu nahe kommen.',
  'river.credit': 'Wasser in Rust simuliert, zu WebAssembly kompiliert',
  'btn.start': 'Start',
  'river.error': 'Das Spiel konnte in diesem Browser nicht gestartet werden. Die Website funktioniert auch ohne.',
  'hud.aria': 'Spielstatus',
  'river.hud.score': 'Punkte',
  'river.hud.lanterns': 'Laternen',
  'river.hud.docks': 'Stege',
  'river.hud.moon': 'Der Mond ist die Uhr',
  'river.paused': 'Pause',
  'river.paused.hint': 'Leertaste drücken, um weiterzumachen.',
  'river.resume': 'Weiter',
  'river.over.title': 'Die Nacht ist vorbei',
  'river.over.clear': 'Klare Nacht',
  'river.high': 'Bestwert',
  'river.newHigh': 'Neuer Bestwert',
  'river.again': 'Nochmal spielen',
  'river.say.start': 'Die Nacht beginnt. Laternen anzünden und an den Stegen anlegen.',
  'river.say.lantern': 'Laterne angezündet. {n} von {m}.',
  'river.say.moor': 'Angelegt bei {name}.',
  'river.say.bite': 'Ein Krokodil hat das Boot gebissen. Fünfzehn Sekunden verloren.',
  'river.say.clear': 'Klare Nacht. Alle Stege und Laternen gefunden.',
  'sound.off': 'Ton aus',
  'sound.on': 'Ton an',
  'sound.offAria': 'Ton ist aus. Ton einschalten',
  'sound.onAria': 'Ton ist an. Ton ausschalten',
};
