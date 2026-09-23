import * as THREE from 'three';
import { TableId } from '../engine/types.ts';

export const CLASSIC_TABLE_RADIUS = 6.2;
/** Half-extent of the square DR felt so the existing snake rails still sit on the cloth. */
export const DOMINICAN_TABLE_HALF = 6.35;

export interface TableTheme {
  id: TableId;
  background: number;
  fog: number;
  exposure: number;
  defaultOrbitRadius: number;
}

export const TABLE_THEMES: Record<TableId, TableTheme> = {
  classic: {
    id: 'classic',
    background: 0x0E1217,
    fog: 0x0E1217,
    exposure: 1.05,
    defaultOrbitRadius: 12.0
  },
  dominican: {
    id: 'dominican',
    background: 0x1A100C,
    fog: 0x1A100C,
    exposure: 1.12,
    defaultOrbitRadius: 13.2
  }
};

function canvasTexture(
  size: number,
  paint: (ctx: CanvasRenderingContext2D, size: number) => void
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  paint(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Warm mahogany grain for the square patio table. */
export function createWoodTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (ctx, size) => {
    ctx.fillStyle = '#4A2A18';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y++) {
      const wave = Math.sin(y * 0.035) * 10 + Math.sin(y * 0.11) * 4;
      const shade = 58 + Math.sin(y * 0.07) * 10 + (y % 7) * 0.4;
      ctx.fillStyle = `rgb(${shade + 28}, ${shade * 0.62}, ${shade * 0.32})`;
      ctx.fillRect(0, y, size, 1);
      ctx.fillStyle = `rgba(28, 14, 8, ${0.04 + (y % 5) * 0.01})`;
      ctx.fillRect(wave + 40, y, 18, 1);
      ctx.fillRect(wave + 220, y, 12, 1);
    }
  });
}

/**
 * Deep patio felt with a tasteful Dominican flag inlay:
 * white cross, muted blue / red quadrants — not a cartoon wallpaper.
 */
export function createDominicanFeltTexture(): THREE.CanvasTexture {
  return canvasTexture(1024, (ctx, size) => {
    ctx.fillStyle = '#1B3A2A';
    ctx.fillRect(0, 0, size, size);

    const image = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < image.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 16;
      image.data[i] = Math.max(0, Math.min(255, image.data[i] + n));
      image.data[i + 1] = Math.max(0, Math.min(255, image.data[i + 1] + n));
      image.data[i + 2] = Math.max(0, Math.min(255, image.data[i + 2] + n * 0.6));
    }
    ctx.putImageData(image, 0, 0);

    const mid = size / 2;
    const cross = Math.round(size * 0.075);
    const inset = Math.round(size * 0.07);

    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#002D62';
    ctx.fillRect(inset, inset, mid - inset - cross / 2, mid - inset - cross / 2);
    ctx.fillRect(mid + cross / 2, mid + cross / 2, mid - inset - cross / 2, mid - inset - cross / 2);
    ctx.fillStyle = '#CE1126';
    ctx.fillRect(mid + cross / 2, inset, mid - inset - cross / 2, mid - inset - cross / 2);
    ctx.fillRect(inset, mid + cross / 2, mid - inset - cross / 2, mid - inset - cross / 2);

    ctx.globalAlpha = 0.38;
    ctx.fillStyle = '#F7F4EE';
    ctx.fillRect(mid - cross / 2, inset, cross, size - inset * 2);
    ctx.fillRect(inset, mid - cross / 2, size - inset * 2, cross);

    ctx.globalAlpha = 0.42;
    ctx.beginPath();
    ctx.arc(mid, mid, size * 0.055, 0, Math.PI * 2);
    ctx.fillStyle = '#F7F4EE';
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(mid, mid, size * 0.028, 0, Math.PI * 2);
    ctx.fillStyle = '#C9A227';
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

export function buildClassicTable(): THREE.Group {
  const tableGroup = new THREE.Group();
  tableGroup.name = 'tableGroup';

  const feltGeo = new THREE.CylinderGeometry(CLASSIC_TABLE_RADIUS, CLASSIC_TABLE_RADIUS, 0.4, 64);
  const feltMat = new THREE.MeshStandardMaterial({
    color: 0x1B4332,
    roughness: 0.85,
    metalness: 0.02
  });
  const felt = new THREE.Mesh(feltGeo, feltMat);
  felt.position.y = -0.2;
  felt.receiveShadow = true;
  tableGroup.add(felt);

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

  const baseGeo = new THREE.CylinderGeometry(5.8, 4.2, 1.5, 32);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x24140E,
    roughness: 0.5
  });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = -1.15;
  base.castShadow = true;
  tableGroup.add(base);

  return tableGroup;
}

