import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { applyPixelTexel, applyPixelTexelToMaterial } from './pixelTexel';
import { StadiumCrowd } from './crowd';
import { ensureWaterFog } from './waterFog';
import {
  bannerPlacements,
  crystalPlacements,
  stadiumTransform,
  standPlacements,
  towerPlacements,
  wallPlacements,
  KIT_SPHERE_CENTER_Y,
  KIT_SPHERE_RADIUS,
  type CrowdDensity,
  type KitPlacement,
} from './stadiumLayout';
import { basinBowlDrop } from './waterSettings';

export type StadiumDetail = 'off' | 'low' | 'high';

const flagTime = { value: 0 };

interface KitPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  local: THREE.Matrix4;
  name: string;
}

export interface StadiumHandle {
  root: THREE.Group;
  ready: Promise<void>;
  resize(arenaRadius: number): void;
  setDetail(detail: StadiumDetail): void;
  setCrowd(density: CrowdDensity): void;
  setCheer(amount: number): void;
  update(time: number): void;
}

function placementMatrix(p: KitPlacement, target: THREE.Matrix4): THREE.Matrix4 {
  target.makeRotationY(p.phi);
  target.setPosition(p.r * Math.cos(p.phi), p.h, -p.r * Math.sin(p.phi));
  return target;
}

function collectParts(root: THREE.Object3D): KitPart[] {
  root.updateMatrixWorld(true);
  const parts: KitPart[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!material) return;
    parts.push({
      geometry: mesh.geometry,
      material,
      local: mesh.matrixWorld.clone(),
      name: mesh.name || mesh.parent?.name || 'part',
    });
  });
  return parts;
}

function tuneKitMaterial(material: THREE.Material, sway: boolean): void {
  applyPixelTexelToMaterial(material);
  if (material instanceof THREE.MeshStandardMaterial) {
    material.metalness = 0;
    material.roughness = 0.85;
    material.envMapIntensity = 0.2;
    if (material.name === 'crystal_emissive' || material.name === 'rune_glow') {
      if (material.map && !material.emissiveMap) material.emissiveMap = material.map;
      material.emissive.set(0xffffff);
      material.emissiveIntensity = material.name === 'crystal_emissive' ? 1.15 : 0.85;
      material.toneMapped = false;
    }
    if (material.name === 'flag_cloth' || material.name === 'banner_cloth') material.side = THREE.DoubleSide;
  }
  ensureWaterFog(material);
  if (!sway) return;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uFlagTime = flagTime;
    if (shader.vertexShader.includes('uFlagTime')) return;
    shader.vertexShader =
      'uniform float uFlagTime;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float cloth = smoothstep(0.2, 5.0, length(transformed.xz));
        float wave = sin(uFlagTime * 2.3 + transformed.y * 0.7 + transformed.z * 1.2);
        transformed.x += wave * 0.65 * cloth;
        transformed.z += cos(uFlagTime * 1.6 + transformed.y) * 0.16 * cloth;`,
      );
  };
  const previousKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}|flag`;
  material.needsUpdate = true;
}

function tuneTree(root: THREE.Object3D, swayNames: Set<string>): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const sway = swayNames.has(mesh.name) || swayNames.has(mesh.parent?.name ?? '');
    for (const material of list) tuneKitMaterial(material, sway);
  });
}

/**
 * The halo mesh is wider than the play sphere and was cutting a circle through
 * the pool disc. Drop the disc and stretch the bowl wall down with it. The
 * rim, arena floor, and stands stay where the kit put them.
 */
function sinkBasinBowl(root: THREE.Object3D, drop: number): void {
  if (drop <= 0) return;
  const bottom = -0.6;
  const top = 1;
  let sunk = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const attr = mesh.geometry.getAttribute('position');
    if (!attr) return;
    let minY = Infinity;
    let maxY = -Infinity;
    let maxR = 0;
    for (let i = 0; i < attr.count; i++) {
      const y = attr.getY(i);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      maxR = Math.max(maxR, Math.hypot(attr.getX(i), attr.getZ(i)));
    }
    const bowl = maxR > 60 && maxR < 63 && minY < -0.4;
    if (!bowl) return;
    const flat = maxY < -0.4;
    sunk += 1;
    for (let i = 0; i < attr.count; i++) {
      const y = attr.getY(i);
      const t = THREE.MathUtils.clamp((y - bottom) / (top - bottom), 0, 1);
      attr.setY(i, flat ? y - drop : y - drop * (1 - t));
    }
    attr.needsUpdate = true;
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  });
  if (sunk !== 2) console.warn('basin bowl sink matched', sunk);
}

