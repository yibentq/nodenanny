---
title: "Glossar: die Begriffe, an denen Neulinge sich die Zähne ausbeißen"
summary: Airport, Node, Verbrauchsmultiplikator, Relay, Landing, Standleitung, Residential-IP ... nach dieser Seite solltest du den Chats der Community folgen können
order: 1
updated: 2026-07-31
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

**Was Proxy-Client-Software eigentlich ist**
"Proxy-Software" (Clash, V2rayN, Shadowrocket, sing-box usw.) ist ein Programm, das
sich darauf spezialisiert, "gemäß den Regeln eines Protokolls mit Servern zu
kommunizieren". Man kann es sich als eine Art dedizierten Dolmetscher und Dispatcher
vorstellen: Es weiß, wie man über Shadowsocks/VMess/VLESS/Trojan mit einem Server
"spricht" und einen verschlüsselten Tunnel aufbaut, und es fängt außerdem die
Netzwerkanfragen ab, die von jeder anderen App auf deinem Handy oder Computer kommen —
die, die über den Proxy laufen sollen, schickt es in den Tunnel, alles andere lässt es
direkt durch. Du musst selbst keine Protokolldetails verstehen; all das erledigt der
Client im Hintergrund.

**Warum das Einfügen eines Abo-Links einfach funktioniert**
Für Node-Informationen (Serveradresse, Port, Verschlüsselungsmethode, Schlüssel usw.)
gibt es eine branchenweit übliche Standardschreibweise, etwa `vmess://eine-lange-
kodierte-Zeichenkette`, `ss://eine-lange-kodierte-Zeichenkette`,
`trojan://eine-lange-kodierte-Zeichenkette` — im Grunde werden all diese Parameter zu
einer einzigen Textzeile zusammengepackt. Wenn du den "Abo-Link" eines Anbieters (oder
deines eigenen Nodes) öffnest, bekommst du in der Regel einen ganzen Stapel solcher
Links zurück (Base64-kodiert, sieht also nach Kauderwelsch aus). Client-Apps erkennen
dieses Standardformat: Sobald sie den Abo-Link einlesen, parsen sie automatisch diese
Parameter, ordnen sie korrekt an und erzeugen eine vollständige, sofort einsatzbereite
Konfiguration — deshalb reicht "Link kopieren → in die App einfügen → verbinden
antippen", ohne dass du je selbst eine Serveradresse oder einen Port eintippen musst.

Genau weil dieses Format standardisiert und herstellerübergreifend kompatibel ist,
können so viele verschiedene Clients — Clash, V2rayN, Shadowrocket — gleichzeitig
existieren: Denselben `vmess://`-Link kann im Prinzip der Großteil der Clients
erkennen und importieren, nur die Oberfläche und die Zusatzfunktionen
(Routing-Regeln, wie viele Protokolle unterstützt werden) unterscheiden sich. Das ist
auch der Grund, warum ein Client manchmal ein Abo "nicht erkennt" — meist, weil man
ein clientspezifisches Erweiterungsformat bekommen hat (etwa Clashs YAML-Konfiguration)
statt des universellen Einzel-Node-Link-Formats. Am Abo selbst liegt es dabei in der
Regel nicht.

**Und dann gibt es noch einen "narrensicheren" Fall: App öffnen, einmal antippen, fertig**
Diese Art App ist besonders auf Android verbreitet (vor allem APKs, die über Foren oder
Cloud-Speicher-Links geteilt werden, nicht unbedingt aus einem App Store). Kennzeichnend
ist, dass du überhaupt keinen Abo-Link einfügst und auch keinerlei Serverparameter zu
sehen bekommst — du öffnest die App, es gibt einen "Ein-Tipp-Verbinden"-Button, und ein
Tippen darauf stellt die Verbindung her. In Zusammenstellungen inländischer
Verwaltungsstrafverfahren rund um Umgehungssoftware taucht genau diese Art "sofort
einsatzbereiter" App (Lantern, Kuailian, Kuaimiao und ähnliche) wiederholt als einer der
häufigen Typen auf — das spricht dafür, dass es sich keineswegs um ein Nischenphänomen
handelt.

