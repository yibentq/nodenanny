---
title: Tägliche Nutzung
summary: Was im Panel zu sehen ist und wie man eine eigene Abo-Quelle manuell hinzufügt
order: 2
updated: 2026-07-22
tags: [Nutzung, Panel]
---

## Was auf der Panel-Startseite zu sehen ist

- **Status des selbst gehosteten Nodes**: ob dein eigener Proxy-Dienst läuft,
  zusammen mit einer Statistik zur Uptime unten
- **Abo-Adresse**: NodeNanny erzeugt selbst einen "Smart-Abo"-Link, den der
  Client nur einmal abonnieren muss — läuft der eigene Node normal, liefert er
  echte Nodes; ist der eigene Node gestört und es gibt nutzbare Nodes im
  Backup-Pool, schaltet er automatisch auf Backup-Inhalte um, ohne dass du den
  Abo-Link manuell wechseln musst
- **Backup-Node-Pool / Sternenkarten-Ansicht**: welche Quellen aktuell im
  Backup-Pool sind, der Vertrauensstatus jeder Quelle (in Testphase/vertraut/
  gesperrt), Anzahl der Nodes

## Eine eigene, vertrauenswürdige Abo-Quelle manuell hinzufügen

Hast du selbst einen stabilen Abo-Link (egal ob ein separat gekaufter Airport
oder von einem Freund geteilt) und möchtest ihn ebenfalls im Backup-Pool
nutzen, führt der Weg über "manuelle Quellen". Auch neu hinzugefügte Quellen
durchlaufen die Testphase — manuell hinzugefügt zu werden überspringt die
Vertrauensstufen nicht:

```bash
cat <<'EOF' | node
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('config/config.json', 'utf-8'));
const newSources = [
  { id: 'Kurzkennung für diese Quelle', name: 'Anzeigename', url: 'Abo-Link' }
];
for (const s of newSources) {
  if (!config.pool.manualSources.some(x => x.id === s.id)) {
    config.pool.manualSources.push(s);
  }
}
fs.writeFileSync('config/config.json', JSON.stringify(config, null, 2));
console.log('Geschrieben:', config.pool.manualSources.map(s => s.id));
EOF
pm2 restart nodenanny-pool
```

Ein Heredoc mit einem JS-Skript wird verwendet statt `sed`/`echo` zum
Zusammenbauen von JSON, um zu vermeiden, dass beim manuellen Bearbeiten von
JSON leicht ein Komma fehlt oder zu viel ist und dadurch die gesamte
Konfigurationsdatei nicht mehr geparst werden kann — dieser Ansatz wurde im
Projekt bereits wiederholt verifiziert.

Nach dem Hinzufügen läuft die Quelle erst eine Weile im Status "Testphase";
die Echtzeit-Erfolgsrate ist in der Sternenkarten-Ansicht des Panels sichtbar,
ohne dass du weiter eingreifen musst.

## Wann sich ein Blick in "Netzwerk-/Protokoll-Grundlagenwissen" lohnt

Fällt dir auf, dass eine bestimmte Node-Art (z. B. ein bestimmtes Protokoll)
dauerhaft eine niedrige Erfolgsrate hat, obwohl die Abo-Quelle selbst
einwandfrei ist, liegt das Problem meist an einer Wissenslücke auf
Protokollebene, nicht an einer falschen NodeNanny-Konfiguration — in diesem
Fall lohnt sich ein Blick in die Kategorie "Netzwerk-/Protokoll-
Grundlagenwissen" für die Erklärung des jeweiligen Protokolls. Dort geht es um
die Funktionsweise und typischen Einschränkungen des Protokolls selbst, nicht
um die Bedienung von NodeNanny.
