---
title: "Wie Dienste kategorisiert werden: ein paar gängige Kriterien"
summary: Zwei Anbieter können sich beide "Airport" nennen und trotzdem Welten auseinanderliegen. Diese Kriterien helfen dir, das Wesentliche zu erkennen
order: 2
updated: 2026-07-23
tags: [Kategorisierung, Einführung, Anfänger]
---

## Kriterium eins: selbst betrieben vs. weiterverkauft

**Selbst betriebene Anbieter** kaufen ihre eigenen Server und bauen/pflegen ihre
eigenen Leitungen selbst. Die Informationen sind tendenziell transparenter, und wer
bereit ist, den Leitungstyp (Standleitung / Relay / Direkt) offenzulegen, ist im
Allgemeinen vertrauenswürdiger.

**Weiterverkaufte (White-Label-)Anbieter** kaufen Node-Kapazitäten im Großhandel von
einem vorgelagerten Anbieter und verpacken sie unter ihrer eigenen Marke. Weiterverkauf
allein bedeutet nicht automatisch Unzuverlässigkeit, aber es bedeutet, dass die
tatsächliche Leitungsqualität, die du bekommst, von einer vorgelagerten Partei
abhängt, in die du keinen Einblick hast — gerät dieser vorgelagerte Anbieter in
Schwierigkeiten (Preiserhöhungen, Verschwinden, Abschaltung), verschwindet der
nachgelagerte Wiederverkäufer oft über Nacht, oder der Dienst bricht plötzlich
zusammen. Das verstärkt das Risiko.

## Kriterium zwei: Leitungstyp

Siehe die Erklärungen zu "Direkt / Relay / Standleitung" im [Glossar](./glossary) —
dies ist das Kriterium, das deine tägliche Erfahrung am direktesten beeinflusst. Grobe
Reihenfolge (nur zur Orientierung; die tatsächliche Performance hängt stark davon ab,
wie gut der jeweilige Anbieter alles betreibt):

Standleitung (IPLC/IEPL) > Multi-Line-Relay (BGP) > gewöhnliches Relay über
öffentliches Netz > reine Direktverbindung

Weiter oben in dieser Liste ist im Allgemeinen stabiler und teurer; weiter unten
im Allgemeinen günstiger und anfälliger für Stoßzeiten und Leitungsschwankungen.

## Kriterium drei: Abrechnungsmodell

- **Fester Monats-/Jahresplan**: ein festgelegtes Datenkontingent pro Monat, gedrosselt
  oder unbrauchbar nach Überschreitung; die Preisgestaltung ist relativ vorhersehbar.
- **Pay-as-you-go**: du zahlst, was du verbrauchst — flexibel, kann aber gegen Monatsende
  zu "Datenangst" führen.
- **Multiplikator-basiert**: unterschiedliche Nodes verbrauchen Daten unterschiedlich
  schnell (siehe "Verbrauchsmultiplikator" im Glossar); wird oft mit den beiden
  obigen Modellen kombiniert, um die realen Kostenunterschiede zwischen Leitungen
  auszugleichen.

## Kriterium vier: Einsatzzweck

Verschiedene Anbieter betonen unterschiedliche Dinge — vergleiche das mit deinem
eigenen Hauptbedarf:

- **Streaming-Entsperrung im Fokus**: bewirbt meist "Netflix/Disney+-Entsperrung
  unterstützt"; die Node-Anzahl kann bescheiden sein, ist aber gezielt für bestimmte
  Streaming-Dienste optimiert.
- **Gaming-fokussiert**: betont niedrige Latenz und UDP-Optimierung, manchmal mit
  eigens für Gaming optimierten Leitungen.
- **Allgemeine tägliche Nutzung**: viele Nodes, breite regionale Abdeckung, kein
  einzelner Anwendungsfall im Fokus — gut geeignet für Surfen und Videoschauen.

## Wie man diese Kriterien anwendet

Man muss sich das nicht auswendig merken — grob gesagt: finde zuerst heraus, welcher
Anwendungsfall zu deinem Hauptbedarf passt, prüfe dann, ob die vom Anbieter
offengelegten Informationen zum Leitungstyp klar und plausibel sind, und gleiche das
schließlich mit der konkreten Checkliste in [Wie man als Anfänger auswählt](./how-to-choose)
ab. Kein einzelnes Kriterium reicht allein aus, um zu entscheiden, ob ein Anbieter gut
ist — kombiniert liefern sie ein zuverlässigeres Bild.
