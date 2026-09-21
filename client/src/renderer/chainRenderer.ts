import * as THREE from 'three';
import { EndSide, PlacedTile } from '../engine/types.ts';
import { createDominoMesh } from './tileMesh.ts';
import { TILE_LENGTH, TILE_WIDTH } from '../engine/chainPath.ts';

export class ChainRenderer {
  private scene: THREE.Scene;
  private chainGroup: THREE.Group;
  private highlightGroup: THREE.Group;
  private tileMeshes: Map<string, THREE.Group> = new Map();

  public onEndClick?: (side: EndSide) => void;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.chainGroup = new THREE.Group();
    this.chainGroup.name = 'chainGroup';
    this.scene.add(this.chainGroup);

    this.highlightGroup = new THREE.Group();
    this.highlightGroup.name = 'highlightGroup';
    this.scene.add(this.highlightGroup);
  }

  /**
   * Synchronizes 3D placed tiles with GameState chain
   */
  public updateChain(chain: PlacedTile[]) {
    // Add missing tiles
    for (let i = 0; i < chain.length; i++) {
      const pt = chain[i];
      if (!this.tileMeshes.has(pt.id)) {
        const mesh = createDominoMesh(pt.tile);
        mesh.position.set(pt.position.x, pt.position.y, pt.position.z);
        mesh.rotation.y = pt.rotationY;
        this.chainGroup.add(mesh);
        this.tileMeshes.set(pt.id, mesh);
      }
    }

    // Clean up if new round
    if (chain.length === 0 && this.tileMeshes.size > 0) {
      this.clear();
    }
  }

  /**
   * Displays glowing target markers on the open ends of the chain
   */
  public showOpenEndTargets(
    chain: PlacedTile[],
    openEnds: { left: number | null; right: number | null },
    validSides: EndSide[]
  ) {
    this.clearHighlights();
    if (chain.length === 0 || validSides.length === 0) return;

    const firstTile = chain[0];
    const lastTile = chain[chain.length - 1];

    if (validSides.includes('left') && openEnds.left !== null) {
      const pos = this.calculateEndPosition(firstTile, 'left');
      this.createEndHighlight(pos, 'left', openEnds.left);
    }

    if (validSides.includes('right') && openEnds.right !== null) {
      const pos = this.calculateEndPosition(lastTile, 'right');
      this.createEndHighlight(pos, 'right', openEnds.right);
    }
  }

  public clearHighlights() {
    while (this.highlightGroup.children.length > 0) {
      const obj = this.highlightGroup.children[0];
      this.highlightGroup.remove(obj);
    }
  }

  private calculateEndPosition(placed: PlacedTile, side: EndSide): THREE.Vector3 {
    const offset = placed.isDouble ? TILE_WIDTH * 0.8 : TILE_LENGTH * 0.7;
    // Approximated offset based on side
    const dirX = side === 'left' ? -1 : 1;
    return new THREE.Vector3(
      placed.position.x + dirX * offset,
      0.08,
      placed.position.z
    );
  }

  private createEndHighlight(pos: THREE.Vector3, side: EndSide, pip: number) {
    const ringGroup = new THREE.Group();
    ringGroup.position.copy(pos);
    ringGroup.userData = { isEndHighlight: true, side, pip };

    // Outer pulsating golden ring
    const ringGeo = new THREE.RingGeometry(0.35, 0.45, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xFFD700,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringGroup.add(ringMesh);

    // Inner glowing disk
    const diskGeo = new THREE.CircleGeometry(0.32, 32);
    const diskMat = new THREE.MeshBasicMaterial({
      color: 0xFFA500,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35
    });
    const diskMesh = new THREE.Mesh(diskGeo, diskMat);
    diskMesh.rotation.x = -Math.PI / 2;
    ringGroup.add(diskMesh);

    // Pip number indicator badge
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1A1A1A';
    ctx.font = 'bold 72px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pip.toString(), 64, 68);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(0.65, 0.65, 1);
    sprite.position.y = 0.45;
    ringGroup.add(sprite);

    this.highlightGroup.add(ringGroup);
  }

  public checkIntersection(raycaster: THREE.Raycaster): EndSide | null {
    const intersects = raycaster.intersectObjects(this.highlightGroup.children, true);
    if (intersects.length > 0) {
      let cur: THREE.Object3D | null = intersects[0].object;
      while (cur && cur !== this.highlightGroup) {
        if (cur.userData && cur.userData.isEndHighlight) {
          return cur.userData.side as EndSide;
        }
        cur = cur.parent;
      }
    }
    return null;
  }

  public clear() {
    this.clearHighlights();
    while (this.chainGroup.children.length > 0) {
      const obj = this.chainGroup.children[0];
      this.chainGroup.remove(obj);
    }
    this.tileMeshes.clear();
  }
}
