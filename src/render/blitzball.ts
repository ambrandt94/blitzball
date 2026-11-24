import * as THREE from 'three';

const TEX_W = 1024;
const TEX_H = 512;

/**
 * Original procedural Blitzball: royal blue, gold swirl, silver/teal panels,
 * recessed seams, and an equatorial trim. Used when `public/models/blitzball.glb` is missing.
 */
export function createBlitzball(radius: number): THREE.Group {
  const { albedo, normal, roughness } = makeBlitzballTextures();
  const group = new THREE.Group();
  group.name = 'blitzball';

  const geo = new THREE.SphereGeometry(radius, 64, 48);
  geo.computeTangents();
  const ball = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      map: albedo,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: roughness,
      roughness: 0.46,
      metalness: 0.22,
      envMapIntensity: 0.4,
    }),
  );
  ball.name = 'blitzballShell';
  group.add(ball);

  const gold = new THREE.MeshStandardMaterial({
    color: 0xf0c14d,
    emissive: 0x6a4a12,
    emissiveIntensity: 0.35,
    metalness: 0.82,
    roughness: 0.28,
  });
  const trim = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.01, radius * 0.045, 8, 64), gold);
  trim.rotation.x = Math.PI / 2;
  trim.name = 'blitzballTrim';
  group.add(trim);

  const silver = new THREE.MeshStandardMaterial({
    color: 0xc5fff6,
    emissive: 0x0c3a40,
    emissiveIntensity: 0.25,
    metalness: 0.78,
    roughness: 0.22,
  });
  const tilt = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.995, radius * 0.028, 6, 56), silver);
  tilt.rotation.x = 1.05;
  tilt.rotation.y = 0.4;
  tilt.name = 'blitzballSwirl';
  group.add(tilt);

  return group;
}

