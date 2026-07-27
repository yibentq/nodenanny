---
title: Bereitstellung & Installation
summary: Was auf einem frischen VPS von Grund auf nötig ist, damit alles läuft
order: 1
updated: 2026-07-22
tags: [Bereitstellung, Installation, VPS]
---

## Unterstützte Umgebungen

Das Installationsskript unterstützt derzeit Ubuntu 20.04/22.04/24.04 und
Debian 11/12. Empfohlen wird ein brandneuer VPS, um Konflikte mit bestehenden
Diensten zu vermeiden.

## Was die Installation macht

Beim Ausführen des Installationsskripts laufen mehrere Phasen nacheinander ab:

1. **Sprache wählen** — derzeit werden Chinesisch/Englisch/Japanisch/Deutsch/
   Russisch unterstützt; nach der Installation folgen sowohl die
   Terminal-Ausgaben als auch die Panel-Oberfläche dieser Wahl
2. **Abhängigkeiten prüfen** — bestätigt, ob die Node.js-Version auf dem Server
   ausreicht; fehlt etwas, wird angezeigt, wie es installiert wird
3. **Den eigentlichen Proxy-Dienst installieren** — hier wird ein in der
   Community gängiges One-Click-Installationsskript aufgerufen, um den
   tatsächlichen Proxy-Dienst (xray/sing-box) zu installieren; NodeNanny
   erfindet diesen Teil nicht neu, sondern kümmert sich nur ums "Aufpassen"
4. **Konfiguration schreiben** — erzeugt `config/config.json`, darunter das
   Panel-Passwort und die Bindungsadresse
5. **Drei dauerhafte Prozesse mit PM2 starten** — `nodenanny-monitor`
   (Erreichbarkeitsüberwachung), `nodenanny-panel` (Web-Panel),
   `nodenanny-pool` (Pflege des Backup-Node-Pools)

## Zum Thema Verbindungsabbruch

Wird der Server per SSH aus der Ferne verwaltet und die Verbindung bricht
während der Installation durch ein Netzwerkproblem ab, ist das
Installationsskript so ausgelegt, dass es dadurch nicht abgebrochen wird —
sicherer ist es trotzdem, vorher auf dem Server eine `tmux`- oder
`screen`-Sitzung zu öffnen und das Skript darin auszuführen. So kannst du nach
einem Verbindungsabbruch mit `tmux attach` wieder einsteigen und den
Fortschritt weiterverfolgen.

## Wie das Panel nach der Installation geöffnet wird

Das Panel lauscht standardmäßig nur auf der lokalen Adresse (`127.0.0.1`) —
das heißt, du kannst es standardmäßig nicht direkt über die öffentliche IP des
Servers im Browser öffnen. Das ist eine bewusste Sicherheitsentscheidung, damit
das Panel nicht sofort nach der Installation öffentlich exponiert ist. Es gibt
zwei gängige Wege, es zu öffnen:

- **SSH-Tunnel**: lokal `ssh -L lokaler_Port:127.0.0.1:Panel_Port dein_Server`
  ausführen, dann im Browser `http://127.0.0.1:lokaler_Port` öffnen
- **Nginx-Reverse-Proxy + Passwort einrichten**: Willst du direkt über Domain/
  öffentliche IP zugreifen, musst du in der Konfiguration explizit ein
  Panel-Passwort setzen und gemäß der Beispieldatei
  `deploy/nginx-nodenanny.conf.example` einen Reverse Proxy einrichten. Erkennt
  das Panel, dass die Bindungsadresse auf nicht-lokal geändert wurde, das
  Passwort aber noch leer ist, verweigert es den Start — das ist ein Schutz
  dagegen, versehentlich ohne Passwort öffentlich exponiert zu werden, kein Bug.

## Erste Sache nach der Installation: prüfen, ob alle drei Prozesse laufen

```bash
pm2 status
```

Es sollten `nodenanny-monitor`, `nodenanny-panel` und `nodenanny-pool` alle im
Status `online` erscheinen. Startet ein Prozess wiederholt neu oder zeigt
`errored`, hilft `pm2 logs Prozessname`, um den genauen Fehler zu sehen — das
ist auch ein typischer Ausgangspunkt für die Fehlersuche, die sowohl in
"Netzwerk-/Protokoll-Grundlagenwissen" als auch hier laufend ergänzt wird.
