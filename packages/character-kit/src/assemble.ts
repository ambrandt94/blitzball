import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CharacterKit } from './kit';
import type { HidePlan, Loadout } from './types';

export interface CharacterAsset {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  plan: HidePlan;
  source: 'baked' | 'modular';
  /** Material name to the garment whose tint mask it should sample. */
  tintMaterials: Record<string, string>;
}

export interface LoadCharacterOptions {
  /** Use a prebaked GLB when the loadout matches one. Fewer meshes than a live attach. */
  preferBaked?: boolean;
}

const TINT_CHUNK = /* glsl */ `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  float tintAmount = texture2D( tintMaskMap, vMapUv ).r;
  tintAmount = mix( tintAmount, 1.0 - tintAmount, tintInvert );
  sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, sampledDiffuseColor.rgb * teamTintColor, tintAmount );
  diffuseColor *= sampledDiffuseColor;
#endif
`;

interface TintState {
  teamTintColor: { value: THREE.Color };
  tintMaskMap: { value: THREE.Texture };
  tintInvert: { value: number };
}

function tintBeforeCompile(
  this: THREE.Material,
  shader: Parameters<THREE.Material['onBeforeCompile']>[0],
  renderer: Parameters<THREE.Material['onBeforeCompile']>[1],
): void {
  const tint = this.userData.teamTint as TintState | undefined;
  const previous = this.userData.tintPrevious as THREE.Material['onBeforeCompile'] | undefined;
  previous?.call(this, shader, renderer);
  if (!tint || shader.fragmentShader.includes('teamTintColor')) return;
  shader.uniforms.teamTintColor = tint.teamTintColor;
  shader.uniforms.tintMaskMap = tint.tintMaskMap;
  shader.uniforms.tintInvert = tint.tintInvert;
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      '#include <common>\nuniform vec3 teamTintColor;\nuniform sampler2D tintMaskMap;\nuniform float tintInvert;',
    )
    .replace('#include <map_fragment>', TINT_CHUNK);
}

/** Nearest, no mips. Character Forge textures are authored for this. */
export function nearestTexture(texture: THREE.Texture): void {
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
}

export function nearestMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) {
      if (material instanceof THREE.MeshStandardMaterial) {
        for (const map of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap]) {
          if (map) nearestTexture(map);
        }
      } else if (material instanceof THREE.MeshBasicMaterial && material.map) {
        nearestTexture(material.map);
      }
    }
  });
}

let whiteMask: THREE.DataTexture | null = null;

function solidMask(): THREE.DataTexture {
  if (!whiteMask) {
    whiteMask = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    whiteMask.colorSpace = THREE.NoColorSpace;
    nearestTexture(whiteMask);
  }
  return whiteMask;
}

/**
 * Team tint through the mask: `mix(tex, tex * color, mask)`.
 * White mask tints, black keeps the trim. A missing mask tints the whole piece.
 * Call this on a material instance that will not be cloned afterwards.
 */
