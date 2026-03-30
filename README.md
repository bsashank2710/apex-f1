# APEX F1 — Race Intelligence Platform

Real-time Formula 1 race intelligence app for the 2026 season.
Dark-themed mobile app backed by a FastAPI service aggregating OpenF1, Ergast, FastF1, and Anthropic Claude.

---

## Architecture

```
apex-f1/
├── backend/          FastAPI Python service
│   ├── main.py       Entry point, CORS, router registration
│   ├── routers/
│   │   ├── live.py       OpenF1 live timing proxy endpoints
│   │   ├── history.py    Ergast/Jolpica historical data
│   │   ├── telemetry.py  FastF1 telemetry parsing (CPU-bound, thread pool)
│   │   └── ai.py         Claude-powered predictions & insights
│   ├── services/
│   │   ├── openf1.py     Async OpenF1 API client
│   │   └── ergast.py     Async Ergast/Jolpica API client
│   ├── models/
│   │   └── schemas.py    Pydantic v2 models
│   ├── requirements.txt
│   └── .env.example
└── mobile/           Expo React Native (TypeScript)
    ├── app/
    │   ├── _layout.tsx        Root layout (QueryClientProvider)
    │   └── (tabs)/            Bottom tab navigator
    │       ├── index.tsx      Race tab (Hub / Tyres / LapLog / Telemetry / Drivers)
    │       ├── map.tsx        Live Map tab
    │       ├── strategy.tsx   Strategy tab (AI / Vault / Weather)
    │       ├── standings.tsx  Championship standings
    │       └── alerts.tsx     Race control alerts
    ├── screens/
    │   ├── RaceHub.tsx        Live leaderboard + race control
    │   ├── LiveMap.tsx        Real-time track position map (SVG)
    │   ├── Telemetry.tsx      Speed/throttle/brake traces (FastF1)
    │   ├── TyreTracker.tsx    Compound + stint visualiser
    │   ├── LapLog.tsx         Per-lap timing table
    │   ├── AIPredictions.tsx  Claude predictions + chat interface
    │   ├── StrategyVault.tsx  Historical race archives
    │   ├── Standings.tsx      WDC / WCC standings
    │   ├── Weather.tsx        Track conditions + trend charts
    │   ├── Alerts.tsx         Push notification history
    │   └── DriverCards.tsx    Driver profile card grid
    ├── lib/api.ts             Typed API client + all TypeScript interfaces
    ├── store/raceStore.ts     Zustand global state
    └── constants/theme.ts     Design tokens (colors, spacing, typography)
```

---

## Data Sources

| Source | Usage | Docs |
|---|---|---|
| **OpenF1** | Live timing, positions, gaps, stints, pit stops, weather | `https://openf1.org` |
| **Jolpica (Ergast mirror)** | Race results, standings, schedule | `https://api.jolpi.ca/ergast/f1` |
| **FastF1** | Telemetry (speed, RPM, gear, DRS), fastest lap comparison | `https://docs.fastf1.dev` |
| **Anthropic Claude** | Race predictions, strategy recommendations, chat insights | `https://docs.anthropic.com` |

---

## Backend Setup

```bash
cd backend

# Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and set your ANTHROPIC_API_KEY

# Run the API server
uvicorn main:app --reload --port 8000
```

Interactive docs: `http://localhost:8000/docs`

### Key Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/live/race_snapshot` | Aggregated live race state (drivers + gaps + tyres + weather) |
| GET | `/live/stints` | Live tyre stints per driver |
| GET | `/live/race_control` | Flag and safety car messages |
| GET | `/live/weather` | Track conditions |
| GET | `/history/standings/drivers` | Championship standings |
| GET | `/history/schedule/{year}` | Race calendar |
| GET | `/telemetry/{year}/{event}/{session}/compare?drivers=VER,HAM` | Multi-driver telemetry comparison |
| POST | `/ai/predict` | Claude race outcome prediction |
| POST | `/ai/insight` | Free-form race question |
| GET | `/ai/strategy/{session_key}` | Tyre strategy recommendations |

---

## Mobile Setup

```bash
cd mobile

# Install dependencies (already done if you ran the scaffold)
npm install

# Set your API URL
echo 'EXPO_PUBLIC_API_URL=http://localhost:8000' >> .env

# Start Expo
npx expo start
```

Scan the QR code with **Expo Go** on your phone, or press `a` for Android emulator / `i` for iOS simulator.

---

## Theme

| Token | Value |
|---|---|
| Primary | `#E8000D` (Ferrari red) |
| Background | `#06060E` (deep space) |
| Surface | `#0E0E1A` |
| Soft tyre | `#E8000D` |
| Medium tyre | `#FFD600` |
| Hard tyre | `#F0F0FF` |
| Intermediate | `#00A550` |
| Wet | `#0072CE` |

---

## Screens

| Screen | Tab | Description |
|---|---|---|
| **RaceHub** | Race → LIVE | Live leaderboard, gaps, tyre compounds, race control |
| **TyreTracker** | Race → TYRES | Stint bars and compound history per driver |
| **LapLog** | Race → LAP LOG | Filterable per-lap timing table with sector times |
| **Telemetry** | Race → TELEMETRY | FastF1 speed/throttle/brake traces, fastest lap comparison |
| **DriverCards** | Race → DRIVERS | Driver profile cards with championship stats |
| **LiveMap** | Map | Real-time X/Y track position dots using SVG |
| **AIPredictions** | Strategy → AI INTEL | Claude predictions, strategy calls, chat interface |
| **StrategyVault** | Strategy → VAULT | Historical race results and strategy archive |
| **Weather** | Strategy → WEATHER | Track conditions, compound recommendation, trend charts |
| **Standings** | Standings | WDC and WCC championship tables |
| **Alerts** | Alerts | Race control message feed + app notification history |
