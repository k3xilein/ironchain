```markdown

```

---

## 🆕 Wichtige Ergänzungen (STARTING_SOL, Logging, Headless-Betrieb)

Diese Sektion beschreibt neue Umgebungsvariablen und das Verhalten beim Starten des Bots — speziell relevant für Paper-Trading und automatisierte Server-Deployments.

### STARTING_SOL (Paper Mode)

- Zweck: Lege die anfängliche SOL-Balance fest, wenn du im Paper-Modus (simuliertes Trading) startest.
- Nutzung: Setze die Variable in deiner Shell, in der `.env` Datei oder exportiere sie vor dem Start.

Beispiele:

```bash
# temporär für die Session
export STARTING_SOL=1.5

# oder in .env
echo "STARTING_SOL=1.5" >> .env
```

Verhalten:
- Wenn `STARTING_SOL` gesetzt ist, wird dieser Wert beim Initialisieren des `PaperExecutor` verwendet.
- Wenn `STARTING_SOL` nicht gesetzt ist und der Prozess interaktiv (TTY) läuft, fragt der Bot beim Start nach einem Wert.
- Wenn `STARTING_SOL` nicht gesetzt ist und der Prozess nicht interaktiv läuft (z. B. Cron / systemd / PM2), verwendet der Bot `0` SOL als Default, um Blockaden beim Start zu vermeiden.

Tipp: Für automatische Deploys/Server-Starts immer `STARTING_SOL` in der Umgebung oder `.env` setzen.

### Live-Console-Logging

Der Bot schreibt strukturierte Log-Nachrichten für folgende Ereignisse:

- Start jeder Run-Cycle (Debug)
- Analyse für Entries (Info)
- Liquidity- und Indikator-Ergebnisse (Debug)
- Erfolgreiche Ausführungen von Entry/Exit (Info)
- Aktualisierte Balances nach Trades (Info)

Voraussetzung: In deiner Konfiguration sollte Console-Logging aktiviert sein (z. B. `LOG_TO_CONSOLE=true` oder entsprechender Logger-Config). Die Logs werden über die eingebaute `Logger`-Klasse ausgegeben.

Wenn du die Logs dauerhaft speichern möchtest, konfiguriere das Audit-Logging / SQLite database entsprechend (siehe `config/index.ts`).

### Headless / Server-Betrieb

- Empfohlen: setze `STARTING_SOL` in der `.env` oder als Umgebungsvariable.
- Vermeide interaktive Prompts auf Servern — der Bot verwendet in diesem Fall automatisch den Default (0 SOL), um nicht zu blockieren.

## 🧰 Build & Run (lokal / server)

Empfohlene einfache Schritte zum lokalen Testen und zum Start auf einem Server.

1) Abhängigkeiten installieren

```bash
npm install
```

2) TypeScript prüfen (schnell)

```bash
npx tsc --noEmit
```

3) Build

```bash
npm run build
```

4) Start (Production)

```bash
# Live Mode
RUN_MODE=MAINNET_LIVE npm start

# Paper Mode (beachte STARTING_SOL)
RUN_MODE=PAPER_LIVE STARTING_SOL=1.5 npm start
```

5) Dev Mode (ts-node, interaktiv)

```bash
npm run dev:paper
```

Hinweis: Für nicht-interaktive Serverstarts setze `STARTING_SOL` in der Umgebung oder `.env`.

## 🚀 Deployment & Auto-Update auf Linux-Server

Ein einfaches Deploy-Skript (`scripts/deploy_linux_server_bot.sh`) wurde beigefügt, das folgende Schritte ausführt:

- Git fetch + hard reset auf den Remote-Branch (standardmäßig `main`)
- `npm ci` / `npm install`
- `npm run build`
- Neustart des Prozesses (pm2 bevorzugt, fallback `nohup`/`node`)

Cron-Beispiel (prüft jede Minute):

```cron
# m h  dom mon dow   command
* * * * * /home/ironchain/iron-chain/scripts/deploy_linux_server_bot.sh >> /home/ironchain/iron-chain/deploy.log 2>&1
```

Hinweis: Das Skript ist absichtlich konservativ; prüfe und passe es an deine Server-Policies (SSH-Keys, Benutzer, Pfade) an.

## 🧪 Troubleshooting / TypeScript Hinweise

- Falls der TypeScript-Compiler `Cannot find name 'process'` oder `Cannot find type definition file for 'node'` meldet, stelle sicher, dass die Dev-Dependencies installiert sind (`@types/node`) und dass `tsconfig.json` die Node-Typen enthält.

