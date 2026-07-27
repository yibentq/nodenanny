---
title: "Häufige Störung: Festplattenspeicher voll"
summary: "Im Fehler steht No space left on device / ENOSPC"
order: 6
updated: 2026-07-22
tags: [Fehlersuche, Festplatte]
kbRef: disk-full-log-write-fail
---

## Symptom

Der Dienst verhält sich fehlerhaft, in Logs oder Systemmeldungen wird
mangelnder Festplattenspeicher erwähnt.

## Ursache

Meist wachsen Log-Dateien immer weiter, ohne dass eine Rotation/Bereinigung
(logrotate) eingerichtet ist, wodurch sich die Festplatte über die Zeit füllt.

## Vorgehen

```bash
journalctl --vacuum-time=3d
```

Dieser Befehl behält nur die Systemlogs der letzten 3 Tage — eine
"risikoarme" Aktion, die mit einem Klick ausgeführt werden kann und sofort
Speicherplatz freigibt. Das behebt aber nur das Symptom: Langfristig ist es
sinnvoll, logrotate für die Logs einzurichten, statt jedes Mal manuell
aufzuräumen, wenn der Speicher voll ist.
