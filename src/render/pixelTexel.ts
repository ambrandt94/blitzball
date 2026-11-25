import * as THREE from 'three';

/** Trailbound stadium density. 128 px covers 4 m. */
export const TEXELS_PER_M = 32;

/**
 * Pixel filtering used on the swimmers, applied to every stadium map.
 * Mag nearest, min nearest-mipmap, no anisotropic blur, sRGB albedo.
 * Alpha cutout sprites pass `mipmaps: false` so atlas edges stay hard.
 */
export function applyPixelTexel(tex: THREE.Texture, opts?: { mipmaps?: boolean }): void {
  const mip = opts?.mipmaps !== false;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = mip ? THREE.NearestMipmapNearestFilter : THREE.NearestFilter;
  tex.generateMipmaps = mip;
  tex.anisotropy = 1;
  if (tex.colorSpace !== THREE.NoColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  if (tex.image) tex.needsUpdate = true;
}

const MAP_KEYS = [
  'map',
  'emissiveMap',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'alphaMap',
] as const;

/** Force pixel sampling on every map a loaded GLB material is holding. */
export function applyPixelTexelToMaterial(material: THREE.Material, opts?: { mipmaps?: boolean }): void {
  const record = material as unknown as Record<string, THREE.Texture | null | undefined>;
  for (const key of MAP_KEYS) {
    const tex = record[key];
    if (tex) applyPixelTexel(tex, opts);
  }
}
