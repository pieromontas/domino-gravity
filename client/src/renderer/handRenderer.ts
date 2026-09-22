import * as THREE from 'three';
import { Player, Tile } from '../engine/types.ts';
import { createDominoMesh } from './tileMesh.ts';
import { TILE_LENGTH } from '../engine/chainPath.ts';

/**
 * Positive X tilt rotates the +Y pip face toward world +Z — the seated
 * local player / default camera. The previous negative tilt aimed pips
 * at the table center, so the hand read as backs/edges.
 */
/** Match the default orbit phi (~53°) so +Y pips point at the 3/4 camera. */
export const LOCAL_HAND_FACE_TILT = Math.PI / 3.4;

export interface LocalHandSlot {
  x: number;
  y: number;
  z: number;
  rotX: number;
  rotY: number;
  rotZ: number;
}

/** Fan slot for the local seat so pips stay readable from the camera. */
export function localHandSlot(index: number, total: number): LocalHandSlot {
  const arcRadius = 4.0;
  const maxSpreadAngle = Math.PI * 0.36;
  const angleStep = total > 1 ? maxSpreadAngle / Math.max(total - 1, 1) : 0;
  const startAngle = -(maxSpreadAngle / 2);
  const angle = total === 1 ? 0 : startAngle + index * angleStep;

  return {
    x: Math.sin(angle) * arcRadius,
    y: 0.56,
    z: 3.35 + (1 - Math.cos(angle)) * 0.5,
    rotX: LOCAL_HAND_FACE_TILT,
    rotY: -angle * 0.28,
    rotZ: 0
  };
}

export class HandRenderer {
  private scene: THREE.Scene;
  private localHandGroup: THREE.Group;
  private opponentsGroup: THREE.Group;

  private localMeshes: THREE.Group[] = [];
  private selectedTileIndex: number | null = null;
  private hoveredTileIndex: number | null = null;

  public onTileSelected?: (tile: Tile, index: number) => void;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.localHandGroup = new THREE.Group();
    this.localHandGroup.name = 'localHandGroup';
    this.scene.add(this.localHandGroup);