export function installTeamTint(
  material: THREE.MeshStandardMaterial,
  color: THREE.ColorRepresentation,
  mask: THREE.Texture | null,
  options: { invertMask?: boolean } = {},
): void {
  material.color.set(0xffffff);
  if (mask) {
    mask.colorSpace = THREE.NoColorSpace;
    nearestTexture(mask);
  }
  const previous = material.onBeforeCompile;
  material.userData.tintPrevious = previous;
  material.userData.teamTint = {
    teamTintColor: { value: new THREE.Color(color) },
    tintMaskMap: { value: mask ?? solidMask() },
    // These masks paint the recolorable cloth black and the kept trim white.
    tintInvert: { value: options.invertMask ? 1 : 0 },
  } satisfies TintState;
  material.onBeforeCompile = tintBeforeCompile;
  const previousKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}|team-tint`;
  material.needsUpdate = true;
}

/** Rebind a garment's skinned meshes onto the base skeleton by bone name. */
export function attachGarment(base: { scene: THREE.Object3D }, garment: { scene: THREE.Object3D }): THREE.SkinnedMesh[] {
  const bones = new Map<string, THREE.Bone>();
  base.scene.traverse((obj) => {
    const bone = obj as THREE.Bone;
    if (bone.isBone) bones.set(bone.name, bone);
  });
  const meshes: THREE.SkinnedMesh[] = [];
  garment.scene.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) meshes.push(mesh);
  });
  for (const mesh of meshes) {
    const rebound = mesh.skeleton.bones.map((bone) => {
      const target = bones.get(bone.name);
      if (!target) throw new Error(`missing bone ${bone.name}`);
      return target;
    });
    const skeleton = new THREE.Skeleton(rebound, mesh.skeleton.boneInverses);
    base.scene.add(mesh);
    mesh.bind(skeleton, mesh.bindMatrix);
    mesh.frustumCulled = false;
  }
  return meshes;
}

export function applyHidePlan(
  root: THREE.Object3D,
  worn: Record<string, THREE.Object3D[]>,
  plan: HidePlan,
  segments: Record<string, string>,
): void {
  const byName = new Map<string, THREE.Object3D>();
  root.traverse((obj) => {
    if (obj.name) byName.set(obj.name, obj);
  });
  for (const meshes of Object.values(worn)) {
    for (const mesh of meshes) mesh.visible = true;
  }
  for (const node of Object.values(segments)) byName.get(node) && (byName.get(node)!.visible = true);
  for (const node of plan.hiddenBodyNodes) {
    const obj = byName.get(node);
    if (obj) obj.visible = false;
  }
  for (const id of plan.hiddenGarments) {
    for (const mesh of worn[id] ?? []) mesh.visible = false;
  }
  for (const part of plan.hiddenGarmentNodes) {
    for (const mesh of worn[part.garmentId] ?? []) {
      if (mesh.name === part.nodeName) mesh.visible = false;
    }
  }
}

function joinUrl(root: string, file: string): string {
  if (!root) return file;
  return `${root.replace(/\/$/, '')}/${file.replace(/^\//, '')}`;
}

/** Which garment paints each team-tint material on a baked or assembled scene. */
export function tintMaterialsFor(kit: CharacterKit, plan: HidePlan): Record<string, string> {
  const visible = plan.visible
    .map((id) => kit.garment(id))
    .filter((garment): garment is NonNullable<typeof garment> => garment !== null);
  const under = visible.find((garment) => garment.band === 'under');
  const outer = [...visible].reverse().find((garment) => garment.band !== 'under') ?? visible[visible.length - 1];
  const map: Record<string, string> = {};
  if (under) map.TeamTint_under = under.id;
  if (outer) map.TeamTint = outer.id;
  else if (under) map.TeamTint = under.id;
  return map;
}

export async function loadTintMask(url: string): Promise<THREE.Texture> {
  const texture = await new THREE.TextureLoader().loadAsync(url);
  texture.colorSpace = THREE.NoColorSpace;
  nearestTexture(texture);
  return texture;
}

/**
 * Build a character. Baked looks win when `preferBaked` is set and a look matches,
 * which keeps bots to a handful of materials. Otherwise garments are bound by bone name.
 */
export async function loadCharacter(
  kit: CharacterKit,
  loadout: Loadout,
  assetRoot: string,
  options: LoadCharacterOptions = {},
): Promise<CharacterAsset> {
  const plan = kit.resolve(loadout);
  const loader = new GLTFLoader();
  const tintMaterials = tintMaterialsFor(kit, plan);
  if (options.preferBaked && plan.bakedFile) {
    const gltf = await loader.loadAsync(joinUrl(assetRoot, plan.bakedFile));
    nearestMaterials(gltf.scene);
    return { scene: gltf.scene, animations: gltf.animations, plan, source: 'baked', tintMaterials };
  }
  const base = await loader.loadAsync(joinUrl(assetRoot, kit.baseFile()));
  const worn: Record<string, THREE.SkinnedMesh[]> = {};
  for (const id of plan.worn) {
    if (plan.hiddenGarments.includes(id)) continue;
    const garment = kit.garment(id);
    if (!garment) continue;
    const gltf = await loader.loadAsync(joinUrl(assetRoot, garment.file));
    worn[id] = attachGarment(base, gltf);
  }
  applyHidePlan(base.scene, worn, plan, kit.baseSegments());
  nearestMaterials(base.scene);
  return { scene: base.scene, animations: base.animations, plan, source: 'modular', tintMaterials };
}
