---
title: "Häufige Störung: vmess+ws-Client verliert wiederholt die Verbindung"
summary: "Derzeit gibt es keinen fertigen One-Click-Fix-Befehl, manuelle Prüfung ist nötig — das wird hier ehrlich so gesagt"
order: 7
updated: 2026-07-22
tags: [Fehlersuche, vmess, bekannte Einschränkung]
kbRef: vmess-ws-mux-mismatch
---

## Symptom

Ein Client, der vmess+websocket verwendet, verbindet sich instabil und
verliert wiederholt die Verbindung; im Log stehen Meldungen wie
"websocket: bad handshake" oder ein vmess-bezogenes unexpected EOF.

## Ursache

Solche Probleme liegen meist **nicht** an einem abgestürzten Serverprozess,
sondern daran, dass ws-Path/mux-Parameter zwischen Client und Server nicht
übereinstimmen, oder dass ein dazwischenliegendes CDN bzw. ein Reverse Proxy
fragmentierte Daten inkompatibel behandelt.

## Aktuelles Vorgehen (ehrlich gesagt: noch kein One-Click-Fix)

Für diesen Wissensdatenbank-Eintrag gibt es aktuell **keinen direkt
ausführbaren Fix-Befehl** — es braucht einen manuellen, punktweisen Abgleich
der Konfigurationsdateien von Client und Server (insbesondere ws-Path und
mux-bezogene Parameter). Das ist ein bewusst als "Platzhalter" belassener
Eintrag in der Wissensdatenbank — er dokumentiert das Symptom und die
Richtung der Fehlersuche, täuscht aber keinen allgemeingültigen One-Click-Fix
vor. Sobald ein wirklich universeller Lösungsweg gefunden ist, wird er
ergänzt. Bei diesem Problem bitte beide Konfigurationen zum Vergleich
bereitstellen, statt auf einen einzelnen Befehl als Lösung zu hoffen.
