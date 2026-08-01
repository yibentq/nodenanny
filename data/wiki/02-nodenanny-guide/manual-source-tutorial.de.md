---
title: Wie man manuell eine Node-Quelle hinzufügt
summary: Am bestehenden Beispiel WangCai Schritt für Schritt ein GitHub-Abo oder einen Telegram-Kanal zu deinem Notfall-Traffic-Pool hinzufügen
order: 9
updated: 2026-07-31
tags: [Anleitung, Traffic-Pool, Konfiguration]
---

## Worum es in dieser Anleitung geht

Der Notfall-Traffic-Pool von NodeNanny entdeckt standardmäßig automatisch einige Backup-Node-Quellen aus öffentlichen Kanälen, aber du kannst auch manuell eine Quelle angeben, der du selbst vertraust — zum Beispiel ein GitHub-Abo-Repository, das du schon lange nutzt, oder einen Abo-Link, der in einem Telegram-Kanal geteilt wird. Eine manuell hinzugefügte Node-Quelle wird standardmäßig als "fest vertrauenswürdig" markiert — sie muss sich nicht wie eine automatisch entdeckte Quelle erst schrittweise von trial (Beobachtungsphase) zu trusted (offiziell vertrauenswürdig) hocharbeiten, bevor sie mit vollem Gewicht genutzt wird.

## Wo die Konfiguration liegt

Öffne `config/config.json` (nicht `config.example.json` — das ist nur die Vorlage) und suche das Array `manualSources`. Darin gibt es bereits ein Beispiel:

```json
{
  "id": "wangcai",
  "name": "WangCai",
  "url": "https://shz.al/~WangCai",
  "fixed": true
}
```

Was die vier Felder bedeuten:
- `id`: eine eindeutige Kennung für diese Node-Quelle — wähle einfach selbst einen kurzen englischen/Pinyin-Namen, der sich nicht mit einem bereits vorhandenen überschneidet
- `name`: der im Panel angezeigte Name, Chinesisch ist möglich
- `url`: die Adresse des Abo-Links
- `fixed`: auf `true` gesetzt bedeutet, dass diese Quelle direkt die Behandlung "fest vertrauenswürdig" erhält, ohne den Vertrauensbewertungsprozess zu durchlaufen. Dieses Feld kann auch weggelassen werden (Standard ist der normale Vertrauensbewertungsprozess, genauso wie bei automatisch entdeckten Quellen) — welche Variante passt, hängt davon ab, wie sehr du dieser Quelle selbst vertraust.

## Konkrete Schritte zum Hinzufügen einer neuen Quelle

1. Finde den Abo-Link, den du hinzufügen möchtest (den Raw-Link zu einem GitHub-Repository, oder eine von jemandem geteilte Abo-Adresse)
2. Füge im `manualSources`-Array nach dem Vorbild des `wangcai`-Eintrags einen neuen Eintrag hinzu, zum Beispiel:

```json
{
  "id": "my-source-1",
  "name": "Mein eigenes Backup-Abo",
  "url": "hier den Abo-Link einfügen",
  "fixed": true
}
```

Denk daran, nach dem vorherigen Eintrag ein Komma zu setzen — JSON-Format reagiert empfindlich auf Kommas und Klammern. Nach dem Bearbeiten empfiehlt es sich, den gesamten Inhalt in einen Online-JSON-Validator einzufügen, um das Format zu überprüfen, damit ein fehlendes Komma nicht die gesamte Konfigurationsdatei unlesbar macht.

3. Datei speichern
4. Den PM2-Prozess `nodenanny-pool` neu starten, damit die neue Konfiguration wirksam wird:

```
pm2 restart nodenanny-pool
```

5. Im Panel den Status des Traffic-Pools prüfen und bestätigen, dass die neu hinzugefügte Quelle erscheint und erfolgreich Nodes liefert

## Zu Telegram-Kanal-Quellen

Wenn du einen Telegram-Kanal hinzufügen möchtest, funktioniert aktuell nur die Form, bei der "der Abo-Link direkt als Text in der Kanalnachricht gepostet wird" (`message_text_link`). Die Form "als Dateianhang im Kanal gepostet" ist derzeit nicht nutzbar (Telegrams öffentliche Vorschauseite liefert für einen Dateianhang keine echte Download-Adresse, sondern nur einen Weiterleitungslink — technisch nicht verwertbar). Prüfe beim Hinzufügen einer Telegram-Kanal-Quelle also zuerst, ob der Kanal sein Abo als reinen Link-Text und nicht als Datei teilt.

## Ob man `fixed: true` setzen sollte

`fixed: true` bedeutet, dass diese Quelle keine Vertrauensbewertung durchläuft und sofort volles Gewicht erhält — geeignet für eine Quelle, die du bereits lange verifiziert hast und der du wirklich vertraust (etwa ein selbst gepflegtes Repository). Bei einer gerade erst entdeckten Quelle, deren Qualität noch unklar ist, empfiehlt es sich, das Feld `fixed` wegzulassen und sie wie eine automatisch entdeckte Quelle den normalen Beobachtungsprozess durchlaufen zu lassen — so beansprucht sie kein hohes Gewicht von Anfang an, selbst wenn ihre Qualität instabil ist. Wie der Vertrauensmechanismus im Detail funktioniert, erklärt [Wie der Node-Pool-Vertrauensmechanismus funktioniert](./pool-trust-mechanism).