    this.opponentsGroup = new THREE.Group();
    this.opponentsGroup.name = 'opponentsGroup';
    this.scene.add(this.opponentsGroup);
  }

  /**
   * Updates 3D tiles for local player hand and opponents
   */
  public updateHands(players: Player[], localSeat: number) {
    this.updateLocalHand(players[localSeat]?.hand || []);
    this.updateOpponents(players, localSeat);
  }

  private updateLocalHand(hand: Tile[]) {
    // Clear old meshes
    while (this.localHandGroup.children.length > 0) {
      const obj = this.localHandGroup.children[0];
      this.localHandGroup.remove(obj);
    }
    this.localMeshes = [];

    const total = hand.length;
    if (total === 0) return;

    hand.forEach((tile, idx) => {
      const mesh = createDominoMesh(tile);
      const slot = localHandSlot(idx, total);

      mesh.position.set(slot.x, slot.y, slot.z);
      mesh.rotation.order = 'XYZ';
      mesh.rotation.x = slot.rotX;
      mesh.rotation.y = slot.rotY;
      mesh.rotation.z = slot.rotZ;

      mesh.userData = {
        tile,
        index: idx,
        isLocalHandTile: true,
        basePos: new THREE.Vector3(slot.x, slot.y, slot.z),
        baseRotX: mesh.rotation.x,
        baseRotY: mesh.rotation.y
      };

      this.localHandGroup.add(mesh);
      this.localMeshes.push(mesh);
    });

    // Re-apply selection state if valid
    if (this.selectedTileIndex !== null && this.selectedTileIndex >= total) {
      this.selectedTileIndex = null;
    }
  }

  private updateOpponents(players: Player[], localSeat: number) {
    while (this.opponentsGroup.children.length > 0) {
      const obj = this.opponentsGroup.children[0];
      this.opponentsGroup.remove(obj);
    }

    const numPlayers = players.length;
    if (numPlayers <= 1) return;

    // Relative seating angles around circular table:
    // Local player is at angle 0 (South)
    // 2 players: Opponent at North (angle Math.PI)
    // 3 players: Opponents at 2*PI/3, 4*PI/3
    // 4 players: Opponents at West (PI/2), North (PI), East (3*PI/2)
    players.forEach((player) => {
      if (player.seat === localSeat) return;

      const relativeSeat = (player.seat - localSeat + numPlayers) % numPlayers;
      let angle = 0;
      if (numPlayers === 2) {
        angle = Math.PI; // Directly opposite (North)
      } else if (numPlayers === 3) {
        angle = relativeSeat === 1 ? Math.PI * 0.7 : Math.PI * 1.3;
      } else {
        angle = (relativeSeat * (Math.PI * 2)) / 4;
      }

      this.renderOpponentRack(player, angle);
    });
  }

  private renderOpponentRack(player: Player, angle: number) {
    const rackGroup = new THREE.Group();
    const tableRadius = 4.2;

    const cx = Math.sin(angle) * tableRadius;
    const cz = Math.cos(angle) * tableRadius;
    rackGroup.position.set(cx, 0.2, cz);
    rackGroup.rotation.y = angle + Math.PI;

    const count = player.handCount ?? player.hand.length;
    const spacing = 0.52;
    const startX = -((count - 1) * spacing) / 2;

    for (let i = 0; i < count; i++) {
      // Dummy tile [0,0] since opponents cannot see pips (back faces inward)
      const mesh = createDominoMesh([0, 0]);
      mesh.position.set(startX + i * spacing, TILE_LENGTH / 2, 0);
      // Stand upright on its short edge, back facing table center
      mesh.rotation.x = Math.PI / 2;
      mesh.rotation.y = Math.PI;
      rackGroup.add(mesh);
    }

    // Opponent Floating Name & Count Badge
    const badge = this.createPlayerBadge(player);
    badge.position.set(0, 1.3, 0);
    rackGroup.add(badge);

    this.opponentsGroup.add(rackGroup);
  }

  private createPlayerBadge(player: Player): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 96;
    const ctx = canvas.getContext('2d')!;

    // Rounded dark glass pill
    ctx.fillStyle = 'rgba(18, 24, 34, 0.88)';
    ctx.strokeStyle = player.isAI ? '#60A5FA' : '#34D399';
    ctx.lineWidth = 4;
    this.roundRect(ctx, 4, 4, 376, 88, 20, true, true);

    // Player Name
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 30px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const displayName = player.name.length > 14 ? player.name.slice(0, 12) + '…' : player.name;
    ctx.fillText(displayName, 24, 48);

    // Tile count pill
    ctx.fillStyle = '#374151';
    this.roundRect(ctx, 270, 20, 92, 56, 14, true, false);
    ctx.fillStyle = '#F3F4F6';
    ctx.font = 'bold 24px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`🁣 ${player.handCount ?? player.hand.length}`, 316, 48);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(1.8, 0.45, 1);
    return sprite;
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    fill: boolean,
    stroke: boolean
  ) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  /**
   * Raycasts mouse/touch pointer onto local hand tiles
   */
  public handlePointerMove(raycaster: THREE.Raycaster): number | null {
    const intersects = raycaster.intersectObjects(this.localHandGroup.children, true);
    let hitIndex: number | null = null;

    if (intersects.length > 0) {
      let cur: THREE.Object3D | null = intersects[0].object;
      while (cur && cur !== this.localHandGroup) {
        if (cur.userData && cur.userData.isLocalHandTile) {
          hitIndex = cur.userData.index;
          break;
        }
        cur = cur.parent;
      }
    }

    this.hoveredTileIndex = hitIndex;
    this.updateVisualTransforms();
    return hitIndex;
  }

  /**
   * Handles click/tap on local hand
   */
  public handlePointerClick(raycaster: THREE.Raycaster): Tile | null {
    const idx = this.handlePointerMove(raycaster);
    if (idx !== null && this.localMeshes[idx]) {
      this.selectedTileIndex = this.selectedTileIndex === idx ? null : idx;
      this.updateVisualTransforms();

      const tile = this.localMeshes[idx].userData.tile as Tile;
      if (this.selectedTileIndex !== null && this.onTileSelected) {
        this.onTileSelected(tile, idx);
      }
      return tile;
    }
    return null;
  }

  public getSelectedTile(): { tile: Tile; index: number } | null {
    if (this.selectedTileIndex !== null && this.localMeshes[this.selectedTileIndex]) {
      return {
        tile: this.localMeshes[this.selectedTileIndex].userData.tile as Tile,
        index: this.selectedTileIndex
      };
    }
    return null;
  }

  public clearSelection() {
    this.selectedTileIndex = null;
    this.updateVisualTransforms();
  }

  private updateVisualTransforms() {
    this.localMeshes.forEach((mesh, idx) => {
      const basePos: THREE.Vector3 = mesh.userData.basePos;
      const isSelected = idx === this.selectedTileIndex;
      const isHovered = idx === this.hoveredTileIndex;

      let targetY = basePos.y;
      let targetZ = basePos.z;

      if (isSelected) {
        targetY = basePos.y + 0.45;
        targetZ = basePos.z - 0.2;
      } else if (isHovered) {
        targetY = basePos.y + 0.22;
        targetZ = basePos.z - 0.1;
      }

      mesh.position.y += (targetY - mesh.position.y) * 0.25;
      mesh.position.z += (targetZ - mesh.position.z) * 0.25;
    });
  }
}
