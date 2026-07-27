---
title: "Häufige Störung: TLS-Zertifikat läuft bald ab oder ist bereits abgelaufen"
summary: "Client kann nicht verbinden, im Fehler steht etwas wie certificate expired"
order: 4
updated: 2026-07-22
tags: [Fehlersuche, Zertifikat]
kbRef: tls-cert-expiring-soon
---

## Symptom

Die Client-Verbindung schlägt fehl, die Fehlermeldung erwähnt eine
fehlgeschlagene Zertifikatsprüfung oder ein abgelaufenes Zertifikat.

## Ursache

Das TLS-Zertifikat läuft bald ab oder ist bereits abgelaufen. Wird die
automatische Verlängerung über acme.sh durchgeführt, liegt das Problem meist
daran, dass "die Verlängerung erfolgreich war, der Dienst aber das neue
Zertifikat nicht neu geladen hat" — nicht daran, dass die Verlängerung selbst
fehlgeschlagen ist.

## Vorgehen

```bash
acme.sh --renew -d your-domain.com --force
systemctl restart xray
```

Ersetze `your-domain.com` durch deine tatsächliche Domain. Das ist eine
"Aktion mit mittlerem Risiko" — im Terminal wird sie vorausgefüllt in das
Eingabefeld eingetragen, du musst sie selbst bestätigen und mit Enter
ausführen, sie läuft nicht automatisch — weil die Kombination aus erzwungener
Verlängerung und Dienstneustart eine kurze Unterbrechung verursacht, bei der
sich eine manuelle Bestätigung des Zeitpunkts lohnt.