function makeBlitzballTextures(): {
  albedo: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
} {
  const paint = document.createElement('canvas');
  paint.width = TEX_W;
  paint.height = TEX_H;
  const height = document.createElement('canvas');
  height.width = TEX_W;
  height.height = TEX_H;
  const rough = document.createElement('canvas');
  rough.width = TEX_W;
  rough.height = TEX_H;

  const pctx = paint.getContext('2d')!;
  const hctx = height.getContext('2d')!;
  const rctx = rough.getContext('2d')!;

  pctx.fillStyle = '#0c4ad4';
  pctx.fillRect(0, 0, TEX_W, TEX_H);
  hctx.fillStyle = '#9a9a9a';
  hctx.fillRect(0, 0, TEX_W, TEX_H);
  rctx.fillStyle = '#6e6e6e';
  rctx.fillRect(0, 0, TEX_W, TEX_H);

  // Deep navy panels under the swirl so the gold has something to cut against.
  pctx.fillStyle = '#06206e';
  for (let i = 0; i < 6; i++) {
    const cx = ((i + 0.5) / 6) * TEX_W;
    pctx.beginPath();
    pctx.ellipse(cx, TEX_H * 0.5, 78, 150, 0.5, 0, Math.PI * 2);
    pctx.fill();
  }
  hctx.fillStyle = '#7a7a7a';
  for (let i = 0; i < 6; i++) {
    const cx = ((i + 0.5) / 6) * TEX_W;
    hctx.beginPath();
    hctx.ellipse(cx, TEX_H * 0.5, 78, 150, 0.5, 0, Math.PI * 2);
    hctx.fill();
  }

  // Silver / teal panels offset from the navy ones. Spin reads off this contrast.
  for (let i = 0; i < 6; i++) {
    const cx = ((i + 0.15) / 6) * TEX_W;
    const cy = TEX_H * (0.32 + (i % 2) * 0.36);
    const grad = pctx.createRadialGradient(cx, cy, 8, cx, cy, 70);
    grad.addColorStop(0, '#e7fffb');
    grad.addColorStop(0.45, '#3ec8c2');
    grad.addColorStop(1, 'rgba(12, 80, 110, 0)');
    pctx.fillStyle = grad;
    pctx.beginPath();
    pctx.ellipse(cx, cy, 86, 48, -0.6, 0, Math.PI * 2);
    pctx.fill();

    hctx.fillStyle = '#d0d0d0';
    hctx.beginPath();
    hctx.ellipse(cx, cy, 86, 48, -0.6, 0, Math.PI * 2);
    hctx.fill();

    rctx.fillStyle = '#2a2a2a';
    rctx.beginPath();
    rctx.ellipse(cx, cy, 86, 48, -0.6, 0, Math.PI * 2);
    rctx.fill();
  }

  // Gold swirl: two turns around the ball, thick enough to read while it spins.
  strokeSwirl(pctx, '#f2c14b', 54);
  strokeSwirl(pctx, '#fff1b0', 16);
  strokeSwirl(hctx, '#f2f2f2', 54);
  strokeSwirl(rctx, '#3a3a3a', 54);

  // Recessed seam just outside the gold band.
  strokeSwirl(pctx, '#05070d', 8, 36);
  strokeSwirl(hctx, '#141414', 10, 36);

  // Equatorial trim on the texture, plus a few meridian ticks.
  pctx.strokeStyle = '#e6b422';
  pctx.lineWidth = 10;
  pctx.beginPath();
  pctx.moveTo(0, TEX_H * 0.5);
  pctx.lineTo(TEX_W, TEX_H * 0.5);
  pctx.stroke();
  hctx.strokeStyle = '#ffffff';
  hctx.lineWidth = 8;
  hctx.beginPath();
  hctx.moveTo(0, TEX_H * 0.5);
  hctx.lineTo(TEX_W, TEX_H * 0.5);
  hctx.stroke();
  rctx.strokeStyle = '#2c2c2c';
  rctx.lineWidth = 10;
  rctx.beginPath();
  rctx.moveTo(0, TEX_H * 0.5);
  rctx.lineTo(TEX_W, TEX_H * 0.5);
  rctx.stroke();

  pctx.strokeStyle = '#071428';
  pctx.lineWidth = 4;
  for (let i = 0; i < 8; i++) {
    const x = (i / 8) * TEX_W;
    pctx.beginPath();
    pctx.moveTo(x, TEX_H * 0.18);
    pctx.lineTo(x, TEX_H * 0.82);
    pctx.stroke();
    hctx.strokeStyle = '#222';
    hctx.lineWidth = 4;
    hctx.beginPath();
    hctx.moveTo(x, TEX_H * 0.18);
    hctx.lineTo(x, TEX_H * 0.82);
    hctx.stroke();
  }

  // Rivets along the equator so the spin has small high-frequency detail.
  for (let i = 0; i < 24; i++) {
    const x = ((i + 0.5) / 24) * TEX_W;
    pctx.fillStyle = i % 2 === 0 ? '#fff6d0' : '#d8fff8';
    pctx.beginPath();
    pctx.arc(x, TEX_H * 0.5, 5, 0, Math.PI * 2);
    pctx.fill();
    hctx.fillStyle = '#ffffff';
    hctx.beginPath();
    hctx.arc(x, TEX_H * 0.5, 5, 0, Math.PI * 2);
    hctx.fill();
  }

  const normalCanvas = heightToNormal(height, 3.2);
  const albedo = new THREE.CanvasTexture(paint);
  const normal = new THREE.CanvasTexture(normalCanvas);
  const roughness = new THREE.CanvasTexture(rough);
  for (const tex of [albedo, normal, roughness]) {
    tex.colorSpace = tex === albedo ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
  }
  return { albedo, normal, roughness };
}

