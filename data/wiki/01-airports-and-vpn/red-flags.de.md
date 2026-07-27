---
title: "Warnsignale: Anzeichen für einen bevorstehenden Exit-Scam und ein paar Behauptungen, die man nüchtern betrachten sollte"
summary: "\"Airport verschwindet mit dem Geld\" ist in dieser Community ein häufiges Thema — wer die Anzeichen kennt, tappt seltener in die Falle"
order: 4
updated: 2026-07-23
tags: [Fallen, Exit-Scam, Anfänger]
---

## Häufige Anzeichen vor einem Exit-Scam

Dass ein Airport-Betreiber mit dem Geld verschwindet oder der Dienst ohne
Vorwarnung eingestellt wird, ist in dieser Branche keine Seltenheit — die Gründe
sind vielfältig: bewusster Betrug, Kündigung der Upstream-Leitung, nicht mehr
tragbare Kosten oder sogar rechtliche Probleme des Betreibers. Bei folgenden
Situationen ist erhöhte Vorsicht angebracht:

- **Plötzliche Jahres-/Langzeittarife weit unter dem üblichen Preis, gefolgt von
  aggressivem Marketing und kurz darauf spürbar sinkender Servicequalität**
  Das ist eines der klassischsten Muster: erst mit niedrigen Preisen eine Welle
  von Nutzern anlocken und Vorauszahlungen einsammeln, dann nach Verschlechterung
  des Dienstes verschwinden. Je übertriebener der Rabatt (z. B. Jahrespreis unter
  30 % des Normalpreises), desto deutlicher das Warnsignal.
- **Die offizielle Website ist zeitweise oder dauerhaft nicht erreichbar**
- **In der Community (z. B. Telegram-Gruppen) tauchen plötzlich viele unmoderierte
  Werbe-Bots auf**
  Das deutet meist darauf hin, dass der Betreiber die tägliche Pflege bereits
  aufgegeben hat.
- **Gefälschte offizielle Websites oder gefälschte Support-Konten tauchen auf**
  Vor und nach einem Exit-Scam kommt es häufig zu Phishing-Versuchen — gefälschte
  "neue Adressen", die angeblich offiziell sind, um Kontodaten oder eine zweite
  Zahlung zu erschleichen. Die Echtheit offizieller Ankündigungen sollte über
  mehrere unabhängige Kanäle gegengeprüft werden, verlass dich nicht auf eine
  einzige Quelle.
- **Halb-Exit-Scam-Zustand**: Die Website ist noch erreichbar, Aufladungen sind
  noch möglich, aber der Dienst selbst ist faktisch dauerhaft unbrauchbar. Das ist
  tückischer als ein vollständiges Verschwinden, weil man leicht in der Hoffnung
  verlängert, es könnte sich noch bessern.

## Ein paar einfache Prinzipien, um das Risiko zu senken

- **Bevorzuge Dienste mit längerer Betriebsdauer** — wer ein, zwei Jahre
  Branchenschwankungen überstanden hat, hat damit selbst schon eine Art
  Nachweis erbracht.
- **Monatlich zahlen, wenn möglich, statt jährlich** — ein Jahrestarif wirkt
  günstiger, setzt aber im Grunde das Risiko eines ganzen Jahres auf die eine
  Annahme, dass der Anbieter nicht zwischendurch verschwindet.
- **Sei vorsichtig bei Tarifen, die deutlich unter dem branchenüblichen Niveau
  liegen** — besonders bei der Kombination "niedriger Preis + unbegrenztes
  Datenvolumen" hält die dahinterliegende Geschäftslogik oft nicht stand.

## Ein paar Behauptungen, die man nüchtern betrachten sollte

**"Globaler Proxy-Modus ist am sichersten"**
Genau das Gegenteil ist meist der Fall: dauerhaft aktivierter globaler Modus
bringt in der Regel mehr Nachteile als Vorteile — der Zugriff auf inländische
Websites wird langsamer (der Traffic macht einen Umweg über das Ausland und
zurück), Datenvolumen wird unnötig verbraucht, und manche inländischen
Websites/Apps lösen bei Zugriffen von einer ausländischen IP zusätzliche
Sicherheitsprüfungen aus. Für den Alltag wird ein regelbasierter Split-Modus
empfohlen, bei dem inländischer Traffic direkt läuft und nur ausländischer
Traffic über den Proxy geht.

**"Der Airport kann alle meine Daten einsehen"**
Der Airport kann sehen, welche Domains du aufrufst, ungefähr wann und wie viel
Traffic dabei anfällt — vergleichbar mit dem, was auch dein regulärer
Internetanbieter sieht. Solange die Zielseite jedoch HTTPS verwendet (heute bei
den allermeisten Websites der Fall), kann der Airport weder den konkreten
Seiteninhalt noch eingegebene Zugangsdaten einsehen. Dieses Verständnis hilft
einzuschätzen, welche Aktionen über einen Airport-Node sinnvoll sind und welche
nicht — z. B. wird davon abgeraten, Bank- oder Behördenkonten über einen
unbekannten Airport-Node zu nutzen.

**Kostenlose Airports erfordern besondere Vorsicht**
Hinter jedem kostenlosen Dienst muss irgendjemand die Kosten tragen — ein
dauerhaft kostenloser und gleichzeitig stabiler Dienst ist selten. Wenn du
tatsächlich einen kostenlosen Node zur Überbrückung im Notfall nutzen willst
(genau dafür hat der Backup-Node-Pool von NodeNanny zusätzliche technische
Prüfungen eingebaut, siehe [Was ist NodeNanny](../02-nodenanny-guide/overview)),
eignet er sich eher als "kurzfristige Notlösung" als als dauerhafte Hauptquelle.

**Ein praktischerer Ansatz zum Thema Privatsphäre**
Statt sich an einer einzelnen Kennzahl (etwa der sogenannten "IP-Reinheit")
festzubeißen, ist es sinnvoller: keine hochsensiblen Konten über unbekannte
Dienste zu betreiben, sich nicht dauerhaft auf eine einzige kostenlose Quelle
zu verlassen, und einen "Airport" auf einer ähnlichen Vertrauensebene zu
behandeln wie deinen regulären Internetanbieter — nicht als absolut sichere
Blackbox.
