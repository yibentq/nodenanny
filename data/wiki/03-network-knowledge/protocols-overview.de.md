---
title: "Häufige Proxy-Protokolle erklärt: vmess / vless / trojan / shadowsocks / hysteria2"
summary: Was diese Begriffe bedeuten und worin sie sich unterscheiden — nach dieser Seite solltest du den Diskussionen in der Community grob folgen können
order: 0
updated: 2026-07-22
tags: [Protokolle, Grundlagen, vmess, vless, trojan, shadowsocks, hysteria2]
---

## Erst mal klarstellen: Ein Protokoll ist die "Übertragungsart", nicht "welcher Airport"

Viele Einsteiger verwechseln "Protokoll" mit "Airport-Anbieter". Ein Protokoll
beschreibt die Regeln, nach denen Client und Server Daten verpacken,
verschlüsseln und übertragen — es hat nichts damit zu tun, welchen Airport du
nutzt. Ein und derselbe Airport bietet häufig Nodes mit mehreren
verschiedenen Protokollen gleichzeitig an, und bei einem selbst betriebenen
NodeNanny-Node ist es genauso.

## Fünf gängige Protokolle im Überblick

### Shadowsocks (SS)
Das älteste und einfachste — im Kern ein verschlüsselter SOCKS5-Proxy.
Vorteile: einfache Implementierung, ausgereifte Clients auf allen Plattformen,
geringer Overhead. Nachteile: das Traffic-Muster ist vergleichsweise leicht
erkennbar, pures SS wird heute seltener allein eingesetzt — üblich ist die
Kombination mit Verschleierungs-Plugins oder der Wechsel zu neueren
Protokollen.

### VMess
Das im V2Ray-Projekt integrierte Protokoll, mit AEAD-Verschlüsselung (z. B.
AES-128-GCM), jedes Paket trägt Authentifizierungsinformationen und schützt
so vor Replay-Angriffen. Im Vergleich zu SS bietet es eine zusätzliche
Identitätsprüfung und ist besser gegen Analyse geschützt, hat aber wegen der
umfangreicheren Handshake-Daten etwas mehr Overhead als SS und VLESS.

### VLESS
Lässt sich als "leichtgewichtige Variante von VMess" verstehen: Es
verschlüsselt selbst nicht zusätzlich (die Verschlüsselung übernimmt die
äußere TLS-Schicht) und verzichtet auf einen Teil des VMess-Prüf-Overheads.
In Kombination mit TLS 1.3 und Tarnungstechniken wie "Reality" ist es derzeit
eine der beliebtesten Kombinationen, besonders für Szenarien, die auf bessere
Unauffälligkeit und niedrigere Latenz Wert legen.

### Trojan
Der Ansatz ist direkt: Es tarnt sich als gewöhnliche HTTPS-Website. Es gibt
keine zusätzlichen, benutzerdefinierten Handshake-Merkmale — für einen
externen Beobachter sieht der Traffic aus wie ein normaler Website-Besuch.
Dadurch ist die Widerstandsfähigkeit gegen Sperren vergleichsweise hoch, und
die Konfiguration ist relativ einfach.

### Hysteria2
Das neueste dieser Protokolle, aufgebaut auf QUIC (basierend auf UDP), speziell
für Szenarien mit "schlechter Netzqualität, hoher Paketverlustrate" optimiert
(z. B. Mobilfunknetze). In Kombination mit einem eigenen
Staukontrollalgorithmus läuft es bei hoher Latenz/hohem Paketverlust oft
schneller und stabiler als klassische TCP-basierte Protokolle. Nachteil: Es
läuft über UDP, das in manchen Netzwerkumgebungen eingeschränkt oder blockiert
wird.

## Wie man wählt (allgemeine Grundsätze, nicht auf einen bestimmten Anbieter bezogen)

- **Wenn nur Stabilität und Benutzerfreundlichkeit zählen**: Shadowsocks/VMess
  reichen aus, die Client-Unterstützung ist am ausgereiftesten
- **Wenn Sperr-Resistenz/Unauffälligkeit wichtiger ist**: VLESS + Reality oder
  Trojan gelten derzeit allgemein als besonders wirksam
- **Bei schlechter Netzumgebung (schwaches 4G, Satellitennetz usw.)**: QUIC-
  basierte Protokolle wie Hysteria2 bieten oft ein besseres Erlebnis,
  vorausgesetzt dein Netz schränkt UDP nicht streng ein

## Bezug zu NodeNanny

Der Backup-Node-Pool von NodeNanny parst Abo-Links für all diese
Protokolltypen (einschließlich der Unterschiede bei protokollinternem
base64/JSON-Format). Die dreistufige Filterung (Erreichbarkeit/Geschwindigkeit/
Echtheit) behandelt alle Protokolle gleich, ohne Unterschiede je nach
Protokolltyp zu machen — hat eine bestimmte Protokollart dauerhaft eine
niedrige Erfolgsrate, liegt das meist daran, dass das Protokoll selbst in
deiner konkreten Netzwerkumgebung nicht gut funktioniert, nicht an einem
Fehler in der NodeNanny-Prüflogik.