function strokeSwirl(
  ctx: CanvasRenderingContext2D,
  color: string,
  width: number,
  offset = 0,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const turns = 2;
  for (let x = -40; x <= TEX_W + 40; x += 4) {
    const u = x / TEX_W;
    const y = TEX_H * (0.5 + 0.2 * Math.sin(u * Math.PI * 2 * turns)) + offset * Math.cos(u * Math.PI * 2);
    if (x === -40) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function heightToNormal(height: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const w = height.width;
  const h = height.height;
  const src = height.getContext('2d')!.getImageData(0, 0, w, h);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const dst = out.getContext('2d')!.createImageData(w, h);
  const sample = (x: number, y: number): number => {
    const xx = (x + w) % w;
    const yy = Math.max(0, Math.min(h - 1, y));
    return src.data[(yy * w + xx) * 4]! / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = sample(x + 1, y) - sample(x - 1, y);
      const dy = sample(x, y + 1) - sample(x, y - 1);
      let nx = -dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * w + x) * 4;
      dst.data[i] = (nx * 0.5 + 0.5) * 255;
      dst.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      dst.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      dst.data[i + 3] = 255;
    }
  }
  out.getContext('2d')!.putImageData(dst, 0, 0);
  return out;
}

const _fitBox = new THREE.Box3();
const _fitCenter = new THREE.Vector3();
const _fitPoint = new THREE.Vector3();

/**
 * Move `root` so its bounds center sits on the local origin, and scale it so the
 * outermost vertex is `radius` away. The GLB is modeled standing on Y=0, so the
 * raw pivot is not the physics ball.
 */
export function fitBallModel(root: THREE.Object3D, radius: number): boolean {
  root.updateMatrixWorld(true);
  const box = _fitBox.setFromObject(root);
  if (box.isEmpty()) return false;
  const center = _fitCenter.copy(box.getCenter(_fitPoint));
  let maxRadius = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const attr = mesh.geometry?.getAttribute('position');
    if (!attr) return;
    for (let i = 0; i < attr.count; i++) {
      _fitPoint.fromBufferAttribute(attr as THREE.BufferAttribute, i);
      mesh.localToWorld(_fitPoint);
      maxRadius = Math.max(maxRadius, _fitPoint.distanceTo(center));
    }
  });
  if (maxRadius < 1e-5 || radius <= 0) return false;
  const scale = radius / maxRadius;
  // Root matrix is T * R * S, so the translation is not scaled. Shift by -center * scale.
  root.scale.multiplyScalar(scale);
  root.position.addScaledVector(center, -scale);
  root.updateMatrixWorld(true);
  return true;
}

/**
 * The atlas leaves about half its texels transparent black. Drawn as-is, the
 * sphere turns into a cage. Fill those texels with the ball's navy so the
 * stripes and lettering sit on a solid shell.
 */
function solidifyBallMap(map: THREE.Texture): THREE.Texture {
  const image = map.image as CanvasImageSource & { width?: number; height?: number };
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  if (!width || !height || typeof document === 'undefined') return map;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return map;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, width, height);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const empty = data[i + 3] === 0 || data[i]! + data[i + 1]! + data[i + 2]! < 12;
    if (!empty) continue;
    data[i] = 0x0b;
    data[i + 1] = 0x17;
    data[i + 2] = 0x34;
    data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = map.flipY;
  tex.wrapS = map.wrapS;
  tex.wrapT = map.wrapT;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** The atlas is a small nearest-filtered stripe sheet. A little self-light keeps the bands readable in blue water. */
export function tuneUnderwaterBallMaterials(root: THREE.Object3D): void {
  const solidified = new Map<THREE.Texture, THREE.Texture>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      material.metalness = 0.04;
      material.roughness = THREE.MathUtils.clamp(material.roughness, 0.32, 0.5);
      material.envMapIntensity = 0.3;
      material.transparent = false;
      material.opacity = 1;
      material.depthWrite = true;
      if (material.map) {
        let map = solidified.get(material.map);
        if (!map) {
          map = solidifyBallMap(material.map);
          solidified.set(material.map, map);
        }
        material.map = map;
        material.emissive.set(0xffffff);
        material.emissiveMap = map;
        material.emissiveIntensity = 0.38;
      }
      material.needsUpdate = true;
    }
  });
}
