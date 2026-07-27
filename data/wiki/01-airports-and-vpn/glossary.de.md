---
title: "Glossar: die Begriffe, an denen Neulinge sich die Zähne ausbeißen"
summary: Airport, Node, Verbrauchsmultiplikator, Relay, Landing, Standleitung, Residential-IP ... nach dieser Seite solltest du den Chats der Community folgen können
order: 1
updated: 2026-07-23
tags: [Glossar, Einführung, Anfänger]
---

## Grundbegriffe

**Airport**
Community-Jargon für einen "Proxy-Dienstanbieter" — verkauft wird der Zugang zu einer
Reihe von Server-Nodes, meist monatlich oder nach Datenvolumen abgerechnet. Hat nichts
mit echten Flughäfen zu tun, der Begriff hat sich einfach so eingebürgert.

**Node**
Ein Server, der deinen Traffic für dich weiterleitet, meist nach Region benannt (z. B.
"HK-01", "US-02"). Ein einzelner Anbieter bietet meist mehrere — manchmal Dutzende
oder Hunderte — Nodes gleichzeitig an.

**Abo-Link (Subscription Link)**
Eine URL, die kodiert, "welche Nodes dieser Account nutzen darf". Clients (Clash,
Shadowrocket usw.) importieren diesen Link und ziehen die Node-Liste automatisch, statt
Nodes einzeln hinzufügen zu müssen. Der Link enthält meist ein Identifikationstoken,
das faktisch einem Passwort entspricht — leite ihn nicht leichtfertig weiter.

**Verbrauchsmultiplikator (Rate Multiplier)**
Keine Geschwindigkeitsangabe — es ist ein **Multiplikator für den Datenverbrauch**.
Bei einem 100-GB-Plan und einem Node mit 3-fachem Multiplikator werden beim Streamen
von 10 GB Video tatsächlich 30 GB abgezogen. Nodes mit höherem Multiplikator laufen
meist auf teureren Leitungen (z. B. Standleitungen); Anbieter nutzen den Multiplikator,
um die realen Kostenunterschiede zwischen Leitungen auszugleichen.

## Leitungstypen

**Direktverbindung**
Dein Gerät verbindet sich direkt mit dem Server des Anbieters im Ausland; der Traffic
läuft die ganze Strecke über das öffentliche Internet. Am einfachsten aufgebaut und
meist am günstigsten, aber die Erfahrung während Stoßzeiten hängt vollständig davon
ab, wie es gerade um die Netzbedingungen des Carriers steht.

**Relay**
Der Traffic erreicht zuerst einen inländischen Server des Anbieters, der ihn
verschlüsselt an einen "Landing"-Server im Ausland weiterleitet, der dann die
Zielseite erreicht. Ein Relay-Server kann für das Routing optimiert werden und
kommt in der Regel besser mit Zensur zurecht als eine Direktverbindung — heute der
gängigste Ansatz.

**Landing**
Der Server im Ausland am Ende einer Relay-Kette, der tatsächlich für den Zugriff aufs
offene Internet zuständig ist. Hinter einem einzigen Relay-Einstiegspunkt können
mehrere Landing-Nodes in unterschiedlichen Regionen hängen.

**Standleitung (IPLC / IEPL)**
IPLC (International Private Leased Circuit) und IEPL (International Ethernet Private
Line) sind beides "dedizierte Kanäle", die von Carriern bereitgestellt werden — der
Traffic läuft nicht über den internationalen Ausgangspunkt des öffentlichen Internets
und ist daher theoretisch nicht von Zensur oder Drosselung an diesem Ausgang betroffen.
Technisch unterscheiden sich beide, aber für den durchschnittlichen Nutzer ist der
Unterschied kaum spürbar; "Standleitung" ist als Sammelbegriff völlig ausreichend. Das
prägende Merkmal einer Standleitung ist der Preis — echte Standleitungsbandbreite ist
teuer, wenn ein Plan also deutlich unter dem liegt, was etablierte
Standleitungsanbieter verlangen, ist er wahrscheinlich nicht das, was er vorgibt zu
sein.

