# 🁢 Domino Gravity

> A modern, 3D multiplayer Dominoes Discord Activity built with **Three.js**, **TypeScript**, **Vite**, **Express/WebSocket**, and the **Discord Embedded App SDK**.

![Domino Gravity](https://img.shields.io/badge/Discord-Activity-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-3D%20Engine-black?style=for-the-badge&logo=three.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue?style=for-the-badge&logo=typescript)
![License](https://img.shields.io/badge/License-MIT-emerald?style=for-the-badge)

---

## 🌟 Features

- **🎮 Dual Mode Support**:
  - **Discord Activity Mode**: Authenticates with the Embedded App SDK, uses the real Discord user for the local seat, subscribes to `ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE`, and seats every participant in one shared Activity room.
  - **Standalone Dev Mode**: Works in a normal browser as **You** (never a hardcoded host name) with local solo + AI. Optional `?room=` + `?name=` hits the same authoritative server for two-browser testing.
- **🎲 Classic Double-Six Rules (28 Tiles)**:
  - 2 to 4 players (humans + AI).
  - 7 tiles dealt per player; remaining form the boneyard.
  - Highest double leads first round; subsequent rounds lead by previous winner.
  - Snaking chain layout that dynamically curves across the table surface so dominoes never fall off.
  - Full Draw / Block rules with boneyard drawing, legal move validation, pass rules, and cumulative scoring (first to 50 / 100 / 150 points).
- **🤖 3-Tier Seeded AI Opponents**:
  - **Easy**: Plays random legal tiles; never blocks on purpose.
  - **Normal**: Prioritizes dumping high-pip tiles and doubles to minimize risk.
  - **Hard**: Card-counting engine tracking remaining suits on board, penalizing high tiles when opponents have 1–2 tiles left, and strategically forcing opponent draws.
  - Natural human-like turn delay (0.6s–1.1s).
- **✨ High-Fidelity 3D Table & Tiles**:
  - Procedural ivory dominoes with colorblind-safe, recessed dark engraved pips, brass center spinner pin, and embossed dark mahogany backs.
  - Casino-grade emerald felt table with wooden mahogany bevel.
  - Dynamic camera controls: interactive 3D orbit, top-down chain inspection view, and camera reset.
  - 3D curved local hand fan with smooth hover lift and glowing placement target rings.
  - Opponent stands displaying face-down dominoes and live tile counts.
- **🔊 Procedural Web Audio Engine**:
  - 100% synthesized audio effects with zero external audio assets: crisp ivory tile clacks, table drop thuds, shuffle swishes, turn notifications, and victory fanfare.

---

## 📁 Repository Structure

```
DominoDiscord/
├── client/                     # Frontend Discord Activity (Vite + Three.js)
│   ├── index.html              # HTML entry point with responsive viewport
│   ├── vite.config.ts          # Vite configuration with /api and /ws proxy
│   └── src/
│       ├── main.ts             # Application coordinator
│       ├── style.css           # Glassmorphism UI & responsive styles
│       ├── engine/             # Pure Dominoes Logic & Rules
│       │   ├── types.ts        # Data structures & GameState definition
│       │   ├── dominoDeck.ts   # Double-six 28-tile generator & PRNG
│       │   ├── dominoEngine.ts # Rule engine, moves, draw, pass, scoring
│       │   ├── chainPath.ts    # 2D/3D snake table layout algorithm
│       │   └── ai.ts           # Easy, Normal, and Hard AI brains
│       ├── renderer/           # Three.js 3D Rendering & Audio
│       │   ├── tableScene.ts   # Table model, lighting, orbit & view modes
│       │   ├── tileMesh.ts     # Procedural domino tiles with engraved pips
│       │   ├── chainRenderer.ts# Renders snake chain & open end target rings
│       │   ├── handRenderer.ts # Local 3D curved fan & opponent tile stands
│       │   ├── animSystem.ts   # Smooth tile lift, rotate & drop animations
│       │   └── sound.ts        # Web Audio API procedural sound engine
│       ├── net/
│       │   ├── discord.ts      # @discord/embedded-app-sdk integration
│       │   └── roomClient.ts   # Room client (local offline & WebSocket)
│       └── ui/
│           ├── hud.ts          # In-game HUD: turn banner, timer, boneyard
│           ├── lobby.ts        # 4 seats, Add AI, difficulty, score goal
│           └── modals.ts       # Round end table & match victory modal
├── server/                     # Authoritative Node/Express + WebSocket Server
│   └── src/
│       ├── server.ts           # HTTP + WebSocket server
│       ├── room.ts             # Room state & 60s reconnect grace period
│       └── discordAuth.ts      # Discord OAuth token exchange (/api/token)
├── .env.example                # Discord credentials template
└── package.json                # Workspaces configuration
```

---

## 🚀 Quickstart: Local Standalone Mode

To play the 3D dominoes game locally right in your web browser:

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start Client Dev Server**:
   ```bash
   npm run dev:client
   ```

3. Open **`http://localhost:5173`** in Chrome, Edge, or Safari.
   - Standalone identity is **You**. Add AI, set the target score, and play a full local match.
   - Toggle camera views (`📐` Top-Down, `🔄` Reset Cam), toggle audio (`🔊`), and inspect valid placement rings on the 3D chain.

4. **Optional local two-browser multiplayer** (no Discord):
   ```bash
   npm run dev:all
   ```
   Then open `http://localhost:5173/?room=demo&name=Alex` and `http://localhost:5173/?room=demo&name=Sam`. Each tab exchanges a short-lived **dev session** (`POST /api/dev-session`) and joins the same server room. Dev sessions are disabled when `NODE_ENV=production`.

5. **Run tests**:
   ```bash
   npm test
   ```

---

## 🛠️ Discord Developer Portal Configuration

To run Domino Gravity as an official Discord Activity inside your server's voice or text channels:

### Step 1: Create an Application
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** and name it **Domino Gravity**.
3. Under **General Information**, copy your **Application ID** (this is your `VITE_DISCORD_CLIENT_ID`).

### Step 2: Enable Activities
1. Navigate to the **Activities** tab on the left sidebar.
2. Toggle on **Enable Activities**.
3. Set **Supported Platforms** to include **Desktop**, **Web**, and **Mobile (iOS/Android)**.

### Step 3: Configure OAuth2 & URL Mappings
1. Navigate to the **OAuth2** tab.
2. Under **Client Information**, generate or copy the **Client Secret** (this is your `DISCORD_CLIENT_SECRET`).
3. Under **Redirects**, add:
   ```
   https://127.0.0.1
   ```
4. Under the **URL Mappings** section (in Activities):
   - Discord routes all activity network traffic through a proxy domain (`https://<app_id>.discordsays.com`).
   - Map `/` to your Azure App Service (or local tunnel) origin so same-origin `/api` and `/ws` work.
   - Inside the Discord iframe the client prefixes those paths with `/.proxy` (official Activity networking).

### Step 4: Configure Local `.env`
Create a `.env` file in the project root based on `.env.example`:
```ini
VITE_DISCORD_CLIENT_ID=your_discord_application_id_here
DISCORD_CLIENT_SECRET=your_discord_client_secret_here
PORT=3001
NODE_ENV=development
```

`DISCORD_CLIENT_SECRET` is server-only. Do not prefix it with `VITE_`.

### Step 5: Run with Discord Activity Tunnel
Because Discord Activities load inside an iframe served over HTTPS, you can expose your local server with Cloudflare Tunnel, ngrok, or the Discord CLI proxy:

```bash
# Option A: Cloudflare Tunnel (free, no account needed)
cloudflared tunnel --url http://localhost:5173

# Option B: ngrok
ngrok http 5173
```

Set the generated HTTPS URL in your Discord Developer Portal URL Mappings, launch Discord, join a voice channel, click the **Rocket Icon (Start an Activity)**, and select **Domino Gravity**!

---

## 🔐 Multiplayer, identity, and server authority

- The Node WebSocket server owns lobby seats, host, AI, chain, turn, draws/passes, scores, and match lifecycle.
- Clients authenticate first:
  - Discord: OAuth `authorize` → `POST /api/token` (server exchanges the code with `DISCORD_CLIENT_SECRET`, then calls `users/@me`) → session token + `access_token` for `sdk.commands.authenticate()`.
  - Browser multiplayer: `POST /api/dev-session` (non-production).
- WebSocket URL is `/ws?session=<token>&room=<roomKey>`. Client-supplied `user` / `name` / `avatar` query params are ignored.
- Room keys for Discord are `discord:<guild|noguild>:<channel|nochannel>:<instanceId>`. `instanceId` is unique per Activity launch; channel/guild keep separate launches from colliding. `default-room` is rejected.
- Each player receives a redacted `SYNC_STATE`: only their own tile values, `handCount` for others, and `boneyardCount` instead of the boneyard.
- First connected human is host. Host can start (when two ready seats exist) and add/remove AI. AI never replaces a pending Discord participant. If the host disconnects in the lobby, host migrates to the next connected human without resetting the room.
- Reconnects of the same Discord / session user reclaim the same seat during `ROOM_GRACE_MS` (default 60s). Empty rooms are disposed after that window.

## 🚢 Deployment

### Production build (Azure App Service / Node 22)

GitHub Actions builds the app (`npm ci && npm run build && npm test`), prunes to production `node_modules`, and ZIP-deploys the already-built `client/dist` + `server/dist`. Azure must **not** run Oryx/`npm run build` again — the deploy package does not include TypeScript sources or `tsconfig.json`.

Start the **one** Node process that serves static `client/dist` plus same-origin `/api` and `/ws`:

```bash
npm ci
npm run build
node server/dist/server.js
```

Root `npm start` is the same start command. `/api/health` and WebSockets on `/ws` stay same-origin.

### Required environment variables

| Variable | Where | Notes |
| --- | --- | --- |
| `VITE_DISCORD_CLIENT_ID` | Vite **build** and server runtime | Discord Application ID |
| `DISCORD_CLIENT_SECRET` | Server only | OAuth token exchange. Never ship this to the client. |
| `NODE_ENV` | Server | `production` on Azure |
| `PORT` | Server | Injected by Azure App Service |
| `ROOM_GRACE_MS` | Server, optional | Reconnect / empty-room grace (default `60000`) |

Do not commit `.env` or secrets. In GitHub Actions, store `VITE_DISCORD_CLIENT_ID` as a repository secret so `npm run build` can embed it in the Vite bundle. Set `DISCORD_CLIENT_SECRET` and `VITE_DISCORD_CLIENT_ID` on the App Service configuration, not in source.

### Azure App Service steps

1. Create a **Node 22** Linux Web App.
2. Startup command: `node server/dist/server.js` (or `npm start`). Confirm this under **Configuration → General settings → Startup Command**.
3. Application settings (Configuration → Application settings):
   - `SCM_DO_BUILD_DURING_DEPLOYMENT=false` — required so ZIP Deploy does not rerun `tsc` / Vite.
   - `ENABLE_ORYX_BUILD=false` — extra guard against Oryx on Linux.
   - `NODE_ENV=production`
   - `VITE_DISCORD_CLIENT_ID`
   - `DISCORD_CLIENT_SECRET`
   - `PORT` is injected by App Service.
4. Enable WebSockets on the App Service.
5. Point Discord Activity URL mappings at the App Service origin (`/` → the site).
6. Deploy with the GitHub Action. It sets the Oryx/startup settings above, then uploads the prebuilt ZIP. Do not expect Azure to compile TypeScript.

### Other hosts

The same unified Node server works on Railway, Render, Fly.io, or Docker. Split static+API hosting is possible but not required.

---

## 📜 License

MIT License © 2026 Domino Gravity
