import * as THREE from 'three';
import { TableScene } from './renderer/tableScene.ts';
import { ChainRenderer } from './renderer/chainRenderer.ts';
import { HandRenderer } from './renderer/handRenderer.ts';
import { AnimationSystem } from './renderer/animSystem.ts';
import { RoomClient } from './net/roomClient.ts';
import { DominoEngine } from './engine/dominoEngine.ts';
import { GameHUD } from './ui/hud.ts';
import { LobbyUI } from './ui/lobby.ts';
import { ModalsUI } from './ui/modals.ts';
import { discordIntegration } from './net/discord.ts';
import { EndSide, GameState, Tile } from './engine/types.ts';

class DominoGravityApp {
  private tableScene: TableScene;
  private chainRenderer: ChainRenderer;
  private handRenderer: HandRenderer;
  private animSystem: AnimationSystem;
  private engine: DominoEngine;
  private roomClient: RoomClient;

  private hud: GameHUD;
  private lobbyUI: LobbyUI;
  private modalsUI: ModalsUI;

  private raycaster: THREE.Raycaster;
  private pointer: THREE.Vector2;
  private lastTime: number = performance.now();

  private selectedTileForPlay: Tile | null = null;

  constructor() {
    const container = document.getElementById('canvas-container')!;
    this.tableScene = new TableScene(container);
    this.chainRenderer = new ChainRenderer(this.tableScene.scene);
    this.handRenderer = new HandRenderer(this.tableScene.scene);
    this.animSystem = new AnimationSystem(this.tableScene.scene);

    this.engine = new DominoEngine();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-999, -999);

    // Setup Room Client
    this.roomClient = new RoomClient({
      onStateUpdate: (state) => this.onGameStateUpdate(state)
    });

    // Setup UI components
    this.hud = new GameHUD(this.roomClient, this.tableScene, this.engine);
    this.lobbyUI = new LobbyUI(this.roomClient);
    this.modalsUI = new ModalsUI(this.roomClient);

    // Sync interactive tray clicks
    this.hud.onTrayTileClick = (tile) => {
      const state = this.roomClient.getState();
      this.handleTileSelection(tile, state);
    };

    this.initInteraction();
    this.initDiscord();

    // Start render loop
    requestAnimationFrame((t) => this.loop(t));
  }

  private async initDiscord() {
    await discordIntegration.init();
    const user = discordIntegration.user;
    this.roomClient.setLocalPlayer(user.globalName || user.username, user.avatarUrl, user.id);
  }

  private initInteraction() {
    const el = this.tableScene.renderer.domElement;

    // Track mouse move for tile hover
    window.addEventListener('pointermove', (e) => {
      this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

      this.raycaster.setFromCamera(this.pointer, this.tableScene.camera);
      this.handRenderer.handlePointerMove(this.raycaster);
    });

    // Click / Tap on 3D objects
    el.addEventListener('pointerdown', (e) => {
      this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.tableScene.camera);

      this.handlePointerTap();
    });
  }

  private handlePointerTap() {
    const state = this.roomClient.getState();
    const localSeat = this.roomClient.getLocalSeat();
    if (state.status !== 'playing' || state.currentTurn !== localSeat) {
      return;
    }

    // 1. Check if user tapped an open end placement target
    const tappedSide = this.chainRenderer.checkIntersection(this.raycaster);
    if (tappedSide && this.selectedTileForPlay) {
      this.roomClient.playTile(this.selectedTileForPlay, tappedSide);
      this.selectedTileForPlay = null;
      this.hud.setSelectedTile(null);
      this.handRenderer.clearSelection();
      this.chainRenderer.clearHighlights();
      return;
    }

    // 2. Check if user tapped a tile in hand
    const clickedTile = this.handRenderer.handlePointerClick(this.raycaster);
    if (clickedTile) {
      this.handleTileSelection(clickedTile, state);
    } else {
      // Tapped empty space -> clear selection
      this.selectedTileForPlay = null;
      this.hud.setSelectedTile(null);
      this.handRenderer.clearSelection();
      this.chainRenderer.clearHighlights();
    }
  }

  private handleTileSelection(tile: Tile, state: GameState) {
    // Check Round 1 required lead tile
    if (state.chain.length === 0 && state.requiredLeadTile) {
      const isLead = (tile[0] === state.requiredLeadTile[0] && tile[1] === state.requiredLeadTile[1]) ||
                     (tile[0] === state.requiredLeadTile[1] && tile[1] === state.requiredLeadTile[0]);
      if (!isLead) {
        this.hud.showRuleAlert(`⚠️ Rule: You MUST lead with your highest double [${state.requiredLeadTile[0]}|${state.requiredLeadTile[1]}]!`);
        return;
      }
    }

    this.selectedTileForPlay = tile;
    this.hud.setSelectedTile(tile);

    // If chain is completely empty, any valid tile starts the chain immediately
    if (state.chain.length === 0) {
      this.roomClient.playTile(tile, 'right');
      this.selectedTileForPlay = null;
      this.hud.setSelectedTile(null);
      this.handRenderer.clearSelection();
      return;
    }

    const legalMoves = this.engine.getLegalMoves(
      [tile],
      state.openEnds,
      false,
      state.requiredLeadTile
    );

    if (legalMoves.length === 0) {
      // Cannot play this tile
      this.hud.showRuleAlert(`⚠️ Rule: [${tile[0]}|${tile[1]}] cannot be played. Open ends are [${state.openEnds.left}] and [${state.openEnds.right}].`);
      this.chainRenderer.clearHighlights();
      this.selectedTileForPlay = null;
      this.hud.setSelectedTile(null);
      this.handRenderer.clearSelection();
      return;
    }

    const validSides: EndSide[] = Array.from(new Set(legalMoves.map(m => m.side)));

    // If only one side is legal, play immediately for seamless single-tap experience!
    if (validSides.length === 1) {
      this.roomClient.playTile(tile, validSides[0]);
      this.selectedTileForPlay = null;
      this.hud.setSelectedTile(null);
      this.handRenderer.clearSelection();
      this.chainRenderer.clearHighlights();
      return;
    }

    // Both ends match -> show glowing placement rings on table so user selects side
    this.chainRenderer.showOpenEndTargets(state.chain, state.openEnds, validSides);
  }

  private onGameStateUpdate(state: GameState) {
    const localSeat = this.roomClient.getLocalSeat();

    // Update 3D Table Scene
    this.chainRenderer.updateChain(state.chain);
    this.handRenderer.updateHands(state.players, localSeat);

    // Update UI components
    this.lobbyUI.render(state);
    this.hud.render(state);
    this.modalsUI.render(state);

    if (state.status !== 'playing') {
      this.chainRenderer.clearHighlights();
      this.selectedTileForPlay = null;
    }
  }

  private loop(currentTime: number) {
    const delta = (currentTime - this.lastTime) / 1000;
    this.lastTime = currentTime;

    this.tableScene.update();
    this.animSystem.update(delta);
    this.tableScene.render();

    requestAnimationFrame((t) => this.loop(t));
  }
}

// Bootstrap on window load
window.addEventListener('DOMContentLoaded', () => {
  new DominoGravityApp();
});