**CN2 / CN2 GIA / BGP**
Eine weitere Gruppe von Begriffen rund um die Routenoptimierung inländischer Carrier,
meist verwendet, um zu beschreiben, "über welche Leitung der Abschnitt vom Inland zum
Landing-Punkt läuft". Man muss die Details nicht auswendig lernen — verstehe es grob
als "verschiedene Leitungsstufen, die Carrier anbieten". Der praktische Unterschied
für den Alltag (Streaming, Surfen) ist meist viel geringer, als Marketingtexte
suggerieren.

## IP-bezogene Begriffe

**Residential-IP**
Eine IP-Adresse, die einem gewöhnlichen Privathaushalt mit Breitbandanschluss
zugewiesen wurde; manche Lookup-Tools kennzeichnen sie als "Residential". Manche
Plattformen (bestimmte Streaming-Dienste, streng kontrollierte Seiten) blockieren
Rechenzentrums-IPs strenger, weshalb Residential-IPs seltener geblockt werden — daher
bewerben Anbieter sie oft als Verkaufsargument.

**Rechenzentrums-IP (DCH)**
Eine IP aus einem Rechenzentrum / Serverfarm — das ist die tatsächliche Identität der
allermeisten Anbieter-Nodes.

**Warum man "Residential"-Behauptungen skeptisch gegenüberstehen sollte**
Echtes ausländisches Residential-Breitband unterliegt strengen Beschränkungen, wem es
zugewiesen wird und wofür es genutzt werden darf — ein "Großhandel" an Anbieter ist
daher praktisch unmöglich. Viele beworbene "US Residential"- oder "Japan
Residential"-IPs erweisen sich bei genauerer Prüfung als gar keine echten
Residential-Adressen. Einen groben Anhaltspunkt liefert das Feld "Usage Type" bei
Lookup-Tools wie ip2location (ip2location.com), aber kein einzelnes Tool ist
maßgeblich — Gegenprüfen und der Node selbst zählt mehr als eine fixe Zahl.

## Client- und Konfigurationsbegriffe

**Regel-Modus (Rule)**
Der Traffic wird automatisch anhand von Regeln in der Konfiguration geroutet:
inländische Seiten laufen direkt, ausländische über den Proxy — kein manuelles
Umschalten nötig. Dies ist die empfohlene Standardeinstellung für den Alltag.

**Global-Modus**
Der gesamte Traffic — einschließlich inländischer Seiten — läuft über den Proxy.
Es wird generell nicht empfohlen, diesen Modus dauerhaft aktiv zu lassen; siehe
[Warnsignale](./red-flags) für die Gründe.

**TUN-Modus / Systemproxy**
Zwei Wege, den Proxy den Traffic des Geräts "übernehmen" zu lassen. Der Systemproxy
deckt nur Software ab, die die Systemproxy-Einstellungen respektiert (die meisten
Browser, manche Apps); der TUN-Modus erstellt einen virtuellen Netzwerkadapter mit
viel breiterer Abdeckung, einschließlich Spielen und Kommandozeilentools, die den
Systemproxy nicht befolgen.

**DNS-Leck**
Selbst wenn dein eigentlicher Traffic über einen verschlüsselten Proxy läuft, kann
dein Carrier trotzdem sehen, welche Seiten du besucht hast, wenn die
DNS-Namensauflösung nicht durch denselben Tunnel läuft — der Inhalt ist verschlüsselt,
aber das "Ziel" wird sichtbar. Eine gut gebaute Abo-Konfiguration kümmert sich meist
bereits um diese Ebene, sodass du dir separat keine Gedanken machen musst.

## Was das mit NodeNanny zu tun hat

Die meisten der obigen Begriffe sind Konzepte unterhalb des "Airport"-Geschäftsmodells.
NodeNanny selbst **ist kein Airport** — es kauft oder verkauft keine Nodes. Das
Protokoll deines eigenen selbst gehosteten Nodes (siehe
[Protokoll-Einführung](../03-network-knowledge/protocols-overview)) und die hier
beschriebenen Leitungstypen sind dieselbe zugrunde liegende Technologie; das
Verständnis dieser Konzepte hilft dir zu beurteilen, welche Art von Leitung dein
eigener Node nutzt und welches Verhalten zu erwarten ist, und es hilft dir außerdem
einzuschätzen, welche Qualität die Backup-Nodes im NodeNanny-Notfallpool (aus
öffentlichen Quellen und jedem selbst hinzugefügten Abo) ungefähr haben, wenn du sie
tatsächlich brauchst.
