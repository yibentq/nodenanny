---
title: "Leitungstypen erklärt: Direktverbindung / Relay / IPLC / IEPL-Standleitung"
summary: Diese Begriffe beschreiben, "welchen Weg der Traffic aus dem Inland ins Ausland nimmt" — eine andere Dimension als das Protokoll
order: 1
updated: 2026-07-22
tags: [Grundlagen, Standleitung, Relay, IPLC, IEPL]
---

## Diese Seite handelt vom "Weg", nicht vom "Fahrzeug"

Die vorige Seite über Protokolle (vmess/vless/trojan ...) entspricht in etwa
der Bauart des Fahrzeugs selbst; diese Seite über Leitungstypen entspricht
der Frage, ob dieses Fahrzeug auf einer gewöhnlichen Landstraße oder einer
eigenen Autobahn unterwegs ist — beide Dimensionen sind unabhängig
voneinander, auf derselben Leitung können Nodes mit unterschiedlichen
Protokollen laufen.

## Direktverbindung (Direct)

Der Traffic geht von deinem Netzwerkausgang direkt zum ausländischen Server,
ohne über eine speziell aufgebaute Relay-Infrastruktur zu laufen. Vorteil:
einfacher Aufbau, geringe Kosten. Nachteil: vollständig der gewöhnlichen
internationalen Ausgangsleitung ausgesetzt, ohne Puffer bei
Netzwerkschwankungen oder gezielten Einschränkungen — die Stabilität ist
vergleichsweise gering.

## Relay

Zuerst wird im Inland ein Relay-Server eingerichtet, der Traffic wird
verschlüsselt zu dieser Maschine übertragen und von dort zum ausländischen
Landing-Server weitergeleitet. Im Vergleich zur Direktverbindung gibt es eine
zusätzliche "Pufferschicht" — verschlechtert sich die Qualität einer Leitung,
gibt es mehr Spielraum zum Wechseln. Die Stabilität ist in der Regel besser
als bei reiner Direktverbindung und ist derzeit der gängigste Kompromiss für
Einzelpersonen und kleinere Szenarien.

## IPLC (International Private Leased Circuit)

Eine von Telekommunikationsanbietern bereitgestellte Punkt-zu-Punkt-
Standleitung, die nicht mit öffentlichem Traffic um Bandbreite konkurriert —
die Ressourcen sind relativ eigenständig. Merkmale: hohe Stabilität, niedrige
Latenz, dafür hohe Kosten und wenig Flexibilität bei der
Bandbreitenerweiterung.

## IEPL (International Ethernet Private Line)

Ebenfalls eine von Anbietern bereitgestellte Standleitung, basierend auf
Ethernet-Technologie. Im Vergleich zu IPLC in der Regel flexibler bei
Bandbreitenanpassungen und potenziell günstiger — das konkrete
Preis-Leistungs-Verhältnis beider hängt jedoch von der Qualität der Ressourcen
ab, die der Anbieter erhält, und lässt sich nicht allein am Namen ablesen.

## Wie sich diese Typen zueinander verhalten

Grob geordnet nach "Grad der Exponiertheit von hoch nach niedrig, Kosten von
niedrig nach hoch": Direktverbindung < gewöhnliches Relay < IPLC/IEPL-
Standleitung. Zu beachten ist aber: Dienste, die als "Standleitung" beworben
werden, haben in der Praxis sehr unterschiedliche Leitungsqualität — der Name
allein garantiert keine Erfahrung. Für die konkrete Bewertung eines Anbieters
gelten die Auswahlhinweise in der Kategorie "Airport & VPN Wiki", hier geht
es nur um die Bedeutung der Begriffe selbst.

## Bezug zu selbst betriebenen Nodes (z. B. deinem mit NodeNanny verwalteten Node)

Betreibst du selbst einen VPS als Node (statt einen kommerziellen Airport-
Dienst zu nutzen), läuft dein Node höchstwahrscheinlich über die
grundlegendste Variante — die "Direktverbindung" —, es sei denn, du hast
zusätzlich separat einen Relay- oder Standleitungsdienst für den Zugang zu
deinem selbst gehosteten Server gebucht. Das ist auch ein Grund, warum der
Backup-Node-Pool von NodeNanny auf Redundanz aus mehreren unterschiedlichen
Quellen mit unterschiedlichen Vertrauensstufen setzt: Gerät die
Netzwerkumgebung eines direkt verbundenen, selbst gehosteten Nodes in
Schwierigkeiten, fallen die Schwankungen im Erlebnis geringer aus, wenn im
Backup-Pool Nodes mit Relay- oder Standleitungsanbindung einspringen können.
