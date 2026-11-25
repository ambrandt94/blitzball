import * as THREE from 'three';
import { GOAL } from '../game/constants';
import { goalCornerXY, goalFrameCurve, goalOutward, goalPlaneZ } from '../sim/goal';

const tan = 0xe7c59a;
const teal = 0x2fbfb0;
const blue = 0x3c7eb8;
const gold = 0xf0d18a;

function standard(color: number, emissive: number, intensity: number, metal = 0.45, rough = 0.38): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: intensity,
    metalness: metal,
    roughness: rough,
  });
}

function tube(curve: THREE.Curve<THREE.Vector3>, radius: number, material: THREE.Material, segments = 28): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, 8, false), material);
  mesh.castShadow = false;
  return mesh;
}

function triangleShape(scale: number): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i < 3; i++) {
    const c = goalCornerXY(i as 0 | 1 | 2);
    const x = c.x * scale;
    const y = c.y * scale;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

/** Stripes and rails that wrap the bowed posts so they read as carved, not as plain tubes. */
function frameTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 512;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  if (!g) return tex;
  g.fillStyle = '#e07048';
  g.fillRect(0, 0, 128, 512);
  g.fillStyle = '#f2c9a0';
  g.fillRect(0, 0, 128, 18);
  g.fillRect(0, 494, 128, 18);
  g.fillStyle = '#1fb8aa';
  g.fillRect(0, 18, 128, 14);
  g.fillRect(0, 480, 128, 14);
  g.fillStyle = '#3d7ec0';
  g.fillRect(0, 32, 128, 8);
  g.fillRect(0, 472, 128, 8);
  for (let y = 48; y < 470; y += 72) {
    g.fillStyle = '#f6d7b0';
    g.fillRect(18, y, 92, 12);
    g.fillStyle = '#2ec4b6';
    g.fillRect(28, y + 22, 72, 8);
    g.fillStyle = '#f8e7c4';
    g.beginPath();
    g.moveTo(64, y + 36);
    g.lineTo(76, y + 48);
    g.lineTo(64, y + 60);
    g.lineTo(52, y + 48);
    g.closePath();
    g.fill();
    g.strokeStyle = '#1a6f9a';
    g.lineWidth = 2;
    g.stroke();
  }
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 2.4);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function emblemTexture(team: 0 | 1): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  if (!g) return new THREE.CanvasTexture(canvas);
  g.clearRect(0, 0, 256, 256);
  const color = team === 0 ? 'rgba(150, 205, 255, 0.95)' : 'rgba(255, 168, 110, 0.95)';
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 7;
  g.lineJoin = 'round';
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 4;
    const r = i % 2 === 0 ? 86 : 36;
    const x = 128 + Math.cos(a) * r;
    const y = 128 + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.globalAlpha = 0.9;
  g.stroke();
  g.globalAlpha = 0.22;
  g.fill();
  g.globalAlpha = 0.8;
  g.beginPath();
  g.arc(128, 128, 26, 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = 0.55;
  g.beginPath();
  g.arc(128, 128, 8, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * FFX-style goal: a bowed triangular frame, chunky corners, a bottom fin,
 * and a shallow tunnel of nested triangles with a faint crest on the back.
 * Local +Z points out of the arena, into the tunnel.
 */
export function buildGoalFrame(team: 0 | 1): THREE.Group {
  const group = new THREE.Group();
  group.name = team === 0 ? 'goal-blue' : 'goal-orange';
  group.position.set(0, 0, goalPlaneZ(team));
  if (goalOutward(team) < 0) group.rotation.y = Math.PI;

  const frameMap = frameTexture();
  const coralMat = new THREE.MeshStandardMaterial({
    map: frameMap,
    emissiveMap: frameMap,
    emissive: 0xfff2e6,
    emissiveIntensity: 0.42,
    color: 0xffffff,
    roughness: 0.42,
    metalness: 0.28,
  });
  const solidCoral = standard(0xe36a42, 0x6a2414, 0.45, 0.4, 0.4);
  const tanMat = standard(tan, 0x5a3d1c, 0.22, 0.55, 0.34);
  const tealMat = standard(teal, 0x0c4a48, 0.55, 0.62, 0.28);
  const blueMat = standard(blue, 0x123a66, 0.7, 0.5, 0.3);
  const goldMat = standard(gold, 0x6a4a12, 0.35, 0.72, 0.28);

  const bodyR = GOAL.rimTube;
  for (let i = 0; i < 3; i++) {
    const edge = i as 0 | 1 | 2;
    group.add(tube(goalFrameCurve(edge, -bodyR * 0.55, 0.02), bodyR * 0.22, tanMat));
    group.add(tube(goalFrameCurve(edge, 0, 0), bodyR * 1.05, coralMat));
    group.add(tube(goalFrameCurve(edge, bodyR * 0.72, -0.02), bodyR * 0.2, tealMat));
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x9aecff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    group.add(tube(goalFrameCurve(edge, bodyR * 1.15, -0.04), 0.045, glowMat, 20));

    for (const t of [0.34, 0.66]) {
      const p = goalFrameCurve(edge).getPoint(t);
      const stud = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), goldMat);
      stud.position.copy(p);
      group.add(stud);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), tealMat);
      gem.position.copy(p);
      gem.position.z -= 0.22;
      group.add(gem);
    }
  }

  for (let i = 0; i < 3; i++) {
    const c = goalCornerXY(i as 0 | 1 | 2);
    const knuckle = new THREE.Mesh(new THREE.SphereGeometry(i === 0 ? 0.92 : 0.78, 16, 12), i === 0 ? solidCoral : tanMat);
    knuckle.scale.set(1.25, 0.92, 1.05);
    knuckle.position.set(c.x, c.y, 0.05);
    group.add(knuckle);

    const collar = new THREE.Mesh(new THREE.TorusGeometry(i === 0 ? 1.05 : 0.92, 0.13, 8, 20), tealMat);
    collar.position.set(c.x, c.y, 0.08);
    group.add(collar);

    const inlay = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), blueMat);
    inlay.position.set(c.x * 0.9, c.y * 0.9, -0.28);
    group.add(inlay);

    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      const stud = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), goldMat);
      stud.position.set(c.x + Math.cos(a) * 0.62, c.y + Math.sin(a) * 0.62, 0.28);
      group.add(stud);
    }
  }

  const bottom = goalCornerXY(0);
  const spike = new THREE.Mesh(new THREE.ConeGeometry(0.62, 2.6, 6), solidCoral);
  spike.rotation.x = Math.PI;
  spike.position.set(bottom.x, bottom.y - 1.55, 0.12);
  group.add(spike);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.15, 0.72), tealMat);
  fin.position.set(bottom.x, bottom.y - 1.7, 0.18);
  group.add(fin);
  const finEdge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.7, 0.16), goldMat);
  finEdge.position.set(bottom.x, bottom.y - 1.85, 0.52);
  group.add(finEdge);
  const spikeCap = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), goldMat);
  spikeCap.position.set(bottom.x, bottom.y - 2.85, 0.12);
  group.add(spikeCap);

  const target = new THREE.Group();
  target.name = 'goalTarget';

  const bandMat = new THREE.MeshBasicMaterial({
    color: 0xe9fbff,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    toneMapped: false,
  });
  const bands = [
    { scale: 0.8, z: GOAL.pocketDepth * 0.2, opacity: 0.78, radius: 0.11 },
    { scale: 0.66, z: GOAL.pocketDepth * 0.42, opacity: 0.62, radius: 0.09 },
    { scale: 0.52, z: GOAL.pocketDepth * 0.64, opacity: 0.48, radius: 0.075 },
    { scale: 0.4, z: GOAL.pocketDepth * 0.86, opacity: 0.36, radius: 0.06 },
  ];
  for (const band of bands) {
    const mat = bandMat.clone();
    mat.opacity = band.opacity;
    for (let i = 0; i < 3; i++) {
      target.add(tube(goalFrameCurve(i as 0 | 1 | 2, 0, band.z, band.scale), band.radius, mat, 18));
    }
  }

  const back = new THREE.Mesh(
    new THREE.ShapeGeometry(triangleShape(0.46)),
    new THREE.MeshStandardMaterial({
      color: team === 0 ? 0x1a4e78 : 0x6a3018,
      emissive: team === 0 ? 0x12385c : 0x4a2010,
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      roughness: 0.6,
      metalness: 0.15,
    }),
  );
  back.position.z = GOAL.pocketDepth * 0.98;
  target.add(back);

  const crest = new THREE.Mesh(
    new THREE.PlaneGeometry(GOAL.rimRadius * 0.72, GOAL.rimRadius * 0.72),
    new THREE.MeshBasicMaterial({
      map: emblemTexture(team),
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  crest.position.z = GOAL.pocketDepth * 0.9;
  target.add(crest);

  const glow = new THREE.Mesh(
    new THREE.ShapeGeometry(triangleShape(GOAL.scoreScale * 0.92)),
    new THREE.MeshBasicMaterial({
      color: team === 0 ? 0x8fd0ff : 0xffb08a,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  glow.position.z = 0.2;
  target.add(glow);
  group.add(target);

  const flash = new THREE.Mesh(
    new THREE.ShapeGeometry(triangleShape(0.96)),
    new THREE.MeshBasicMaterial({
      color: 0xfff4c4,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  flash.name = 'goalFlash';
  flash.position.z = 0.4;
  group.add(flash);

  return group;
}
