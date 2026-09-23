import * as THREE from 'three';
import { ChainBounds, recommendedViewForChain } from '../engine/chainPath.ts';
import { TableId } from '../engine/types.ts';
import { parseTableId } from '../engine/tableId.ts';
import {
  buildLightingFor,
  buildTableFor,
  disposeObject3D,
  TABLE_THEMES
} from './tableThemes.ts';

export type CameraViewMode = 'perspective' | 'topdown';

export class TableScene {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  private container: HTMLElement;

  // Camera Orbit & View State
  private targetLookAt = new THREE.Vector3(0, 0, 0.5);
  private currentLookAt = new THREE.Vector3(0, 0, 0.5);
  private cameraMode: CameraViewMode = 'perspective';

  private targetCamPos = new THREE.Vector3(0, 8.8, 8.2);
  private currentCamPos = new THREE.Vector3(0, 8.8, 8.2);

  // Orbit drag interaction
  private isDragging = false;
  private previousMousePosition = { x: 0, y: 0 };
  private orbitSpherical = new THREE.Spherical(12.0, Math.PI / 3.4, 0);
  private targetOrbitSpherical = new THREE.Spherical(12.0, Math.PI / 3.4, 0);

  // Reduced motion setting
  public reducedMotion: boolean = false;

  /** Minimum orbit radius needed to keep the current chain in frame. */
  private chainFitRadius = 12.0;
  private userRaisedZoom = false;

  private tableGroup: THREE.Group | null = null;
  private lightsGroup: THREE.Group | null = null;
  private currentTableId: TableId = 'classic';

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(TABLE_THEMES.classic.background);
    this.scene.fog = new THREE.Fog(TABLE_THEMES.classic.fog, 22, 48);

    // Camera setup with responsive FOV
    const aspect = container.clientWidth / container.clientHeight;
    const initialFov = aspect < 1.0 ? Math.min(56, 46 / aspect) : 46;
    this.camera = new THREE.PerspectiveCamera(initialFov, aspect, 0.1, 100);
    this.camera.position.copy(this.currentCamPos);
    this.camera.lookAt(this.currentLookAt);

    // WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = TABLE_THEMES.classic.exposure;
    container.appendChild(this.renderer.domElement);

    this.applyTable('classic');
    this.initControls();

