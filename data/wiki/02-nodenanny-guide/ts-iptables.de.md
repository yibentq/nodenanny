---
title: "Häufige Störung: lokaler Test schlägt fehl, obwohl der Dienstprozess läuft"
summary: "Vermutlich blockiert eine Firewall-Regel den Port, im Fehler steht etwas wie connection refused / iptables DROP"
order: 5
updated: 2026-07-22
tags: [Fehlersuche, Firewall]
kbRef: iptables-blocking-port
---

## Symptom

Der Dienstprozess selbst läuft normal (`pm2 status` / `systemctl status xray`
zeigen beide "läuft"), aber der lokale Verbindungstest schlägt fehl mit
connection refused.

## Ursache

Höchstwahrscheinlich haben sich die iptables-Firewallregeln geändert und den
Proxy-Port blockiert — möglicherweise durch eine Regel, die du selbst früher
gesetzt hast, oder ein anderes Installationsskript hat nebenbei die Firewall
verändert.

## Vorgehen — dieser Abschnitt muss unbedingt vor der Ausführung gelesen werden

```bash
iptables -F
```

**Dieser Befehl löscht alle aktuellen iptables-Regeln, nicht nur die, die den
Proxy-Port blockiert** — das ist eine "Aktion mit hohem Risiko". Das
NodeNanny-Terminal verlangt zwingend eine zweite Bestätigung (Eingabe eines
Bestätigungswortes), bevor der Befehl wirklich ausgeführt wird — auch wenn die
Wissensdatenbank ihn anders einstufen sollte, gilt das gleichermaßen. Das ist
eine systemseitig fest eingebaute Sicherheitsmaßnahme, kein überspringbarer
Hinweis. Vor der Ausführung unbedingt prüfen: Gibt es in deiner Firewall
andere Regeln, die unbedingt erhalten bleiben müssen, insbesondere
Zugriffsbeschränkungen für den SSH-Port? Wird SSH mit dieser Regel ebenfalls
geleert, kannst du dich unter Umständen nicht einmal mehr mit dem Server
verbinden.