```bash
# Installiere Dev-Dependencies
npm install --save-dev

# Prüfe Node-Typen
npx tsc --noEmit
```

- Fehler beim Starten (z. B. fehlende `.env` Variablen): Kopiere `.env.example` zu `.env` und passe die Werte an.

```bash
cp .env.example .env
# bearbeite .env
nano .env
```

## 📝 Abschluss und Hinweise

Diese Ergänzungen ermöglichen einen robusteren Headless-Betrieb (Server) und vereinfachen das Testen im Paper-Modus durch die `STARTING_SOL`-Variable. Wenn du möchtest, kann ich zusätzlich:

- Ein kurzes Beispielskript hinzufügen, das den Bot für 1-2 Zyklen im Papiermodus startet und die Logs lokal prüft.
- PM2-Startup-Config / systemd-Service-File erstellen und committen.

Sag mir, welche Ergänzung du bevorzugst — ich kann sie direkt implementieren.
# ⛓️ Iron Chain – Solana Trading Bot

**Professioneller Regime-basierter Trading Bot für SOL/USDC**
MADE BY PAUL WITH ♥️

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green)](https://nodejs.org/)
[![Solana](https://img.shields.io/badge/Solana-Web3-purple)](https://solana.com/)

---

## 📖 Inhaltsverzeichnis

- [Trading-Logik](#-trading-logik)
- [Technische Architektur](#️-technische-architektur)
- [Server-Anforderungen](#-server-anforderungen)
- [Linux Server Setup](#-linux-server-setup)
- [Installation](#-installation)
- [Konfiguration](#️-konfiguration)
- [Erste Schritte](#-erste-schritte)
- [Betrieb & Monitoring](#-betrieb--monitoring)
- [Troubleshooting](#-troubleshooting)

---

## 📊 Trading-Logik

### Überblick

Iron Chain verwendet eine **4-Phasen-Strategie** mit striktem Risikomanagement:

```
1. REGIME-FILTER (4h) → Nur in BULL-Märkten traden
2. ENTRY-SIGNAL (15m) → Breakout + Momentum + Liquidity
3. POSITION-SIZING   → 1% Risiko pro Trade
4. EXIT-MANAGEMENT   → Stop-Loss, Partial TP, Trailing
```

---

### Phase 1: Regime-Erkennung (4h Chart)

**Ziel:** Verhindere Trading in ungünstigen Märkten

| Regime | Bedingung | Aktion |
|--------|-----------|--------|
| **BULL** | Preis > EMA50 > EMA200 **UND** ADX > 20 | ✅ Trading erlaubt |
| **BEAR** | Preis < EMA50 | ❌ Kein Trading |
| **SIDEWAYS** | ADX < 20 | ❌ Kein Trading |

**Beispiel:**
```
SOL-Preis: $105
EMA50 (4h): $103  
EMA200 (4h): $98
ADX: 24

→ BULL-Regime ✅ → Trading erlaubt
```

---

### Phase 2: Entry-Signal (15m Chart)

**Alle 4 Bedingungen müssen erfüllt sein:**

#### 1. Breakout Check
```
Donchian Channel (20 Perioden)
→ Close muss über Donchian-High brechen

Beispiel:
Donchian High: $104.50
Current Close: $104.75
→ Breakout ✅
```

#### 2. Momentum Check
```
RSI (14):
- Zwischen 50-75
- Steigend (RSI_jetzt > RSI_vorher)

Beispiel:
RSI: 64 (vorher: 61)
→ Im Range UND steigend ✅
```

#### 3. Liquidity Check
```
- Spread < 0.2%
- Liquidität > $5,000
- Price Impact < 1%

→ Verhindert schlechte Fills
```

#### 4. Profitability Check
```
(Fees + Slippage) < 30% des erwarteten Gewinns

Beispiel:
Erwarteter Gewinn: $50
Kosten: $8
→ $8 < $15 (30% von $50) ✅
```

---

### Phase 3: Position Sizing

**Formel:**
```typescript
Position Size = (Equity × Risk%) / (Entry - Stop)

Beispiel:
Equity: $10,000
Risk: 1% = $100
Entry: $105
Stop: $102 (2.5× ATR)
Distance: $3

→ Position = $100 / $3 = 33.33 SOL = $3,500
```

**Caps:**
- Max 40% des Portfolios
- Min $10 Position
- Basierend auf aktuellem ATR

---

### Phase 4: Exit-Management

#### Stop-Loss
```
Initial Stop = Entry - (2.5 × ATR)

Entry: $105
ATR: $1.20
Stop: $105 - ($1.20 × 2.5) = $102.00
```

#### Partial Take-Profit
```
Bei +1.5R (1.5× Risiko):
1. Verkaufe 50% der Position
2. Move Stop → Breakeven
3. Lasse Rest mit Trailing laufen

Entry: $105, Stop: $102, Risk: $3
Target: $105 + ($3 × 1.5) = $109.50

Bei $109.50:
→ 50% verkaufen
→ Stop → $105
→ Rest läuft weiter
```

#### Trailing Stop
```
Für verbleibende 50%:
Stop = EMA20 (15m)

Preis fällt unter EMA20
→ Exit kompletter Rest
```

#### Time Exit
```
Nach 12 Stunden:
Wenn R-Multiple < 1.0
→ Zwangs-Exit
```

---

### Kill-Switch (Notbremse)

Automatische Aktivierung bei:

```
✓ Drawdown ≥ 20%
✓ Oracle-Divergenz > 1%
✓ RPC-Ausfall
✓ Manuell (Datei STOP_AND_FLATTEN)

Aktion:
→ Alle Positionen schließen
→ Trading stoppen
→ Manuelle Reaktivierung erforderlich
```

---

## 🏗️ Technische Architektur

### System-Komponenten

```
┌─────────────────────────────────────────────┐
│            Iron Chain Bot                   │
├─────────────────────────────────────────────┤
│                                             │
│  Market Data ──→ Strategy Engine            │
│  (Pyth/Jupiter)  (Regime/Entry/Exit)        │
│                          │                  │
│                          ▼                  │
│  Risk Manager ←──→ Position Sizer           │
│  (Kill-Switch)     (1% Risk)                │
│                          │                  │
│                          ▼                  │
│       Execution Layer                       │
│  ┌──────────┐    ┌──────────┐              │
│  │   LIVE   │    │  PAPER   │              │
│  │ Jupiter  │    │  Simul.  │              │
│  └──────────┘    └──────────┘              │
│                          │                  │
│                          ▼                  │
│  Logging & Analytics (SQLite + JSON)        │
│                                             │
└─────────────────────────────────────────────┘
```

### Technologie-Stack

| Komponente | Technologie |
|------------|-------------|
| Runtime | Node.js 18+ |
| Language | TypeScript |
| Blockchain | Solana Web3.js |
| DEX | Jupiter Aggregator |
| Oracle | Pyth Network |
| Indicators | technicalindicators |
| Database | SQLite |

---

## 💻 Server-Anforderungen

### Minimum

```
CPU:     2 Cores
RAM:     4 GB
Disk:    20 GB SSD
Network: < 50ms Latenz zu Solana RPC
OS:      Ubuntu 22.04 LTS
```

### Empfohlen

```
CPU:     4 Cores
RAM:     8 GB
Disk:    50 GB SSD
Network: < 20ms Latenz (dediziert)
OS:      Ubuntu 22.04 LTS
```

### Cloud-Provider

| Provider | Instance | Kosten/Monat |
|----------|----------|--------------|
| **Hetzner** | CX21 | ~€5 |
| **DigitalOcean** | 4GB Droplet | $24 |
| **Vultr** | 4GB | $12 |

---

## 🐧 Linux Server Setup

### 1. Basis-System vorbereiten

```bash
# System aktualisieren
sudo apt update && sudo apt upgrade -y

# Essentials installieren
sudo apt install -y curl git build-essential

# Firewall konfigurieren
sudo ufw allow OpenSSH
sudo ufw enable

# Zeitzone setzen
sudo timedatectl set-timezone Europe/Berlin  # Anpassen!

# Swap erstellen (falls < 2GB RAM)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

### 2. Node.js installieren

```bash
# NodeSource Repository (Node.js 18 LTS)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -

# Node.js installieren
sudo apt install -y nodejs

# Version prüfen
node --version   # → v18.x.x
npm --version    # → 9.x.x
```

---

### 3. Dedicated User erstellen

```bash
# User für Bot
sudo adduser ironchain
# Passwort setzen, Rest mit Enter bestätigen

# Zu User wechseln
sudo su - ironchain

# SSH-Key einrichten (optional aber empfohlen)
mkdir -p ~/.ssh
chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys  # Public Key einfügen
chmod 600 ~/.ssh/authorized_keys
```

---

### 4. Solana CLI & Wallet

```bash
# Solana CLI installieren
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# PATH hinzufügen
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Version prüfen
solana --version

# Mainnet konfigurieren
solana config set --url https://api.mainnet-beta.solana.com
```

#### Wallet erstellen

**Option A: Neues Wallet**
```bash
solana-keygen new --outfile ~/iron-chain-wallet.json
# WICHTIG: Seed Phrase sicher aufbewahren!

# Wallet-Adresse anzeigen
solana-keygen pubkey ~/iron-chain-wallet.json
```

**Option B: Existierendes Wallet importieren**
```bash
solana-keygen recover --outfile ~/iron-chain-wallet.json
# Seed Phrase eingeben
```

#### Private Key zu Base58 konvertieren

**Methode 1: Node.js Script**
```bash
# Script erstellen
cat > ~/convert-key.js << 'EOF'
const bs58 = require('bs58');
const fs = require('fs');

const keyfile = process.argv[2] || './iron-chain-wallet.json';
const keypair = JSON.parse(fs.readFileSync(keyfile));
const base58Key = bs58.encode(Buffer.from(keypair));

console.log('\nBASE58 PRIVATE KEY:');
console.log(base58Key);
console.log('\n⚠️  KEEP SECRET! Copy to .env as WALLET_PRIVATE_KEY\n');
EOF

# bs58 installieren
npm install -g bs58

# Konvertieren
node ~/convert-key.js ~/iron-chain-wallet.json

# OUTPUT KOPIEREN → Das ist dein Private Key für .env
```

**Methode 2: Python (falls Node.js Probleme macht)**
```bash
sudo apt install -y python3-pip
pip3 install base58

python3 << EOF
import json
import base58

with open('iron-chain-wallet.json', 'r') as f:
    keypair = json.load(f)

private_key = base58.b58encode(bytes(keypair)).decode('utf-8')
print(f'\nBASE58 PRIVATE KEY:\n{private_key}\n')
EOF
```

**Wallet sichern:**
```bash
chmod 600 ~/iron-chain-wallet.json

# NIEMALS in Git committen!
# BACKUP erstellen (offline speichern!)
```

---

### 5. RPC Endpoint konfigurieren

**Option 1: Public RPC (Kostenlos, Rate Limits)**
```bash
# Bereits in .env.example:
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

**Option 2: Premium RPC (Empfohlen für Live!)**

Registriere dich bei einem Provider:

#### Helius (Empfohlen)
```bash
# https://www.helius.dev/
# Free Tier: 100 Req/s

# In .env:
SOLANA_RPC_URL=https://rpc.helius.xyz/?api-key=YOUR_API_KEY
```

#### QuickNode
```bash
# https://www.quicknode.com/
# Free Trial verfügbar

SOLANA_RPC_URL=https://your-endpoint.solana-mainnet.quiknode.pro/TOKEN/
```

#### Alchemy
```bash
# https://www.alchemy.com/solana

SOLANA_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/YOUR_API_KEY
```

**RPC Performance testen:**
```bash
time curl -X POST https://api.mainnet-beta.solana.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'

# Sollte < 0.1s sein
```

---

### 6. Projekt-Struktur

```bash
# Verzeichnisse erstellen
mkdir -p ~/iron-chain/{logs,data,backups,scripts}
cd ~/iron-chain

# Wenn von Git:
git clone https://github.com/your/iron-chain.git .

# Wenn manuell hochgeladen (von lokalem Rechner):
# scp -r /local/iron-chain/* ironchain@server:~/iron-chain/
```

---

### 7. PM2 (Process Manager)

```bash
# PM2 global installieren
npm install -g pm2

# PM2 Config erstellen
cat > ~/iron-chain/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'iron-chain',
    script: './dist/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true
  }]
};
EOF

# PM2 bei Boot starten
pm2 startup
# Führe den angezeigten sudo-Befehl aus!

pm2 save
```

---

### 8. Monitoring & Backups

#### Telegram Alerts (Optional)

```bash
# 1. Bot erstellen: Telegram → @BotFather → /newbot
# 2. API Token kopieren
# 3. Chat ID: Bot starten → https://api.telegram.org/bot<TOKEN>/getUpdates

# Alert Script
cat > ~/send-alert.sh << 'EOF'
#!/bin/bash
TOKEN="YOUR_BOT_TOKEN"
CHAT_ID="YOUR_CHAT_ID"
MESSAGE="$1"

curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -d chat_id="${CHAT_ID}" \
  -d text="${MESSAGE}" > /dev/null
EOF

chmod +x ~/send-alert.sh

# Test
~/send-alert.sh "Iron Chain Bot gestartet auf $(hostname)"
```

#### Cron Jobs

```bash
crontab -e

# Füge hinzu:

# Täglicher Report (8:00 Uhr)
0 8 * * * cd /home/ironchain/iron-chain && npm run report | head -30 | /home/ironchain/send-alert.sh

# Health Check (alle 6h)
0 */6 * * * cd /home/ironchain/iron-chain && npm run health || /home/ironchain/send-alert.sh "⚠️ Health check failed!"

# Backup (täglich 3:00)
0 3 * * * bash /home/ironchain/iron-chain/scripts/backup.sh
```

#### Backup Script

```bash
cat > ~/iron-chain/scripts/backup.sh << 'EOF'
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$HOME/backups"

mkdir -p "$BACKUP_DIR"

# Database
cp ~/iron-chain/data/trades.db "$BACKUP_DIR/trades-$TIMESTAMP.db"

# Logs (komprimiert)
tar -czf "$BACKUP_DIR/logs-$TIMESTAMP.tar.gz" -C ~/iron-chain logs/

# Config (ohne Private Key!)
grep -v "WALLET_PRIVATE_KEY" ~/iron-chain/.env > "$BACKUP_DIR/env-$TIMESTAMP.backup"

# Alte Backups löschen (>30 Tage)
find "$BACKUP_DIR" -name "*.db" -mtime +30 -delete
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +30 -delete

echo "Backup completed: $TIMESTAMP"
EOF

chmod +x ~/iron-chain/scripts/backup.sh

# Test
~/iron-chain/scripts/backup.sh
```

---

### 9. Sicherheit

```bash
# SSH absichern
sudo nano /etc/ssh/sshd_config

# Ändern:
# PermitRootLogin no
# PasswordAuthentication no
# Port 2222  # Non-standard Port

sudo systemctl restart sshd

# Fail2Ban (gegen Brute-Force)
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# Automatische Updates
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades

# File Permissions
chmod 600 ~/iron-chain/.env
chmod 600 ~/iron-chain-wallet.json
chmod 700 ~/iron-chain/{data,logs}
```

---

### 10. Log Rotation

```bash
# System Log Rotation
sudo nano /etc/logrotate.d/iron-chain

# Einfügen:
/home/ironchain/iron-chain/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 ironchain ironchain
}

# Test
sudo logrotate -d /etc/logrotate.d/iron-chain
```

---

## 📦 Installation

```bash
cd ~/iron-chain

# Dependencies installieren
npm install

# Bei SQLite-Problemen:
npm rebuild better-sqlite3

# TypeScript kompilieren
npm run build

# .env erstellen
cp .env.example .env

# .env editieren
nano .env
```

---

## ⚙️ Konfiguration

### Basis-Konfiguration (.env)

**Kritische Settings:**

```bash
# === OPERATION MODE ===
RUN_MODE=PAPER_LIVE              # Start IMMER mit PAPER!

# === WALLET ===
WALLET_PRIVATE_KEY=<BASE58_KEY>  # Von convert-key.js

# === NETWORK ===
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com  # Oder Premium RPC
SOLANA_COMMITMENT=confirmed

# === TRADING ===
INITIAL_CAPITAL_USDC=1000        # Paper: Beliebig, Live: Real Balance
TRADING_PAIR=SOL/USDC

# === RISK (Konservativ!) ===
RISK_PER_TRADE=0.01              # 1% pro Trade
MAX_POSITION_SIZE=0.30           # Max 30% in einem Trade
MAX_DRAWDOWN_PERCENT=0.15        # 15% Kill-Switch
ENABLE_KILL_SWITCH=true          # NIEMALS false!

# === STRATEGY ===
REGIME_TIMEFRAME=4h
REGIME_EMA_FAST=50
REGIME_EMA_SLOW=200
REGIME_ADX_THRESHOLD=20

ENTRY_TIMEFRAME=15m
ENTRY_RSI_LOW=50
ENTRY_RSI_HIGH=75

STOP_LOSS_ATR_MULTIPLIER=2.5
PARTIAL_TP_R_MULTIPLE=1.5

# === ORACLE ===
PYTH_PRICE_FEED=H6ARHf6YXhGYeQfUzQNGk6rDNnLBQ
