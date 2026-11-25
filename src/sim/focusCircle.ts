import * as THREE from 'three';

/** Landing-ring radius in the marker's local space. Matches the torus in the view. */
export const FOCUS_RING_RADIUS = 0.52;
/** Screen-stable scale: world radius grows with camera distance. */
export const FOCUS_SCALE_PER_M = 0.022;
export const FOCUS_SCALE_MIN = 0.32;
export const FOCUS_SCALE_MAX = 2.05;

/** World radius of the focus circle drawn around a straight aim point. */
export function focusCircleRadius(cameraDistance: number): number {
  const scale = THREE.MathUtils.clamp(cameraDistance * FOCUS_SCALE_PER_M, FOCUS_SCALE_MIN, FOCUS_SCALE_MAX);
  return FOCUS_RING_RADIUS * scale;
}
