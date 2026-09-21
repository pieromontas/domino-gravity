import * as THREE from 'three';
import { Tile } from '../engine/types.ts';
import { TILE_LENGTH, TILE_WIDTH, TILE_THICKNESS } from '../engine/chainPath.ts';

// Texture cache to prevent redundant canvas draws
const textureCache = new Map<string, THREE.CanvasTexture>();
let tileBackTexture: THREE.CanvasTexture | null = null;

// Base ivory material for domino sides
const ivorySideMaterial = new THREE.MeshStandardMaterial({
  color: 0xF5F0EB,
  roughness: 0.35,
  metalness: 0.05
});

/**
 * Creates high-res procedural texture for domino face with engraved pips
 */
function createFaceTexture(tile: Tile): THREE.CanvasTexture {
  const [pipA, pipB] = tile;
  const key = `${pipA}-${pipB}`;
  if (textureCache.has(key)) {
    return textureCache.get(key)!;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  // Warm ivory background with subtle vignette
  const grad = ctx.createRadialGradient(256, 512, 100, 256, 512, 600);
  grad.addColorStop(0, '#FFFDF8');
  grad.addColorStop(1, '#EDE4D8');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 1024);

  // Subtle border bevel
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 496, 1008);

  // Divider bar in the center
  ctx.fillStyle = '#C8B8A6';
  ctx.fillRect(40, 508, 432, 8);
  ctx.fillStyle = '#5A4E42';
  ctx.fillRect(40, 512, 432, 4);

  // Brass center spinner pin
  ctx.beginPath();
  ctx.arc(256, 512, 12, 0, Math.PI * 2);
  const pinGrad = ctx.createRadialGradient(253, 509, 2, 256, 512, 12);
  pinGrad.addColorStop(0, '#FFE89E');
  pinGrad.addColorStop(0.7, '#C29B38');
  pinGrad.addColorStop(1, '#6E551B');
  ctx.fillStyle = pinGrad;
  ctx.fill();

  // Draw pips on half A (top: y 0..512) and half B (bottom: y 512..1024)
  drawPipHalf(ctx, pipA, 0, 0, 512, 512);
  drawPipHalf(ctx, pipB, 0, 512, 512, 512);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(key, texture);
  return texture;
}

/**
 * Draws standard domino pips in a 512x512 square
 */
function drawPipHalf(
  ctx: CanvasRenderingContext2D,
  pips: number,
  offsetX: number,
  offsetY: number,
  w: number,
  h: number
) {
  if (pips === 0) return;

  const cx = offsetX + w / 2;
  const cy = offsetY + h / 2;
  const rad = 28;

  const left = offsetX + w * 0.28;
  const right = offsetX + w * 0.72;
  const top = offsetY + h * 0.28;
  const bottom = offsetY + h * 0.72;
  const midY = cy;

  const positions: [number, number][] = [];

  switch (pips) {
    case 1:
      positions.push([cx, cy]);
      break;
    case 2:
      positions.push([left, top], [right, bottom]);
      break;
    case 3:
      positions.push([left, top], [cx, cy], [right, bottom]);
      break;
    case 4:
      positions.push([left, top], [right, top], [left, bottom], [right, bottom]);
      break;
    case 5:
      positions.push([left, top], [right, top], [cx, cy], [left, bottom], [right, bottom]);
      break;
    case 6:
      positions.push(
        [left, top], [right, top],
        [left, midY], [right, midY],
        [left, bottom], [right, bottom]
      );
      break;
  }

  // Draw each engraved pip with inset shadow and rim
  for (const [px, py] of positions) {
    // Outer shadow ring
    ctx.beginPath();
    ctx.arc(px, py, rad + 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fill();

    // Dark engraved dot
    const pipGrad = ctx.createRadialGradient(px - 4, py - 4, 3, px, py, rad);
    pipGrad.addColorStop(0, '#3A3A3C');
    pipGrad.addColorStop(0.8, '#18181A');
    pipGrad.addColorStop(1, '#080808');

    ctx.beginPath();
    ctx.arc(px, py, rad, 0, Math.PI * 2);
    ctx.fillStyle = pipGrad;
    ctx.fill();

    // Subtle inner specular reflection
    ctx.beginPath();
    ctx.arc(px - 6, py - 6, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fill();
  }
}

/**
 * Creates decorative pattern for tile back
 */
function createBackTexture(): THREE.CanvasTexture {
  if (tileBackTexture) return tileBackTexture;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  // Deep obsidian/midnight gradient
  const grad = ctx.createLinearGradient(0, 0, 512, 1024);
  grad.addColorStop(0, '#1E232A');
  grad.addColorStop(0.5, '#13171C');
  grad.addColorStop(1, '#0A0D11');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 1024);

  // Geometric gold diamond grid pattern
  ctx.strokeStyle = 'rgba(218, 165, 32, 0.18)';
  ctx.lineWidth = 4;
  const step = 48;
  for (let x = -512; x < 1024; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 1024, 1024);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x, 1024);
    ctx.lineTo(x + 1024, 0);
    ctx.stroke();
  }

  // Gold emblem in center
  ctx.save();
  ctx.translate(256, 512);

  ctx.strokeStyle = 'rgba(230, 185, 75, 0.7)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, 110, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(230, 185, 75, 0.85)';
  ctx.font = 'bold 36px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DOMINO', 0, -18);
  ctx.font = '24px "Segoe UI", sans-serif';
  ctx.fillText('GRAVITY', 0, 22);

  ctx.restore();

  // Subtle border rim
  ctx.strokeStyle = 'rgba(230, 185, 75, 0.4)';
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 492, 1004);

  tileBackTexture = new THREE.CanvasTexture(canvas);
  tileBackTexture.colorSpace = THREE.SRGBColorSpace;
  return tileBackTexture;
}

/**
 * Creates 3D domino tile mesh with custom face, back, and beveled sides
 */
export function createDominoMesh(tile: Tile): THREE.Group {
  const group = new THREE.Group();
  group.name = `tile_${tile[0]}_${tile[1]}`;

  // Geometry: width is X, thickness is Y, length is Z
  // Note: TILE_WIDTH = 0.5, TILE_THICKNESS = 0.14, TILE_LENGTH = 1.0
  const geometry = new THREE.BoxGeometry(TILE_WIDTH, TILE_THICKNESS, TILE_LENGTH);

  const faceTexture = createFaceTexture(tile);
  const backTexture = createBackTexture();

  const faceMaterial = new THREE.MeshStandardMaterial({
    map: faceTexture,
    roughness: 0.28,
    metalness: 0.05
  });

  const backMaterial = new THREE.MeshStandardMaterial({
    map: backTexture,
    roughness: 0.35,
    metalness: 0.2
  });

  // BoxGeometry face materials order:
  // 0: +X (right edge)
  // 1: -X (left edge)
  // 2: +Y (top face with pips)
  // 3: -Y (bottom face/back)
  // 4: +Z (end edge)
  // 5: -Z (end edge)
  const materials = [
    ivorySideMaterial,
    ivorySideMaterial,
    faceMaterial,
    backMaterial,
    ivorySideMaterial,
    ivorySideMaterial
  ];

  const mesh = new THREE.Mesh(geometry, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  group.add(mesh);
  group.userData = { tile, isTile: true, faceMesh: mesh };

  return group;
}
