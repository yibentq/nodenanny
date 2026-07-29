---
title: "Vertiefte Netzwerk- und Kryptografie-Grundlagen: TLS, AEAD und Traffic-Fingerprinting"
summary: Vertiefung zu protocols-overview.md, die das "Warum" hinter TLS-Handshakes, AEAD-Verschlüsselung und DPI-Traffic-Fingerprinting erklärt — theorielastig und vergleichsweise wenig anfällig zu veralten
order: 2
updated: 2026-07-28
tags: [tls, verschluesselung, dpi, grundlagen]
---


> Dieser Artikel ist eine Vertiefung zu protocols-overview.md und behandelt das "Warum": konkret, wie DPI Traffic tatsächlich identifiziert und woher die Erkennungsresistenz der einzelnen Protokolle kommt. Der Inhalt ist eher theoretisch und vergleichsweise stabiles Grundlagenwissen — seine Richtigkeit veraltet nicht so schnell wie eine konkrete Protokollliste oder Erkennungsraten-Zahlen.

## Was ein TLS-Handshake grob macht

Ob man eine gewöhnliche Website besucht oder ein "als TLS getarntes" Proxy-Protokoll wie Reality/AnyTLS nutzt — der TLS-Handshake löst in beiden Fällen dasselbe Problem: **Wie können sich ein sich unbekannter Client und Server über ein unsicheres Netzwerk auf einen Verschlüsselungsschlüssel einigen, den nur beide kennen, und dabei auch noch die Identität der Gegenseite verifizieren?** Vereinfachter Ablauf:

1. Der Client sendet ein ClientHello mit der Liste unterstützter Cipher-Suiten, einer Zufallszahl und der gewünschten Domain (das SNI-Feld — dieser Schritt erfolgt im Klartext und war auch einer der zentralen Ansatzpunkte, über die die frühe GFW nach Domain blockierte)
2. Der Server antwortet mit einem ServerHello, wählt eine Cipher-Suite, legt ein Zertifikat zum Identitätsnachweis vor und fügt ebenfalls eine Zufallszahl hinzu
3. Beide Seiten berechnen anhand dieser beiden Zufallszahlen plus einem Schlüsselaustauschalgorithmus (heute üblicherweise ECDHE) unabhängig voneinander denselben Sitzungsschlüssel, wobei der Schlüssel selbst nie über das Netzwerk übertragen wird
4. Alle nachfolgenden Anwendungsdaten werden mit diesem Sitzungsschlüssel verschlüsselt übertragen

Die Kernidee des Reality-Protokolls besteht darin, das TLS-Zertifikat und die Handshake-Merkmale einer echten Website zu "entleihen", sodass die GFW beim aktiven Sondieren keinen Unterschied zu einem tatsächlichen Besuch dieser echten Website erkennt. AnyTLS verpackt stattdessen beliebigen Proxy-Traffic in eine Standard-TLS-Recordschicht — konzeptionell dieselbe Art von "Tarnung", nur mit anderen Implementierungsdetails.

## Was AEAD-Verschlüsselung konkret schützt

Aktuelle mainstream Proxy-Protokolle (VMess, Shadowsocks-2022, die Datenschicht von Trojan usw.) verwenden alle AEAD-Verschlüsselung (Authenticated Encryption with Associated Data), üblicherweise AES-GCM oder ChaCha20-Poly1305. AEAD erfüllt gleichzeitig zwei Aufgaben:

- **Vertraulichkeit**: Nach der Verschlüsselung lässt sich der Inhalt ohne Schlüssel nicht lesen
- **Integrität/Authentizität**: Jedes Chiffretext-Segment trägt ein Authentifizierungs-Tag, mit dem der Empfänger verifizieren kann, dass diese Daten "tatsächlich von der Partei mit dem korrekten Schlüssel erzeugt und unterwegs nicht manipuliert wurden" — sendet die GFW beim aktiven Sondieren gefälschte/manipulierte Daten, schlägt die AEAD-Prüfung fehl und die Verbindung wird sofort abgebrochen. Dies ist auch ein natürliches Hindernis, auf das die Angriffstechnik "aktives Sondieren" selbst stößt.

