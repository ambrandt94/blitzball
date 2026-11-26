import { CAMERA } from '../game/constants';
import type { CameraPresetId, LookAheadMode, Tunables } from '../game/types';

export const CAMERA_SETTINGS_KEY = 'blitzball.camera';

/** Framing fields a preset replaces. Look invert and the up-axis stay put. */
export const CAMERA_FIELDS = [
  'camDistance',
  'camHeight',
  'camPitch',
  'shoulderOffset',
  'shoulderTransition',
  'camFov',
  'camLag',
  'camStiffness',
  'camSwivel',
  'lookAhead',
  'camRecenter',
  'camRecenterDelay',
  'ballCam',
  'wideDistance',
  'camShell',
] as const;

export type CameraField = (typeof CAMERA_FIELDS)[number];

export type CameraValues = Pick<Tunables, CameraField>;

const PRESET_IDS: CameraPresetId[] = ['close', 'default', 'broadcast', 'ball', 'cinematic', 'custom'];

export function defaultCameraFields(): CameraValues & { cameraPreset: CameraPresetId } {
  return {
    cameraPreset: 'default',
    camDistance: CAMERA.chaseDistance,
    camHeight: CAMERA.chaseHeight,
    camPitch: 0,
    shoulderOffset: CAMERA.shoulderOffset,
    shoulderTransition: CAMERA.shoulderTransition,
    camFov: CAMERA.fov,
    camLag: CAMERA.lag,
    camStiffness: CAMERA.stiffness,
    camSwivel: CAMERA.swivel,
    lookAhead: 'aim',
    camRecenter: false,
    camRecenterDelay: 0.75,
    ballCam: false,
    wideDistance: CAMERA.zoomOutDistance,
    camShell: true,
  };
}

const PRESETS: Record<Exclude<CameraPresetId, 'custom'>, CameraValues> = {
  close: {
    camDistance: 3.3,
    camHeight: 1.05,
    camPitch: 0.04,
    shoulderOffset: 1.05,
    shoulderTransition: 8,
    camFov: 70,
    camLag: 18,
    camStiffness: 0.95,
    camSwivel: 10,
    lookAhead: 'aim',
    camRecenter: false,
    camRecenterDelay: 0.75,
    ballCam: false,
    wideDistance: 22,
    camShell: true,
  },
  default: defaultCameraFields(),
  broadcast: {
    camDistance: 14,
    camHeight: 5.5,
    camPitch: -0.08,
    shoulderOffset: 2.4,
    shoulderTransition: 5,
    camFov: 74,
    camLag: 5,
    camStiffness: 0.55,
    camSwivel: 4,
    lookAhead: 'move',
    camRecenter: false,
    camRecenterDelay: 1,
    ballCam: false,
    wideDistance: 46,
    camShell: true,
  },
  ball: {
    camDistance: 8,
    camHeight: 2.8,
    camPitch: 0.06,
    shoulderOffset: 0.4,
    shoulderTransition: 7,
    camFov: 64,
    camLag: 9,
    camStiffness: 0.75,
    camSwivel: 7,
    lookAhead: 'ball',
    camRecenter: false,
    camRecenterDelay: 0.75,
    ballCam: true,
    wideDistance: 36,
    camShell: true,
  },
  cinematic: {
    camDistance: 9.5,
    camHeight: 2.2,
    camPitch: -0.18,
    shoulderOffset: 2.6,
    shoulderTransition: 3.5,
    camFov: 46,
    camLag: 3.5,
    camStiffness: 0.45,
    camSwivel: 3,
    lookAhead: 'move',
    camRecenter: true,
    camRecenterDelay: 0.55,
    ballCam: false,
    wideDistance: 40,
    camShell: true,
  },
};

export function cameraPresetValues(id: Exclude<CameraPresetId, 'custom'>): CameraValues {
  return { ...PRESETS[id] };
}

export function applyCameraPreset(tunables: Tunables, id: Exclude<CameraPresetId, 'custom'>): void {
  const values = cameraPresetValues(id);
  for (const key of CAMERA_FIELDS) {
    (tunables as unknown as Record<string, unknown>)[key] = values[key];
  }
  tunables.cameraPreset = id;
}

export function noteCameraEdit(tunables: Tunables): void {
  tunables.cameraPreset = 'custom';
}

export interface CameraSave extends CameraValues {
  preset: CameraPresetId;
}

export function cameraSettingsBlob(tunables: Tunables): CameraSave {
  const blob = { preset: tunables.cameraPreset } as CameraSave;
  for (const key of CAMERA_FIELDS) blob[key] = tunables[key] as never;
  return blob;
}

export function parseCameraSettings(raw: string | null | undefined): CameraSave | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (!PRESET_IDS.includes(record.preset as CameraPresetId)) return null;
  const out = { preset: record.preset as CameraPresetId, ...cameraPresetValues('default') } as CameraSave;
  for (const key of CAMERA_FIELDS) {
    if (!(key in record)) {
      if (key === 'camStiffness' || key === 'camSwivel') continue;
      return null;
    }
    const value = record[key];
    if (key === 'lookAhead') {
      if (value !== 'aim' && value !== 'move' && value !== 'ball') return null;
      out.lookAhead = value;
      continue;
    }
    if (key === 'camRecenter' || key === 'camShell' || key === 'ballCam') {
      if (typeof value !== 'boolean') return null;
      out[key] = value;
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    out[key] = value;
  }
  if (out.camDistance < 1.5 || out.camDistance > 40) return null;
  if (out.wideDistance < 8 || out.wideDistance > 80) return null;
  if (out.camFov < 30 || out.camFov > 110) return null;
  if (Math.abs(out.camPitch) > 1.2) return null;
  return out;
}

export function applyCameraSave(tunables: Tunables, save: CameraSave): void {
  for (const key of CAMERA_FIELDS) {
    (tunables as unknown as Record<string, unknown>)[key] = save[key];
  }
  tunables.cameraPreset = save.preset;
}

export function loadCameraSettings(): CameraSave | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return parseCameraSettings(localStorage.getItem(CAMERA_SETTINGS_KEY));
  } catch {
    return null;
  }
}

export function saveCameraSettings(tunables: Tunables): void {
  try {
    localStorage.setItem(CAMERA_SETTINGS_KEY, JSON.stringify(cameraSettingsBlob(tunables)));
  } catch {
    // Ignore quota and private-mode failures.
  }
}

export function isLookAhead(value: string): value is LookAheadMode {
  return value === 'aim' || value === 'move' || value === 'ball';
}
