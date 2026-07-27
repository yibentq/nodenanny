---
title: "Häufige Störung: Proxy-Dienstprozess beendet sich"
summary: "Panel zeigt \"offline\", im Log stehen Meldungen wie Failed to start / xray.service failed"
order: 3
updated: 2026-07-22
tags: [Fehlersuche, Dienstprozess]
kbRef: xray-service-down
---

## Symptom

Der "Status des selbst gehosteten Nodes" auf der Panel-Startseite wechselt auf
offline, oder es kommt eine Neustart-Benachrichtigung per E-Mail.

## Ursache

Der Proxy-Dienstprozess (xray/sing-box) selbst hat sich beendet. Häufige
Ursachen, meist eine von drei: fehlerhafte Konfigurationsdatei, Port bereits
von einem anderen Programm belegt, oder der Dienst ist so oft hintereinander
abgestürzt, dass systemd ihn als endgültig fehlgeschlagen einstuft und nicht
mehr automatisch neu startet.

## Vorgehen

Zuerst den Dienst einmal neu starten:

```bash
systemctl restart xray
```

Das ist eine "risikoarme" Aktion, die im Online-Terminal des NodeNanny-Panels
mit einem Klick ausgeführt werden kann. Stürzt der Dienst kurz nach dem
Neustart erneut ab, handelt es sich nicht um ein einmaliges Problem — dann
lohnt sich ein Blick in die konkrete Fehlermeldung
(`journalctl -u xray -n 50` zeigt die letzten 50 Log-Zeilen), um zu
entscheiden, ob es an der Konfiguration oder an einem Portkonflikt liegt.