Der Mechanismus dahinter hat nichts mit dem Einfügen eines Abo-Links zu tun. Hinter
dieser Art App steht meist eine Reihe von Servern, die der Entwickler selbst langfristig
betreibt; Serveradresse und Kontoinformationen sind bereits bei der Installation fest in
die App eingebacken (manchmal direkt ins Installationspaket gepackt, manchmal fragt die
App beim Start automatisch beim eigenen "Dispatch-Server" des Entwicklers einen
verfügbaren Node an — der ganze Vorgang läuft im Hintergrund ab, für dich unsichtbar) —
womit der Schritt "Nutzer sucht selbst einen Node und importiert ein Abo" komplett
entfällt.

Dass diese Art App auf Android häufiger vorkommt, liegt hauptsächlich daran, dass
Android es erlaubt, eine APK direkt am App Store vorbei zu installieren ("Sideloading"),
mit einer viel niedrigeren Hürde als bei iOS. Apples App-Store-Review ist bei solchen
Tools deutlich strenger, weshalb die meisten vergleichbaren Apps es gar nicht erst in
den Store schaffen — weshalb bei iOS-Nutzern eher das Muster "Client herunterladen +
eigenes Abo suchen" vorherrscht.

Worauf man bei dieser Art App achten sollte, dazu ein paar belastbare Zahlen:

- Eine 2026 auf dem NDSS Symposium (Network and Distributed System Security Symposium)
  vorgestellte Studie hat mit einem selbst entwickelten automatisierten Framework 281
  kostenlose Android-VPN-/Beschleuniger-Apps geprüft, mit zusammen über 2,4 Milliarden
  Installationen. Ergebnisse: 5 Apps hatten eine "Tunnel-Hijacking"-Schwachstelle
  (Node-Konfigurationsdateien wurden unverschlüsselt heruntergeladen, sodass ein
  Angreifer im selben WLAN die Datei abfangen und manipulieren konnte, um deine
  Verbindung heimlich auf einen von ihm kontrollierten Server umzuleiten, während die
  App-Oberfläche weiterhin normal "verbunden" anzeigte); 24 Apps leakten DNS-Anfragen
  (was bedeutet, dass dein Carrier trotz verschlüsseltem Traffic weiterhin sehen kann,
  welche Seiten du besucht hast) — betrifft rund 360 Millionen Installationen; und
  246 der 281 Apps (über 87 %) kontaktierten Werbe- oder Tracking-Dienste, manche
  übertrugen sogar die genaue GPS-Position des Geräts. Die Forscher wiesen ausdrücklich
  darauf hin, dass ein "Verifiziert"-Badge in einem App Store kein Beleg dafür ist,
  dass eine App eine umfassende Sicherheitsprüfung durchlaufen hat.
- Bei einem Dienst, der komplett kostenlos ist und weder Datenlimit noch
  Geschwindigkeitsdrosselung kennt, ist meist unklar, woher die Betriebskosten kommen —
  übliche Monetarisierungswege sind eingeblendete Werbung, das Sammeln von
  Geräteinformationen für gezielte Werbung, seltener auch das Bündeln anderer Software
  bei der Installation.
- Die Warnung des chinesischen Ministeriums für Staatssicherheit vom November 2025
  (siehe [Überblick über die inländische Internetregulierung in China](../04-compliance-and-risk/overview)) merkte ebenfalls an, dass manche Umgehungssoftware
  von ausländischen Akteuren kontrolliert oder sogar direkt von ausländischen
  Nachrichtendiensten entwickelt und betrieben wird, mit heimlich eingebetteter
  Malware. Es gab Fälle, in denen Mitarbeiter geheimhaltungspflichtiger Stellen
  versehentlich solche Software installierten, was dazu führte, dass ihre Geräte
  ferngesteuert und Unterlagen gestohlen wurden — das ist keine Panikmache, sondern ein
  realer Falltyp aus einer offiziellen Mitteilung.
- Im Vergleich zu einem Modell, bei dem "du selbst weißt, wem der Server gehört"
  (selbst gehosteter Node, oder ein Anbieter mit klarem Ruf und transparenter Herkunft)
  hängt die Vertrauenswürdigkeit dieser Art "Blackbox"-App vollständig vom Entwickler
  selbst ab. Je undurchsichtiger die Informationslage, desto vorsichtiger sollte man
  die Herkunft bewerten — eine hohe Downloadzahl oder eine seriös wirkende Oberfläche
  allein sollte man nicht als Sicherheitsbeweis werten.

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
