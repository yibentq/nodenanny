---
title: Was ist NodeNanny
summary: "In einem Satz: Es passt auf deinen eigenen Proxy-Node auf, heilt ihn automatisch, wenn er ausfällt, und springt mit einem Backup-Pool ein, wenn nicht."
order: 0
updated: 2026-07-22
tags: [Einführung, Anfänger]
---

## In einem Satz

NodeNanny ist ein "Node-Kindermädchen", das auf deinem eigenen VPS läuft: Es
behält deinen selbst eingerichteten Proxy-Node (xray/sing-box o. Ä.) ständig im
Blick und startet ihn bei Problemen automatisch neu. Wenn der selbst gehostete
Node wirklich nicht mehr zu retten ist, gibt es zusätzlich einen
"Backup-Node-Pool": Er sucht aus öffentlichen Quellen und von dir manuell
angegebenen Abos brauchbare Nodes zusammen, damit dein Abo-Link im Client immer
etwas Nutzbares liefert, statt plötzlich komplett offline zu gehen.

## Das Kernproblem, das es löst

Beim eigenen Betrieb eines Proxy-Nodes gibt es zwei größte Sorgen:

1. **Der Dienstprozess stürzt ab, ohne dass es jemand merkt** — mitten in der
   Nacht crasht der Prozess, und erst beim Aufwachen fällt auf, dass er schon
   stundenlang offline war
2. **Der Node selbst ist nicht abgestürzt, aber vorübergehend nicht erreichbar**
   (z. B. blockiert, oder ein Rechenzentrumsausfall) — hier hilft ein Neustart
   des Prozesses nichts, es braucht einen "Ersatz", der einspringt

NodeNanny hat für beide Fälle einen eigenen Mechanismus: prozessbezogene
Überwachung samt automatischem Neustart löst das erste Problem, der
Backup-Node-Pool löst das zweite.

## Gesamtarchitektur (das reicht zum Verständnis, kein Code nötig)

Das Projekt besteht aus drei dauerhaft laufenden Prozessen (verwaltet mit PM2,
einem Node.js-Prozessmanager):

- **nodenanny-monitor**: überwacht den Dienstprozess deines selbst gehosteten
  Nodes und startet ihn bei Absturz neu
- **nodenanny-panel**: das Web-Kontrollpanel — alles, was du im Browser siehst,
  liefert dieser Prozess
- **nodenanny-pool**: pflegt den "Backup-Node-Pool" — sucht regelmäßig Nodes
  aus verschiedenen Quellen, prüft jeden einzeln auf tatsächliche
  Nutzbarkeit und sortiert nicht brauchbare aus

Die drei Prozesse arbeiten zusammen, indem sie dieselben Datendateien lesen und
schreiben — eine zusätzliche Datenbank ist nicht nötig.

## Die dreistufige Filterlogik des Backup-Pools

Der Backup-Node-Pool übernimmt nicht einfach jeden gefundenen Node — jeder
Kandidat muss nacheinander drei Prüfstufen bestehen, bevor er in den
nutzbaren Pool aufgenommen wird:

1. **Erreichbarkeitsprüfung (alive)**: Lässt sich der Node überhaupt verbinden?
2. **Geschwindigkeitsprüfung (speed)**: Läuft die Verbindung danach flüssig? Zu
   langsame Nodes werden aussortiert
3. **Echtheitsprüfung (authentic)**: Die ersten beiden Stufen können durch
   "vorgetäuschte Erreichbarkeit" getäuscht werden (verbindbar, aber faktisch
   kein funktionierender Proxy) — diese Stufe verifiziert mit einer echten
   Anfrage an eine reale Zielseite

Nur wenn alle drei Stufen bestanden sind, gilt ein Node als "nutzbar" und wird
im Panel angezeigt.

## Vertrauensstufen der Node-Quellen

Node-Quellen (egal ob automatisch gefunden oder von dir selbst als Abo
hinzugefügt) werden nicht gleich behandelt — es gilt eine Zustandsmaschine
"Testphase → Vertraut → Gesperrt":

- Neue Quellen starten im Status **trial (Testphase)**, mit einer
  Gewichtsobergrenze von nur 5 %, damit eine neue, unbekannte Quelle nicht
  sofort einen großen Anteil einnimmt
- Bleibt die Erfolgsrate während der Testphase konstant gut, wird die Quelle zu
  **trusted (vertraut)** hochgestuft, die Gewichtsobergrenze entfällt
- Sinkt die Erfolgsrate dauerhaft, wird eine trusted-Quelle zurück auf trial
  gestuft, eine trial-Quelle wird gesperrt
- Eine Sperre ist nicht endgültig: Erholt sich die tatsächliche Erfolgsrate
  einer gesperrten Quelle über mehrere Runden hinweg wieder auf ein
  akzeptables Niveau, wird sie wieder auf trial freigegeben

Dieser Mechanismus läuft vollautomatisch, du musst nicht manuell eingreifen —
außer wenn du selbst eine Abo-Quelle hinzufügen willst, der du vertraust
(wie das geht, erklärt die nächste Seite).

Wie man konkrete Airport-/VPN-Dienste auswählt, behandelt die Kategorie
"Airport & VPN Wiki"; "Node-Quelle" bezieht sich hier ausschließlich auf die
technische Zuverlässigkeit des Abo-Links selbst, nicht auf die geschäftliche
Reputation des Airport-Anbieters.
