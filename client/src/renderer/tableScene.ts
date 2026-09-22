import * as THREE from 'three';
import { ChainBounds, recommendedViewForChain } from '../engine/chainPath.ts';

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

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0E1217);

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
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.setupLighting();
    this.buildTable();
    this.initControls();

    window.addEventListener('resize', this.onResize);
  }

  private setupLighting() {
    // Ambient fill light (warm charcoal/slate tone)
    const ambientLight = new THREE.AmbientLight(0xFFF8F0, 0.9);
    this.scene.add(ambientLight);

    // Warm overhead key spotlight casting soft shadows on dominoes
    const mainLight = new THREE.DirectionalLight(0xFFFAEE, 1.8);
    mainLight.position.set(4, 14, 5);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 30;
    mainLight.shadow.camera.left = -7;
    mainLight.shadow.camera.right = 7;
    mainLight.shadow.camera.top = 7;
    mainLight.shadow.camera.bottom = -7;
    mainLight.shadow.bias = -0.0005;
    this.scene.add(mainLight);

    // Subtle blue-tinted rim/bounce light
    const bounceLight = new THREE.DirectionalLight(0x7890AA, 0.45);
    bounceLight.position.set(-6, 8, -6);
    this.scene.add(bounceLight);
  }

  private buildTable() {
    const tableGroup = new THREE.Group();

    // Table Felt Surface: Rich deep casino emerald felt
    const feltGeo = new THREE.CylinderGeometry(6.2, 6.2, 0.4, 64);
    const feltMat = new THREE.MeshStandardMaterial({
      color: 0x1B4332,
      roughness: 0.85,
      metalness: 0.02
    });
    const felt = new THREE.Mesh(feltGeo, feltMat);
    felt.position.y = -0.2;
    felt.receiveShadow = true;
    tableGroup.add(felt);

    // Felt Inset Ring / Line
    const ringGeo = new THREE.RingGeometry(4.8, 4.86, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xD4AF37,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.25
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.005;
    tableGroup.add(ring);

    // Table Wood Bevel / Rim: Warm mahogany / walnut
    const rimGeo = new THREE.TorusGeometry(6.3, 0.38, 20, 64);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x3E2723,
      roughness: 0.4,
      metalness: 0.1
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.05;
    rim.receiveShadow = true;
    rim.castShadow = true;
    tableGroup.add(rim);

    // Table Base / Pedestal
    const baseGeo = new THREE.CylinderGeometry(5.8, 4.2, 1.5, 32);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x24140E,
      roughness: 0.5
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = -1.15;
    base.castShadow = true;
    tableGroup.add(base);

    this.scene.add(tableGroup);
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
    if (!bounds) {
      this.chainFitRadius = 12.0;
      if (!this.userRaisedZoom) {
        this.targetOrbitSpherical.radius = 12.0;
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
    this.targetOrbitSpherical.set(Math.max(12.0, this.chainFitRadius), Math.PI / 3.4, 0);
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
    this.renderer.dispose();
  }
}
