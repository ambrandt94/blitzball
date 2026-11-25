import * as THREE from 'three';

/**
 * Local radius of the landing-marker torus. The view scales the mesh so its
 * world radius is `bigFocusRadius` — the large ring around the landing, the
 * same size as a reach ring at that camera distance.
 */
export const FOCUS_RING_RADIUS = 0.52;

/** Reach-ring torus radius. The big focus ring uses this, not the cursor dot. */
export const BIG_RING_RADIUS = 1.55;
export const BIG_RING_SCALE_PER_M = 0.046;
export const BIG_RING_SCALE_MIN = 0.65;
export const BIG_RING_SCALE_MAX = 4.8;

/**
 * Look radians that carry a full bend to the ring edge when bend speed is 42.
 * About a hundred pixels at the default mouse sensitivity, so a hold can
 * cross the whole ring without a long swipe.
 */
export const FOCUS_FULL_SWIPE = 0.22;

/** World radius of the large ring drawn around a straight aim point. */
export function bigFocusRadius(cameraDistance: number): number {
  const scale = THREE.MathUtils.clamp(
    cameraDistance * BIG_RING_SCALE_PER_M,
    BIG_RING_SCALE_MIN,
    BIG_RING_SCALE_MAX,
  );
  return BIG_RING_RADIUS * scale;
}