export function buildDominicanTable(): THREE.Group {
  const tableGroup = new THREE.Group();
  tableGroup.name = 'tableGroup';

  const half = DOMINICAN_TABLE_HALF;
  const woodMap = createWoodTexture();
  woodMap.wrapS = THREE.RepeatWrapping;
  woodMap.wrapT = THREE.RepeatWrapping;
  woodMap.repeat.set(2, 2);

  const woodMat = new THREE.MeshStandardMaterial({
    map: woodMap,
    color: 0xC48A5A,
    roughness: 0.55,
    metalness: 0.04
  });

  const feltMap = createDominicanFeltTexture();
  const feltMat = new THREE.MeshStandardMaterial({
    map: feltMap,
    roughness: 0.9,
    metalness: 0.02
  });

  const feltSize = half * 2;
  const feltGeo = new THREE.BoxGeometry(feltSize, 0.38, feltSize);
  const felt = new THREE.Mesh(feltGeo, feltMat);
  felt.position.y = -0.19;
  felt.receiveShadow = true;
  tableGroup.add(felt);

  const rimThickness = 0.42;
  const rimHeight = 0.46;
  const outer = feltSize + rimThickness * 2;
  const longGeo = new THREE.BoxGeometry(outer, rimHeight, rimThickness);
  const shortGeo = new THREE.BoxGeometry(rimThickness, rimHeight, feltSize);

  const north = new THREE.Mesh(longGeo, woodMat);
  north.position.set(0, -0.04, half + rimThickness / 2);
  north.castShadow = true;
  north.receiveShadow = true;
  tableGroup.add(north);

  const south = new THREE.Mesh(longGeo, woodMat);
  south.position.set(0, -0.04, -(half + rimThickness / 2));
  south.castShadow = true;
  south.receiveShadow = true;
  tableGroup.add(south);

  const east = new THREE.Mesh(shortGeo, woodMat);
  east.position.set(half + rimThickness / 2, -0.04, 0);
  east.castShadow = true;
  east.receiveShadow = true;
  tableGroup.add(east);

  const west = new THREE.Mesh(shortGeo, woodMat);
  west.position.set(-(half + rimThickness / 2), -0.04, 0);
  west.castShadow = true;
  west.receiveShadow = true;
  tableGroup.add(west);

  const bandMatBlue = new THREE.MeshStandardMaterial({ color: 0x002D62, roughness: 0.45, metalness: 0.08 });
  const bandMatRed = new THREE.MeshStandardMaterial({ color: 0xCE1126, roughness: 0.45, metalness: 0.08 });
  const bandMatWhite = new THREE.MeshStandardMaterial({ color: 0xF4F1EA, roughness: 0.4, metalness: 0.05 });
  const bandH = 0.045;
  const bandT = 0.03;
  const bands: Array<[THREE.Material, number]> = [
    [bandMatBlue, 0.12],
    [bandMatWhite, 0.07],
    [bandMatRed, 0.02]
  ];
  for (const [mat, yOff] of bands) {
    const n = new THREE.Mesh(new THREE.BoxGeometry(outer + 0.02, bandH, bandT), mat);
    n.position.set(0, yOff, half + rimThickness + 0.01);
    tableGroup.add(n);
    const s = n.clone();
    s.position.z = -(half + rimThickness + 0.01);
    tableGroup.add(s);
    const e = new THREE.Mesh(new THREE.BoxGeometry(bandT, bandH, feltSize + 0.02), mat);
    e.position.set(half + rimThickness + 0.01, yOff, 0);
    tableGroup.add(e);
    const w = e.clone();
    w.position.x = -(half + rimThickness + 0.01);
    tableGroup.add(w);
  }

  const cornerSize = 0.55;
  const cornerGeo = new THREE.BoxGeometry(cornerSize, 0.08, cornerSize);
  const cornerBlue = new THREE.MeshStandardMaterial({ color: 0x1A3A72, roughness: 0.4, metalness: 0.12 });
  const cornerRed = new THREE.MeshStandardMaterial({ color: 0xB01024, roughness: 0.4, metalness: 0.12 });
  const corners: Array<[number, number, THREE.Material]> = [
    [-half + 0.15, -half + 0.15, cornerBlue],
    [half - 0.15, -half + 0.15, cornerRed],
    [-half + 0.15, half - 0.15, cornerRed],
    [half - 0.15, half - 0.15, cornerBlue]
  ];
  for (const [x, z, mat] of corners) {
    const plate = new THREE.Mesh(cornerGeo, mat);
    plate.position.set(x, 0.02, z);
    tableGroup.add(plate);
  }

  const apronGeo = new THREE.BoxGeometry(outer - 0.3, 0.55, outer - 0.3);
  const apron = new THREE.Mesh(apronGeo, woodMat);
  apron.position.y = -0.55;
  apron.castShadow = true;
  tableGroup.add(apron);

  const legGeo = new THREE.BoxGeometry(0.55, 1.7, 0.55);
  const legInset = half - 0.35;
  for (const [x, z] of [
    [-legInset, -legInset],
    [legInset, -legInset],
    [-legInset, legInset],
    [legInset, legInset]
  ] as Array<[number, number]>) {
    const leg = new THREE.Mesh(legGeo, woodMat);
    leg.position.set(x, -1.4, z);
    leg.castShadow = true;
    tableGroup.add(leg);
  }

  const patioGeo = new THREE.PlaneGeometry(36, 36);
  const patioMat = new THREE.MeshStandardMaterial({
    color: 0x3A2618,
    roughness: 0.92,
    metalness: 0
  });
  const patio = new THREE.Mesh(patioGeo, patioMat);
  patio.rotation.x = -Math.PI / 2;
  patio.position.y = -2.25;
  patio.receiveShadow = true;
  tableGroup.add(patio);

  return tableGroup;
}