    window.addEventListener('resize', this.onResize);
  }

  /**
   * Rebuilds table mesh + lighting for the host-chosen map.
   * Classic stays visually identical to the original oval casino table.
   */
  public applyTable(tableId: TableId | undefined) {
    const next = parseTableId(tableId);
    if (this.tableGroup && this.lightsGroup && this.currentTableId === next) return;

    if (this.tableGroup) {
      this.scene.remove(this.tableGroup);
      disposeObject3D(this.tableGroup);
      this.tableGroup = null;
    }
    if (this.lightsGroup) {
      this.scene.remove(this.lightsGroup);
      disposeObject3D(this.lightsGroup);
      this.lightsGroup = null;
    }

    this.currentTableId = next;
    const theme = TABLE_THEMES[next];
    this.scene.background = new THREE.Color(theme.background);
    this.scene.fog = new THREE.Fog(theme.fog, next === 'dominican' ? 18 : 22, next === 'dominican' ? 42 : 48);
    this.renderer.toneMappingExposure = theme.exposure;

    this.lightsGroup = buildLightingFor(next);
    this.tableGroup = buildTableFor(next);
    this.scene.add(this.lightsGroup);
    this.scene.add(this.tableGroup);

    this.chainFitRadius = theme.defaultOrbitRadius;
    if (!this.userRaisedZoom) {
      this.targetOrbitSpherical.radius = theme.defaultOrbitRadius;
    }
  }

  private initControls() {
    const el = this.renderer.domElement;

    // Pointer down
    el.addEventListener('pointerdown', (e) => {
      // Only drag with primary mouse button if not clicking an interactive object
      this.isDragging = true;
      this.previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    // Pointer move
    window.addEventListener('pointermove', (e) => {
      if (!this.isDragging || this.cameraMode === 'topdown') return;

      const deltaX = e.clientX - this.previousMousePosition.x;
      const deltaY = e.clientY - this.previousMousePosition.y;

      const rotSpeed = 0.005;
      this.targetOrbitSpherical.theta -= deltaX * rotSpeed;
      this.targetOrbitSpherical.phi -= deltaY * rotSpeed;

      // Clamp polar angle (phi) so camera doesn't flip underneath table
      this.targetOrbitSpherical.phi = Math.max(0.2, Math.min(Math.PI / 2.25, this.targetOrbitSpherical.phi));

      this.previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    // Pointer up
    window.addEventListener('pointerup', () => {
      this.isDragging = false;
    });

    // Wheel zoom
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomSpeed = 0.003;
      this.targetOrbitSpherical.radius += e.deltaY * zoomSpeed;
      this.targetOrbitSpherical.radius = Math.max(6.5, Math.min(22.0, this.targetOrbitSpherical.radius));
      this.userRaisedZoom = true;
    }, { passive: false });
  }

  public setViewMode(mode: CameraViewMode) {
    this.cameraMode = mode;
    if (mode === 'topdown') {
      const y = Math.max(14.5, this.chainFitRadius + 3);
      this.targetCamPos.set(this.targetLookAt.x, y, this.targetLookAt.z + 0.01);
    } else {
      this.resetCamera();
    }
  }

  /**
   * Pulls the camera back so a long snake stays on the felt in view.
   * Look-at tracks the chain center; radius never goes below the fit size.
   */
  public fitToChain(bounds: ChainBounds | null) {
    const idleRadius = TABLE_THEMES[this.currentTableId].defaultOrbitRadius;
    if (!bounds) {
      this.chainFitRadius = idleRadius;
      if (!this.userRaisedZoom) {
        this.targetOrbitSpherical.radius = idleRadius;
      }
      this.targetLookAt.set(0, 0, 0.5);
      if (this.cameraMode === 'topdown') {
        this.targetCamPos.set(0, 14.5, 0.01);
        this.targetLookAt.set(0, 0, 0);
      }
      return;
    }

    const view = recommendedViewForChain(bounds, this.camera.fov, this.camera.aspect);
    this.chainFitRadius = view.radius;
    this.targetLookAt.set(view.lookAtX, 0, view.lookAtZ);

    if (this.cameraMode === 'topdown') {
      this.targetCamPos.set(view.lookAtX, view.topY, view.lookAtZ + 0.01);
      this.targetLookAt.set(view.lookAtX, 0, view.lookAtZ);
      return;
    }

    if (!this.userRaisedZoom || this.targetOrbitSpherical.radius < this.chainFitRadius) {
      this.targetOrbitSpherical.radius = this.chainFitRadius;
    }
  }

  public resetCamera() {
    this.cameraMode = 'perspective';
    this.userRaisedZoom = false;
    const idleRadius = TABLE_THEMES[this.currentTableId].defaultOrbitRadius;
    this.targetOrbitSpherical.set(Math.max(idleRadius, this.chainFitRadius), Math.PI / 3.4, 0);
    this.targetLookAt.set(0, 0, 0.5);
  }

  public getViewMode(): CameraViewMode {
    return this.cameraMode;
  }

  public update() {
    const lerpRate = this.reducedMotion ? 1.0 : 0.08;

    if (this.cameraMode === 'perspective') {
      // Smoothly interpolate spherical coords
      this.orbitSpherical.radius += (this.targetOrbitSpherical.radius - this.orbitSpherical.radius) * lerpRate;
      this.orbitSpherical.phi += (this.targetOrbitSpherical.phi - this.orbitSpherical.phi) * lerpRate;
      this.orbitSpherical.theta += (this.targetOrbitSpherical.theta - this.orbitSpherical.theta) * lerpRate;

      this.targetCamPos.setFromSpherical(this.orbitSpherical);
    }

    this.currentCamPos.lerp(this.targetCamPos, lerpRate);
    this.currentLookAt.lerp(this.targetLookAt, lerpRate);

    this.camera.position.copy(this.currentCamPos);
    this.camera.lookAt(this.currentLookAt);
  }

  public render() {
    this.renderer.render(this.scene, this.camera);
  }

  private onResize = () => {
    if (!this.container) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 1.0 ? Math.min(56, 46 / aspect) : 46;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  public destroy() {
    window.removeEventListener('resize', this.onResize);
    if (this.tableGroup) disposeObject3D(this.tableGroup);
    if (this.lightsGroup) disposeObject3D(this.lightsGroup);
    this.renderer.dispose();
  }
}
