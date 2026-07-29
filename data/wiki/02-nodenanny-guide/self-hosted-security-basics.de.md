---
title: Sicherheits- und Datenschutz-Grundlagen für einen selbstgehosteten Knoten
summary: Allgemeinwissen für nicht-technische Nutzer, die sich einen eigenen VPS kaufen, um einen Knoten selbst zu hosten — Serverauswahl und sechs grundlegende SSH-Härtungsschritte
order: 8
updated: 2026-07-28
tags: [vps, ssh, sicherheit, selbstgehostet]
---


> Dieser Artikel richtet sich an Nutzer ohne technischen Hintergrund, die sich "einen VPS gekauft haben, um selbst einen Knoten zu hosten". Er behandelt zwei Bereiche: wie man einen Server auswählt, und grundlegende SSH-Härtung. Beides ist relativ ausgereiftes, stabiles allgemeines Betriebswissen — nichts NodeNanny-Spezifisches — aber für jeden, der einen Server allein verwaltet, lohnt es sich, dies einmal gesondert zusammenzustellen.

## Auswahlkriterien für einen VPS

- **Wie streng die Risikokontrolle des Anbieters/Rechenzentrums ist**: Anbieter unterscheiden sich stark darin, wie viel Toleranz sie dafür haben, "was diese Maschine tut". Manche Rechenzentren/ASN-Bereiche werden wegen häufigen Missbrauchs eher gezielt gedrosselt oder auf Blacklists gesetzt — bei der Auswahl lohnt es sich, auf den Ruf des IP-Bereichs des Anbieters zu achten, nicht nur auf Preis und technische Daten.
- **Geografische Lage und Latenz**: Ein Rechenzentrum, das näher am eigenen tatsächlichen Standort liegt, bedeutet in der Regel eine niedrigere Round-Trip-Latenz, aber die Standortwahl muss auch gegen die Frage abgewogen werden, "ob diese Route über einen Pfad läuft, der eher gezielt erkannt wird" — es gibt keine universell "optimale Region".
- **Ob es sich um eine "recycelte IP" handelt**: Günstige VPS nutzen manchmal IP-Bereiche, die zuvor von jemand anderem verwendet wurden und möglicherweise bereits markiert sind. Nach dem Hochfahren lohnt es sich, zunächst selbst die Konnektivität und den historischen Ruf dieser IP zu testen — das ist einfacher, als hinterher zu ergründen, "warum es von Anfang an nicht funktioniert hat".
- **Nutzungsbasiert/monatlich beginnen, eine große einmalige Jahresvorauszahlung vermeiden**: Das ist nicht nur ein Rat für die Airport-Branche (siehe "Aktueller Stand des inländischen Airport-Marktes") — er gilt genauso, wenn man direkt beim Anbieter einen VPS kauft, da auch der Anbieter selbst schließen, die Preise erhöhen oder von politischen Änderungen betroffen sein kann. Zunächst über einen kurzen Abrechnungszyklus die Stabilität prüfen, bevor man ein längerfristiges Paket in Betracht zieht.
- **Ob unabhängiges IPv4 angeboten wird und die Bandbreitenabrechnung klar ist**: Diese beiden Punkte wirken sich direkt darauf aus, ob man bei späteren Netzwerkproblemen die konkrete Ursache eingrenzen kann — dies vor dem Kauf zu klären ist verlässlicher, als erst bei einem Problem den Support zu fragen.

## Grundlegende SSH-Härtungsmaßnahmen

Einen Knoten selbst zu hosten bedeutet, dass man selbst der einzige Systemadministrator ist und der Server im öffentlichen Internet exponiert ist — grundlegende SSH-Härtung ist das Mindeste, was getan werden sollte:

- **Auf schlüsselbasierten Login umstellen, Passwort-Login deaktivieren**: Nachdem die SSH-Public-Key-Authentifizierung auf dem Server eingerichtet ist, `PasswordAuthentication` in `/etc/ssh/sshd_config` auf `no` setzen. Allein dieser Punkt blockiert die große Mehrheit der auf Passwörter zielenden Brute-Force-Versuche.
- **Direkten Root-Login verbieten**: `PermitRootLogin` auf `no` setzen und stattdessen mit einem normalen Benutzer einloggen und danach per `sudo` Rechte erhöhen. Selbst wenn die Zugangsdaten eines Accounts durchsickern, erhält ein Angreifer damit keinen direkten Zugang zur höchsten Rechteebene.
- **Standard-SSH-Port ändern (optional, begrenzte Wirkung, reduziert aber Rauschen)**: Das Ändern von Port 22 auf einen anderen Port erhöht die Sicherheit nicht wirklich (gegen einen gezielten Angreifer bringt es nichts), kann aber das Log-Rauschen durch wahlloses Scannen im Internet erheblich reduzieren — ob man das macht, ist Geschmackssache.
- **Ein Tool wie fail2ban gegen fehlgeschlagene Login-Versuche installieren**: Sperrt automatisch Quell-IPs nach mehreren fehlgeschlagenen Login-Versuchen in kurzer Zeit — eine zusätzliche Schutzschicht gegen Brute-Force bei geringem Konfigurationsaufwand.
- **System und SSH-Dienst selbst aktuell halten**: Regelmäßig die Sicherheitsupdates des Systems einspielen, um zu verhindern, dass bekannte Schwachstellen durch massenhaftes Scannen ausgenutzt werden — das Risiko liegt hier nicht darin, "gezielt angegriffen zu werden", sondern darin, dass "das gesamte Internet massenhaft nach Maschinen mit dieser Schwachstelle durchsucht wird". Updates sind der kostengünstigste Schutz.
- **Einschränken, welche Accounts/IPs sich einloggen dürfen**: Ist die eigene Zugriffs-IP relativ konstant, kann man auf Firewall-Ebene nur bestimmten Quellen den Zugriff auf den SSH-Port erlauben — eine praktisch wirksamere Einschränkung als Port-Verschleierung (dabei aber unbedingt einen Notfallzugang bereithalten, um sich nicht selbst auszusperren, falls sich die eigene IP ändert).

## Wo dieser Inhalt einzuordnen ist

Alles oben Genannte sind Basispunkte allgemeiner Serversicherheit, die für jeden selbstgehosteten Server empfohlen werden (nicht nur für einen, auf dem ein NodeNanny-Knoten läuft). Dieses Wissen selbst ist vergleichsweise stabil und veraltet im Zeitverlauf nicht leicht, wobei bei den konkreten Härtungsmethoden und -werkzeugen (z. B. Alternativen zu fail2ban, in Cloud-Anbietern integrierte Security-Group-Funktionen) neuere Optionen entstehen können. Dieser Artikel behält bewusst nur die grundlegendsten, am wenigsten veraltenden Punkte und erhebt keinen Anspruch, alle möglichen Härtungsmaßnahmen abzudecken.