export function buildTableFor(tableId: TableId): THREE.Group {
  return tableId === 'dominican' ? buildDominicanTable() : buildClassicTable();
}

export function buildLightingFor(tableId: TableId): THREE.Group {
  const lights = new THREE.Group();
  lights.name = 'tableLights';

  if (tableId === 'dominican') {
    const ambientLight = new THREE.AmbientLight(0xFFE6C8, 0.72);
    lights.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xFFD2A0, 1.55);
    mainLight.position.set(3.2, 12, 4.5);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 32;
    mainLight.shadow.camera.left = -8;
    mainLight.shadow.camera.right = 8;
    mainLight.shadow.camera.top = 8;
    mainLight.shadow.camera.bottom = -8;
    mainLight.shadow.bias = -0.0005;
    lights.add(mainLight);

    const bounceLight = new THREE.DirectionalLight(0x8A5A3A, 0.38);
    bounceLight.position.set(-6, 6, -5);
    lights.add(bounceLight);

    const lantern = new THREE.PointLight(0xFFB060, 0.55, 22, 2);
    lantern.position.set(-3.4, 3.6, 3.2);
    lights.add(lantern);
    return lights;
  }

  const ambientLight = new THREE.AmbientLight(0xFFF8F0, 0.9);
  lights.add(ambientLight);

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
  lights.add(mainLight);

  const bounceLight = new THREE.DirectionalLight(0x7890AA, 0.45);
  bounceLight.position.set(-6, 8, -6);
  lights.add(bounceLight);

  return lights;
}

export function disposeObject3D(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (!material) return;
    const mats = Array.isArray(material) ? material : [material];
    for (const mat of mats) {
      const std = mat as THREE.MeshStandardMaterial;
      std.map?.dispose();
      mat.dispose();
    }
  });
}
