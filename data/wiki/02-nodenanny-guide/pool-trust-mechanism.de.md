---
title: Wie der Node-Pool-Vertrauensmechanismus funktioniert
summary: Wie Quellen zwischen den Zuständen trial (Beobachtungsphase), trusted (offiziell vertrauenswürdig) und blacklisted (gesperrt) wechseln — eine Anleitung zum Lesen der Traffic-Pool-Statuslabels im Panel
order: 10
updated: 2026-07-31
tags: [Anleitung, Traffic-Pool, Vertrauensmechanismus]
---

## Warum dieser Mechanismus nötig ist

Die Node-Quellen in NodeNannys Notfall-Traffic-Pool stammen aus unterschiedlichen Kanälen: manche hast du selbst manuell hinzugefügt und über einen langen Zeitraum verifiziert (wie WangCai), andere hat das System automatisch von GitHub oder Telegram-Kanälen entdeckt und ihre Qualität wurde noch nie geprüft. Würde man alle unterschiedslos gleich behandeln, würde eine schlechte, oft nicht erreichbare Quelle dasselbe Gewicht beanspruchen wie eine hochwertige und die Zuverlässigkeit des gesamten Notfall-Pools nach unten ziehen. Dieser Vertrauensmechanismus sorgt dafür, dass "Quellen mit guter Leistung schrittweise mehr Gewicht erhalten und Quellen mit schlechter Leistung schrittweise herabgestuft oder entfernt werden" — vollständig automatisch, ohne dass du selbst beurteilen musst, ob eine einzelne Quelle gut ist.

## Die drei Zustände

Eine Node-Quelle im System befindet sich immer in genau einem der folgenden drei Zustände (eine manuelle Quelle mit gesetztem `fixed: true` überspringt diesen gesamten Prozess und unterliegt nicht den hier beschriebenen Regeln):

**trial (Beobachtungsphase)**
Jede neu entdeckte Quelle startet in diesem Zustand. In dieser Phase ist das Gewicht auf 0–5 % begrenzt und schwankt linear je nach aktueller Erfolgsrate — je höher die Erfolgsrate, desto näher liegt das Gewicht an 5 %, aber unabhängig davon, wie gut die Leistung ist, erhält eine Quelle in trial nie mehr als 5 % Gewicht, damit eine noch nicht verifizierte Quelle nicht von Anfang an einen zu großen Traffic-Anteil beansprucht.

**trusted (offiziell vertrauenswürdig)**
Bleibt die Erfolgsrate während trial über 7 aufeinanderfolgende Prüfrunden (etwa 42 Stunden) durchgängig bei mindestens 70 %, wird die Quelle zu trusted hochgestuft — ab dann entfällt die 5-%-Obergrenze.

**blacklisted (gesperrt)**
Zwei Situationen führen zur Sperrung:
- Die Erfolgsrate während trial bleibt dauerhaft niedrig und erreicht auch am Ende des beobachtbaren Zeitraums nicht die Schwelle
- Die Erfolgsrate liegt während trial 4 aufeinanderfolgende Runden bei 0 % (bei tatsächlich durchgeführten Prüfungen, nicht bei ausgebliebener Prüfung) — in diesem Fall erfolgt die Sperrung sofort, ohne die vollen 7 Runden abzuwarten

Fällt die Erfolgsrate einer trusted-Quelle über 7 aufeinanderfolgende Runden unter 70 %, wird sie nicht sofort gesperrt, sondern zunächst auf trial zurückgestuft und durchläuft den Beobachtungsprozess erneut.

## Gibt es nach einer Sperrung eine Chance auf Wiederherstellung?

Ja. Eine gesperrte Quelle ist nicht dauerhaft aufgegeben — erreicht ihre Erfolgsrate danach für 2 aufeinanderfolgende Prüfrunden wieder mindestens 70 %, wird sie automatisch von blacklisted zurück auf trial gesetzt, mit neu berechnetem Gewicht — ohne feste Wartezeit und ohne manuelle Änderung der Konfigurationsdatei. Dieses Design berücksichtigt Fälle, in denen "eine Quelle nur vorübergehend gestört war und sich danach wieder normalisiert hat" (etwa wenn sich die Adresse der Prüf-Zielseite geändert hat und dadurch kurzzeitig Prüfungen fehlschlugen).

## Manuelle Quellen vs. automatisch entdeckte Quellen

Hier gilt ein klares Prinzip: **nur manuell hinzugefügte Quellen mit gesetztem `fixed: true` können diesen gesamten Prozess überspringen** — automatisch entdeckte Quellen (GitHub-Scan, Telegram-Kanal-Erfassung) müssen den vollständigen trial-→-trusted-Ablauf durchlaufen, egal wie gut sie auf den ersten Blick wirken, und werden nie automatisch vertraut. Das ist bewusst so gestaltet: Inhalte aus maschinell entdeckten Quellen wurden nicht von Menschenhand geprüft und sollten daher nicht vorab vertraut werden — nur eine Quelle, die von einem Menschen manuell ausgewählt und persönlich bestätigt wurde, darf die Bewertung überspringen.

## Was das mit deiner alltäglichen Nutzung zu tun hat

Im Alltag musst du nicht manuell in diese Zustandsmaschine eingreifen — sie läuft vollautomatisch. Das wichtigste Szenario, in dem du diesen Mechanismus kennen solltest: Wenn im Panel plötzlich der Status einer Node-Quelle von trusted auf trial oder auf blacklisted wechselt, keine Sorge — das ist das System, das planmäßig funktioniert (es bedeutet, dass diese Quelle zuletzt instabil war), keine Fehlfunktion von NodeNanny. Wird bei einer selbst hinzugefügten manuellen Quelle instabile Qualität beobachtet, kannst du dich auch an den Kriterien dieses Mechanismus orientieren, um selbst zu entscheiden, ob du diese Quelle behältst.