function instantiate(parts: KitPart[], placements: KitPlacement[], parent: THREE.Object3D): THREE.InstancedMesh[] {
  const meshes: THREE.InstancedMesh[] = [];
  const place = new THREE.Matrix4();
  const combined = new THREE.Matrix4();
  for (const part of parts) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, placements.length);
    mesh.frustumCulled = false;
    mesh.name = part.name;
    for (let i = 0; i < placements.length; i++) {
      placementMatrix(placements[i]!, place);
      combined.multiplyMatrices(place, part.local);
      mesh.setMatrixAt(i, combined);
    }
    mesh.instanceMatrix.needsUpdate = true;
    parent.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

function splitTips(parts: KitPart[]): { solid: KitPart[]; tips: KitPart[] } {
  const tips: KitPart[] = [];
  const solid: KitPart[] = [];
  for (const part of parts) {
    if (part.name === 'crystal_tip') tips.push(part);
    else solid.push(part);
  }
  return { solid, tips };
}

async function loadGltf(file: string): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}stadium/models/${file}`);
  return gltf.scene;
}

function loadTexture(file: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      `${import.meta.env.BASE_URL}stadium/textures/${file}`,
      (tex) => {
        applyPixelTexel(tex);
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

export function attachStadium(parent: THREE.Object3D, arenaRadius: number): StadiumHandle {
  const root = new THREE.Group();
  root.name = 'stadium-kit';
  parent.add(root);
  const core = new THREE.Group();
  core.name = 'stadium-core';
  const high = new THREE.Group();
  high.name = 'stadium-high';
  root.add(core, high);

  const crowd = new StadiumCrowd();
  core.add(crowd.group);

  const spinning: { mesh: THREE.InstancedMesh; bases: THREE.Matrix4[] }[] = [];
  const halos: { sprite: THREE.Sprite; baseY: number; phase: number }[] = [];
  let detail: StadiumDetail = 'high';
  let cheer = 0;

  const applyScale = () => {
    const t = stadiumTransform(arenaRadius);
    root.scale.setScalar(t.scale);
    root.position.y = t.offsetY;
  };
  applyScale();

  const applyVisibility = () => {
    root.visible = detail !== 'off';
    high.visible = detail === 'high';
    crowd.group.visible = detail !== 'off';
  };

  const ready = (async () => {
    const [stands, wall, gate, tower, crystal, banner, basin, skyTex, haloTex, ...crests] = await Promise.all([
      loadGltf('stands_tier.glb'),
      loadGltf('wall_battlement.glb'),
      loadGltf('wall_battlement_gate.glb'),
      loadGltf('outer_corner_tower.glb'),
      loadGltf('crystal_pillar.glb'),
      loadGltf('banner.glb'),
      loadGltf('pool_basin.glb'),
      loadTexture('sky/sky_backdrop_1024x256.png'),
      loadTexture('crystal/crystal_glow_halo_64.png'),
      loadTexture('banners/banner_team_a_crest_64x128.png'),
      loadTexture('banners/banner_team_b_crest_64x128.png'),
      loadTexture('banners/banner_arena_sphere_64x128.png'),
      loadTexture('banners/banner_crystal_navy_64x128.png'),
      loadTexture('banners/banner_tricolour_star_64x128.png'),
    ]);

    tuneTree(stands, new Set());
    tuneTree(wall, new Set());
    tuneTree(gate, new Set());
    tuneTree(tower, new Set(['flag']));
    tuneTree(crystal, new Set());
    tuneTree(banner, new Set());
    tuneTree(basin, new Set());
    sinkBasinBowl(basin, basinBowlDrop(KIT_SPHERE_CENTER_Y, KIT_SPHERE_RADIUS));

    instantiate(collectParts(stands), standPlacements(), core);
    const wallBits = wallPlacements();
    instantiate(
      collectParts(wall),
      wallBits.filter((w) => !w.gate).map((w) => ({ phi: w.phi, r: 0, h: 0 })),
      core,
    );
    instantiate(
      collectParts(gate),
      wallBits.filter((w) => w.gate).map((w) => ({ phi: w.phi, r: 0, h: 0 })),
      core,
    );
    instantiate(collectParts(basin), [{ phi: 0, r: 0, h: 0 }], core);

    const crystalParts = splitTips(collectParts(crystal));
    const crystals = crystalPlacements();
    instantiate(crystalParts.solid, crystals, core);
    for (const tip of crystalParts.tips) {
      const mesh = new THREE.InstancedMesh(tip.geometry, tip.material, crystals.length);
      mesh.frustumCulled = false;
      mesh.name = 'crystal_tip';
      const bases: THREE.Matrix4[] = [];
      const place = new THREE.Matrix4();
      for (let i = 0; i < crystals.length; i++) {
        const combined = new THREE.Matrix4();
        combined.multiplyMatrices(placementMatrix(crystals[i]!, place), tip.local);
        bases.push(combined.clone());
        mesh.setMatrixAt(i, combined);
      }
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      core.add(mesh);
      spinning.push({ mesh, bases });
    }

    haloTex.wrapS = THREE.ClampToEdgeWrapping;
    haloTex.wrapT = THREE.ClampToEdgeWrapping;
    applyPixelTexel(haloTex, { mipmaps: false });
    for (let i = 0; i < crystals.length; i++) {
      const place = crystals[i]!;
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: haloTex,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
          fog: false,
        }),
      );
      sprite.position.set(place.r * Math.cos(place.phi), 72, -place.r * Math.sin(place.phi));
      sprite.scale.set(18, 18, 1);
      sprite.renderOrder = 5;
      high.add(sprite);
      halos.push({ sprite, baseY: 72, phase: i * 1.3 });
    }

    instantiate(collectParts(tower), towerPlacements(), high);

    const bannerParts = collectParts(banner);
    const banners = bannerPlacements();
    const cloth = bannerParts.filter((part) => part.name !== 'banner');
    const clothBanner = bannerParts.filter((part) => part.name === 'banner');
    instantiate(cloth, banners, high);
    // Five crest sheets plus the authored cloth, around the ring.
    const maps = [null, ...crests];
    for (let variant = 0; variant < maps.length; variant++) {
      const slice = banners.filter((_, index) => index % maps.length === variant);
      if (slice.length === 0) continue;
      const parts = clothBanner.map((part) => {
        const map = maps[variant];
        if (!map || !(part.material instanceof THREE.MeshStandardMaterial)) return part;
        const material = part.material.clone();
        material.map = map;
        material.emissiveMap = null;
        material.transparent = true;
        material.alphaTest = 0.4;
        material.side = THREE.DoubleSide;
        material.depthWrite = true;
        material.userData.waterFog = false;
        applyPixelTexel(map, { mipmaps: false });
        map.wrapS = THREE.ClampToEdgeWrapping;
        map.wrapT = THREE.ClampToEdgeWrapping;
        ensureWaterFog(material);
        return { ...part, material };
      });
      instantiate(parts, slice, high);
    }

    skyTex.wrapS = THREE.RepeatWrapping;
    skyTex.wrapT = THREE.ClampToEdgeWrapping;
    skyTex.repeat.set(4, 1);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(
      new THREE.CylinderGeometry(480, 480, 320, 40, 1, true),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, toneMapped: false }),
    );
    sky.name = 'sky';
    sky.position.y = 90;
    sky.frustumCulled = false;
    const cap = new THREE.Mesh(
      new THREE.CircleGeometry(480, 40),
      new THREE.MeshBasicMaterial({ color: 0x4aa8f8, fog: false, toneMapped: false, side: THREE.DoubleSide }),
    );
    cap.rotation.x = Math.PI / 2;
    cap.position.y = 250;
    core.add(sky, cap);
    applyVisibility();
  })();

  ready
    .then(() => {
      if (typeof document !== 'undefined') document.body.dataset.stadium = 'ready';
    })
    .catch((err: unknown) => {
      console.warn('stadium kit failed', err);
      if (typeof document !== 'undefined') document.body.dataset.stadium = 'ready';
    });

  const spin = new THREE.Matrix4();
  const spun = new THREE.Matrix4();

  return {
    root,
    ready,
    resize(next) {
      arenaRadius = next;
      applyScale();
    },
    setDetail(next) {
      detail = next;
      applyVisibility();
    },
    setCrowd(density) {
      crowd.setDensity(density);
    },
    setCheer(amount) {
      cheer = amount;
    },
    update(time) {
      flagTime.value = time;
      crowd.update(time, detail === 'off' ? 0 : cheer);
      for (const item of spinning) {
        for (let i = 0; i < item.bases.length; i++) {
          spin.makeRotationY(time * 0.55 + i * 1.7);
          spun.multiplyMatrices(item.bases[i]!, spin);
          spun.elements[13] += Math.sin(time * 1.45 + i * 1.3) * 0.55;
          item.mesh.setMatrixAt(i, spun);
        }
        item.mesh.instanceMatrix.needsUpdate = true;
      }
      for (const halo of halos) {
        halo.sprite.position.y = halo.baseY + Math.sin(time * 1.45 + halo.phase) * 0.55;
      }
    },
  };
}
