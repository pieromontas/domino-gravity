# 🁢 Domino Gravity

> A modern, 3D multiplayer Dominoes Discord Activity built with **Three.js**, **TypeScript**, **Vite**, **Express/WebSocket**, and the **Discord Embedded App SDK**.

![Domino Gravity](https://img.shields.io/badge/Discord-Activity-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-3D%20Engine-black?style=for-the-badge&logo=three.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue?style=for-the-badge&logo=typescript)
![License](https://img.shields.io/badge/License-MIT-emerald?style=for-the-badge)

---

## 🌟 Features

- **🎮 Dual Mode Support**:
  - **Discord Activity Mode**: Seamlessly launches inside Discord voice and text channels via `@discord/embedded-app-sdk` with Discord avatar integration and OAuth token exchange.
  - **Standalone Dev Mode**: Works directly in any web browser without needing Discord credentials for instant local testing and iteration.
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
   - You can immediately test the 4-seat lobby, add AI players (Easy, Normal, or Hard), set target score, start the match, and play full rounds against AI!
   - Toggle camera views (`📐` Top-Down, `🔄` Reset Cam), toggle audio (`🔊`), and inspect valid placement rings on the 3D chain.

4. **Run Engine Unit Tests**:
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
   - Add a URL mapping from `/` to your public tunnel or deployed backend URL (see below).

### Step 4: Configure Local `.env`
Create a `.env` file in the project root based on `.env.example`:
```ini
VITE_DISCORD_CLIENT_ID=your_discord_application_id_here
DISCORD_CLIENT_SECRET=your_discord_client_secret_here
PORT=3001
```

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

## 🚢 Deployment

### Production Build
Build both client and server:
```bash
npm run build
```

### Deploying to Cloudflare Pages & Worker or Docker / Railway:
- **Client**: The `client/dist` directory is a purely static bundle that can be deployed to Cloudflare Pages, Vercel, or AWS S3.
- **Server**: The `server/dist` directory runs on any standard Node.js 18+ runtime (Railway, Render, Fly.io, or Docker container).
- The Express server is preconfigured to serve the static client bundle automatically if deployed as a unified single container:
  ```bash
  npm run build
  npm run start --workspace=server
  ```

---

## 📜 License

MIT License © 2026 Domino Gravity
