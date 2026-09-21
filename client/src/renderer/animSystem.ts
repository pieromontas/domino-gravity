import * as THREE from 'three';
import { soundManager } from './sound.ts';
import { createDominoMesh } from './tileMesh.ts';
import { Tile } from '../engine/types.ts';

interface TilePlacementAnim {
  mesh: THREE.Group;
  startPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  startRotY: number;
  targetRotY: number;
  progress: number;
  duration: number; // in seconds
  onComplete: () => void;
}

export class AnimationSystem {
  private scene: THREE.Scene;
  private activeAnims: TilePlacementAnim[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public playPlacementAnimation(
    tile: Tile,
    startPos: THREE.Vector3,
    targetPos: THREE.Vector3,
    targetRotY: number,
    onComplete: () => void
  ) {
    const mesh = createDominoMesh(tile);
    mesh.position.copy(startPos);
    this.scene.add(mesh);

    soundManager.playShuffle();

    this.activeAnims.push({
      mesh,
      startPos: startPos.clone(),
      targetPos: targetPos.clone(),
      startRotY: mesh.rotation.y,
      targetRotY,
      progress: 0,
      duration: 0.45,
      onComplete: () => {
        this.scene.remove(mesh);
        soundManager.playTileClack();
        soundManager.playTableThud();
        onComplete();
      }
    });
  }

  public update(delta: number) {
    for (let i = this.activeAnims.length - 1; i >= 0; i--) {
      const anim = this.activeAnims[i];
      anim.progress += delta / anim.duration;

      if (anim.progress >= 1) {
        anim.onComplete();
        this.activeAnims.splice(i, 1);
        continue;
      }

      const t = anim.progress;
      // Smooth ease-in-out curve
      const ease = t * t * (3 - 2 * t);

      // Lerp X & Z
      anim.mesh.position.x = THREE.MathUtils.lerp(anim.startPos.x, anim.targetPos.x, ease);
      anim.mesh.position.z = THREE.MathUtils.lerp(anim.startPos.z, anim.targetPos.z, ease);

      // Parabolic arc for Y (lifts 1.2 units up, then drops down)
      const arcHeight = Math.sin(t * Math.PI) * 1.4;
      anim.mesh.position.y = THREE.MathUtils.lerp(anim.startPos.y, anim.targetPos.y, ease) + arcHeight;

      // Rotation
      anim.mesh.rotation.y = THREE.MathUtils.lerp(anim.startRotY, anim.targetRotY, ease);
    }
  }

  public hasActiveAnimations(): boolean {
    return this.activeAnims.length > 0;
  }
}