Das erklärt auch, warum manche frühen Protokolle ohne Authentifizierung (oder mit unzureichend strenger Authentifizierung) leicht per "aktivem Sondieren" identifizierbar waren — die sondierende Seite schickt fehlerhaft geformte Pakete und beobachtet das Antwortmuster des Servers, was allein schon die Protokollcharakteristik offenlegt.

## Wie DPI konkret "erkennt", dass es sich um Proxy-Traffic handelt

Da der Traffic selbst bereits verschlüsselt ist und sein Inhalt nicht direkt gelesen werden kann, stützt sich DPI hauptsächlich auf statistische Merkmale statt auf den Inhalt selbst. Gängige Analysedimensionen sind:

- **Paketlängenverteilung**: Handshake- und Kontrollpakete unterschiedlicher Protokolle haben oft regelmäßige Größen; Verschlüsselung kann diese Regelmäßigkeit nicht vollständig verdecken, sofern das Protokoll nicht selbst aktives Length-Padding vornimmt
- **Zeitintervall-Merkmale**: Der Rhythmus von Heartbeat-/Keep-Alive-Paketen unterscheidet sich zwischen Proxy-Software und einem gewöhnlichen Browser
- **Entropieanalyse**: Wirklich zufällige verschlüsselte Daten haben eine Entropie nahe dem theoretischen Maximum; zeigt der Chiffretext eines Protokolls an bestimmten Byte-Positionen ein nicht-zufälliges, festes Muster (ein früher Designfehler des Protokolls), lässt sich das statistisch erfassen
- **Fingerprint-Abgleich der ersten Pakete**: Viele Protokolle haben in den ersten Paketen des Verbindungsaufbaus eine feste Struktur (selbst bei verschlüsseltem Inhalt können Länge und Reihenfolge unverändert bleiben)
- **Aktives Sondieren**: Wird vermutet, dass eine bestimmte IP einen Proxy-Dienst betreibt, verbindet man sich direkt und beobachtet, wie der Server reagiert — unterscheidet sich das Antwortverhalten von einer normalen HTTPS-Website (z. B. anders ausfallende Handshake-Fehler, andere Reaktion auf fehlerhafte Anfragen), kann dies markiert werden

Das Verständnis dieser Ebene erklärt den Mechanismus hinter der Schlussfolgerung in protocols-overview.md, "warum TLS-Tarnprotokolle erkennungsresistenter sind": Das Ziel von Protokollen wie Reality/AnyTLS ist es, all diese Dimensionen (Paketlänge, Handshake-Struktur, Reaktion auf aktives Sondieren) so nah wie möglich an eine echte Website anzugleichen — nicht nur die Verschlüsselung selbst. **Verschlüsselung löst die Frage, "ob der Inhalt lesbar ist"; Fingerprint-Resistenz löst die Frage, "ob das Verhaltensmuster verdächtig wirkt" — das sind zwei unterschiedliche Ebenen des Problems, und ein Protokoll, das gut verschlüsselt, ist damit nicht automatisch erkennungsresistent.**

## Warum dieser Inhalt vergleichsweise wenig anfällig für Veralten ist

Der Ablauf des TLS-Handshakes, die Designziele von AEAD und die Tatsache, dass DPI auf statistischen Merkmalen statt auf Inhalten beruht, sind vergleichsweise stabile Grundtatsachen der Kryptografie und der Netzwerkprotokolle, die nicht durch ein einzelnes technisches Upgrade kurzfristig insgesamt veralten. Was sich tatsächlich ändert und regelmäßiger Überprüfung bedarf, sind anwendungsseitige Schlussfolgerungen wie "welches konkrete Protokoll aktuell besser oder schlechter erkennungsresistent ist" oder "die konkreten Erkennungsraten-Zahlen der GFW" — dafür bitte protocols-overview.md konsultieren, nicht diesen Artikel.
