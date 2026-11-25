import * as THREE from 'three';
import { ensureWaterFog } from './waterFog';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BALL, PLAYER } from '../game/constants';
import type { PlayerState } from '../game/types';
import type { Simulation } from '../sim/Simulation';
import { authoritativeUp } from '../sim/math';
import { TEAM } from './swimmer';
import { sampleThrowPose } from './throwPose';

/**
 * The file is about a metre tall and 0.27 m thick, feet on Y=0.
 * Scale 2 matches the procedural swimmer's body thickness (~0.56) and puts the
 * torso inside the 0.55 collision radius. Head, hands, and feet stick out the
 * way the old fins did.
 */
export const SWIMMER_MODEL_SCALE = 2;
/** `Trans` sits 0.3 m up and is the swim clip's pivot. Park it on the physics origin. */
const MODEL_PIVOT_Y = 0.3;
const SWIM_CLIP_SECONDS = 1.2;

const CATCH_L = new THREE.Vector3(0.42, 0.42, 0.72);
const CATCH_R = new THREE.Vector3(-0.42, 0.42, 0.72);
/**
 * One-handed cradle. The throw hand stays forward and out to the side so a
 * swim stroke cannot swing the ball through the chest. The other arm keeps
 * the clip. The ball is placed on the palm after this solve, about a ball
 * radius along the palm normal.
 */
const HOLD_L = new THREE.Vector3(0.16, 0.2, 0.5);
const HOLD_R = new THREE.Vector3(-0.16, 0.2, 0.5);
/**
 * Thin axis of the hand mesh in bone-local space (the palm normal). Measured
 * from Hand_R / Hand_L at rest. Positive points out of the palm face.
 */
const PALM_AXIS_L = new THREE.Vector3(0.706, 0.137, 0.695).normalize();
const PALM_AXIS_R = new THREE.Vector3(-0.706, 0.134, 0.696).normalize();
/**
 * Preferred palm direction in the swimmer group: out to the throw side.
 * The roll is around the forearm, so a sideways reach leaves the ball on top of the hand.
 */
const PALM_DIR_L = new THREE.Vector3(0.96, 0.16, 0.22).normalize();
const PALM_DIR_R = new THREE.Vector3(-0.96, 0.16, 0.22).normalize();
const BURST_L = new THREE.Vector3(0.42, 0.14, -0.08);
const BURST_R = new THREE.Vector3(-0.16, 0.18, 1.05);

export interface SwimmerTemplate {
  scene: THREE.Group;
  swim: THREE.AnimationClip;
  tread: THREE.AnimationClip;
  idle: THREE.AnimationClip | null;
}

/** Critically damped scalar. `omega` is the stiffness (1/seconds). */
export interface Spring1 {
  value: number;
  vel: number;
}

export function spring1(value = 0): Spring1 {
  return { value, vel: 0 };
}

export function springTo(state: Spring1, target: number, omega: number, dt: number): number {
  if (!(dt > 0) || !Number.isFinite(target)) return state.value;
  const w = Math.max(0.01, omega);
  const err = state.value - target;
  state.vel += (-2 * w * state.vel - w * w * err) * dt;
  state.value += state.vel * dt;
  if (!Number.isFinite(state.value) || !Number.isFinite(state.vel)) {
    state.value = target;
    state.vel = 0;
  } else if (Math.abs(state.value - target) < 1e-4 && Math.abs(state.vel) < 1e-3) {
    state.value = target;
    state.vel = 0;
  }
  return state.value;
}

export interface SwimmerRig {
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  swim: THREE.AnimationAction;
  tread: THREE.AnimationAction;
  spine: THREE.Bone;
  chest: THREE.Bone;
  upperL: THREE.Bone;
  lowerL: THREE.Bone;
  handL: THREE.Bone;
  upperR: THREE.Bone;
  lowerR: THREE.Bone;
  handR: THREE.Bone;
  /** Grip on the throw hand. The held ball sits here when the Forge rig built one. */
  palmSocket: THREE.Object3D | null;
  hips: THREE.Bone | null;
  thighL: THREE.Bone | null;
  thighR: THREE.Bone | null;
  lenUpperL: number;
  lenLowerL: number;
  lenUpperR: number;
  lenLowerR: number;
  swimWeight: number;
  catchBlend: number;
  holdBlend: number;
  /** Eased power so a meter swing or a tap doesn't pop the arm. */
  throwShown: number;
  curveRightShown: number;
  curveUpShown: number;
  /** Speed-based swim weight, before the aim posture pulls it toward tread. */
  speedSwim: number;
  /** 0 swim, 1 upright tread. Eased by the aim posture blend time. */
  aimPosture: number;
  idle: THREE.AnimationAction | null;
  head: THREE.Bone | null;
  neck: THREE.Bone | null;
  /** Local quaternions the mixer wrote this frame, before pose offsets. */
  posed: PosedBone[];
  hasClip: boolean;
  aimSpring: Spring1;
  wIdle: Spring1;
  wTread: Spring1;
  wSwim: Spring1;
  stroke: Spring1;
  catchSpring: Spring1;
  holdSpring: Spring1;
  throwSpring: Spring1;
  curveRightSpring: Spring1;
  curveUpSpring: Spring1;
  kickSpring: Spring1;
  burstSpring: Spring1;
  bankSpring: Spring1;
  pitchSpring: Spring1;
  headYaw: Spring1;
  headPitch: Spring1;
  armLag: Spring1;
  legLag: Spring1;
  prevFacing: THREE.Vector3;
}

interface PosedBone {
  bone: THREE.Bone;
  clip: THREE.Quaternion;
}

/** A few degrees of forward lean so an upright tread still faces the aim. */
export const AIM_POSTURE_LEAN = 0.2;

export interface AimPostureInput {
  human: boolean;
  strafing: boolean;
  hasBall: boolean;
  catchReady: boolean;
  throwing: boolean;
  burst: boolean;
  pose: PlayerState['actionPose'];
}

/**
 * Right-click squares the body up, with or without the ball. A throw, and an
 * AI receiver who is catch-ready, stand up the same way.
 */
export function wantsAimPosture(input: AimPostureInput): boolean {
  if (input.burst) return false;
  if (input.throwing || input.catchReady || input.pose === 'kick') return true;
  if (input.human) return input.strafing;
  return input.hasBall && (input.pose === 'hold' || input.pose === 'pass' || input.pose === 'shoot');
}

/** Ease toward 1 while aiming and back to 0 after. `blendSeconds` is the settle time. */
export function stepAimPosture(state: Spring1, active: boolean, blendSeconds: number, dt: number): number {
  const omega = 4 / Math.max(0.05, blendSeconds);
  return springTo(state, active ? 1 : 0, omega, dt);
}

/**
 * Pitch of the visual rig, in its parent (facing/up) space.
 * Cancels the aim's pitch so the tread stands near vertical, then leans a little toward the aim.
 * Zero while swimming, so the swim clip's own pitch is left alone. The physics facing is not touched.
 */
export function aimPosturePitch(facingDotUp: number, aimBlend: number): number {
  const aimPitch = Math.asin(Math.max(-1, Math.min(1, facingDotUp)));
  return aimBlend * (aimPitch + AIM_POSTURE_LEAN);
}

const _goalL = new THREE.Vector3();
const _goalR = new THREE.Vector3();
const _toBall = new THREE.Vector3();
const _leanAxis = new THREE.Vector3(1, 0, 0);
const _yawAxis = new THREE.Vector3(0, 1, 0);
const _leanQ = new THREE.Quaternion();
const _yawQ = new THREE.Quaternion();
const _shoulder = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _poleWorld = new THREE.Vector3();
const _upperDir = new THREE.Vector3();
const _lowerDir = new THREE.Vector3();
const _localDir = new THREE.Vector3();
const _fromY = new THREE.Vector3();
const _localX = new THREE.Vector3();
const _twist = new THREE.Vector3();
const _parentQ = new THREE.Quaternion();
const _invParent = new THREE.Quaternion();
const _swing = new THREE.Quaternion();
const _aimed = new THREE.Quaternion();
const _roll = new THREE.Quaternion();
const _targetL = new THREE.Vector3();
const _targetR = new THREE.Vector3();
const _poleL = new THREE.Vector3();
const _poleR = new THREE.Vector3();

const goal = {
  weight: 0,
  lean: 0,
  chestYaw: 0,
  cock: 0,
  driven: false,
  weightL: 0,
  weightR: 0,
  palm: 0,
  palmX: 0,
  palmY: 0,
  palmZ: 1,
  poleLX: 0.85,
  poleLY: -0.2,
  poleLZ: 0.2,
  poleRX: -0.85,
  poleRY: -0.2,
  poleRZ: 0.2,
};

/** Filled just before `fillGoal`. Charging and the release playback share it. */
const throwLive = {
  active: false,
  power: 0,
  release: -1,
  pass: false,
  curveRight: 0,
  curveUp: 0,
  throwRight: true,
};

function materialList(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function nearestTextures(material: THREE.Material): void {
  if (!(material instanceof THREE.MeshStandardMaterial)) return;
  if (material.name === 'Hair') material.side = THREE.DoubleSide;
  const maps = [
    material.map,
    material.normalMap,
    material.roughnessMap,
    material.metalnessMap,
    material.emissiveMap,
    material.aoMap,
  ];
  for (const tex of maps) {
    if (!tex) continue;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
  }
}

/** Filter the shared maps once. Cloned materials reuse them. */
export function prepareSwimmerTemplate(
  scene: THREE.Group,
  clips: THREE.AnimationClip[],
): SwimmerTemplate | null {
  const swim = THREE.AnimationClip.findByName(clips, 'Swim');
  const tread = THREE.AnimationClip.findByName(clips, 'Tread');
  const idle = THREE.AnimationClip.findByName(clips, 'Idle');
  if (!swim || !tread) return null;
  if (!scene.getObjectByName('Root') || !scene.getObjectByName('Hand_R') || !scene.getObjectByName('Trans')) {
    return null;
  }
  let tint = false;
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of materialList(mesh)) {
      nearestTextures(material);
      if (material.name === 'TeamTint' || material.name === 'TeamTint_under') tint = true;
    }
  });
  if (!tint) return null;
  return { scene, swim, tread, idle: idle ?? null };
}

function findBone(root: THREE.Object3D, name: string): THREE.Bone | null {
  const found = root.getObjectByName(name);
  if (!found || !(found as THREE.Bone).isBone) return null;
  return found as THREE.Bone;
}

function requireBone(root: THREE.Object3D, name: string): THREE.Bone {
  const found = root.getObjectByName(name);
  if (!found || !(found as THREE.Bone).isBone) {
    throw new Error(`swimmer bone missing: ${name}`);
  }
  return found as THREE.Bone;
}

function tintClone(root: THREE.Object3D, team: 0 | 1): void {
  const suit = TEAM[team].suit;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    const next = materialList(mesh).map((material) => {
      const cloned = material.clone();
      cloned.userData.waterFog = false;
      nearestTextures(cloned);
      if (cloned instanceof THREE.MeshStandardMaterial && cloned.name === 'TeamTint') {
        cloned.color.setHex(suit);
      }
      ensureWaterFog(cloned);
      return cloned;
    });
    mesh.material = next.length === 1 ? next[0]! : next;
  });
}

function disposeProcedural(group: THREE.Group): void {
  const body = group.getObjectByName('proceduralBody');
  if (!body) return;
  body.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    for (const material of materialList(mesh)) material.dispose();
  });
  group.remove(body);
}

/**
 * One skinned clone per swimmer. Materials are cloned so team tints do not
 * share a color. The procedural body is removed only after the rig is complete.
 */
export function attachSwimmerModel(
  group: THREE.Group,
  template: SwimmerTemplate,
  team: 0 | 1,
  playerId: number,
): SwimmerRig | null {
  const existing = group.userData.swimmerRig as SwimmerRig | undefined;
  if (existing) return existing;
  const clone = cloneSkinned(template.scene) as THREE.Group;
  try {
    tintClone(clone, team);
    const wrapper = new THREE.Group();
    wrapper.name = 'swimmerModel';
    wrapper.scale.setScalar(SWIMMER_MODEL_SCALE);
    // Trans is the swim pivot (~0.3 m up). Shift so that joint, not the feet, sits
    // on the physics origin. The clip pitches around Trans; the root does not.
    wrapper.position.y = -MODEL_PIVOT_Y * SWIMMER_MODEL_SCALE;
    wrapper.add(clone);

    const spine = requireBone(wrapper, 'Spine');
    const chest = requireBone(wrapper, 'Chest');
    const upperL = requireBone(wrapper, 'UpperArm_L');
    const lowerL = requireBone(wrapper, 'LowerArm_L');
    const handL = requireBone(wrapper, 'Hand_L');
    const upperR = requireBone(wrapper, 'UpperArm_R');
    const lowerR = requireBone(wrapper, 'LowerArm_R');
    const handR = requireBone(wrapper, 'Hand_R');

    const mixer = new THREE.AnimationMixer(clone);
    const swim = mixer.clipAction(template.swim);
    const tread = mixer.clipAction(template.tread);
    const idle = template.idle ? mixer.clipAction(template.idle) : null;
    swim.setLoop(THREE.LoopRepeat, Infinity);
    tread.setLoop(THREE.LoopRepeat, Infinity);
    swim.play();
    tread.play();
    if (idle) {
      idle.setLoop(THREE.LoopRepeat, Infinity);
      idle.play();
      idle.setEffectiveWeight(0);
    }
    swim.time = (playerId * 0.41) % Math.max(0.01, swim.getClip().duration);
    tread.time = (playerId * 0.27) % Math.max(0.01, tread.getClip().duration);
    tread.setEffectiveWeight(1);
    swim.setEffectiveWeight(0);
    mixer.update(0);

    const rig: SwimmerRig = {
      model: wrapper,
      mixer,
      swim,
      tread,
      spine,
      chest,
      upperL,
      lowerL,
      handL,
      upperR,
      lowerR,
      handR,
      palmSocket: null,
      hips: findBone(wrapper, 'Hips') ?? findBone(wrapper, 'Pelvis'),
      thighL: findBone(wrapper, 'Thigh_L'),
      thighR: findBone(wrapper, 'Thigh_R'),
      idle,
      head: findBone(wrapper, 'Head'),
      neck: findBone(wrapper, 'Neck'),
      posed: [],
      hasClip: false,
      aimSpring: spring1(),
      wIdle: spring1(),
      wTread: spring1(1),
      wSwim: spring1(),
      stroke: spring1(),
      catchSpring: spring1(),
      holdSpring: spring1(),
      throwSpring: spring1(),
      curveRightSpring: spring1(),
      curveUpSpring: spring1(),
      kickSpring: spring1(),
      burstSpring: spring1(),
      bankSpring: spring1(),
      pitchSpring: spring1(),
      headYaw: spring1(),
      headPitch: spring1(),
      armLag: spring1(),
      legLag: spring1(),
      prevFacing: new THREE.Vector3(),
      lenUpperL: lowerL.position.length(),
      lenLowerL: handL.position.length(),
      lenUpperR: lowerR.position.length(),
      lenLowerR: handR.position.length(),
      swimWeight: 0,
      catchBlend: 0,
      holdBlend: 0,
      throwShown: 0,
      curveRightShown: 0,
      curveUpShown: 0,
      speedSwim: 0,
      aimPosture: 0,
    };
    disposeProcedural(group);
    group.add(wrapper);
    const flash = group.getObjectByName('hitFlash');
    if (flash) flash.scale.setScalar(1.35);
    const head = requireBone(wrapper, 'Head');
    const badge = group.getObjectByName('teamBadge');
    if (badge) {
      // Sit above the hair. The rig is scaled, so undo that on the badge or it balloons.
      head.add(badge);
      badge.position.set(0, 0.46, 0.02);
      badge.scale.setScalar(0.62 / SWIMMER_MODEL_SCALE);
    }
    const ring = group.getObjectByName('youRing');
    if (ring) ring.position.y = -0.08;
    group.userData.swimmerRig = rig;
    return rig;
  } catch {
    clone.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of materialList(mesh)) material.dispose();
    });
    return null;
  }
}

function releaseModel(model: THREE.Object3D): void {
  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of materialList(mesh)) material.dispose();
  });
}

/** Drop the current rig and dress this swimmer again. Geometries stay on the template. */
export function replaceSwimmerModel(
  group: THREE.Group,
  template: SwimmerTemplate,
  team: 0 | 1,
  playerId: number,
): SwimmerRig | null {
  const existing = group.userData.swimmerRig as SwimmerRig | undefined;
  if (existing) {
    const badge = existing.model.getObjectByName('teamBadge');
    if (badge) group.add(badge);
    existing.mixer.stopAllAction();
    group.remove(existing.model);
    releaseModel(existing.model);
    delete group.userData.swimmerRig;
  }
  return attachSwimmerModel(group, template, team, playerId);
}

export interface ForgeBody {
  object3D: THREE.Group;
  mixer: THREE.AnimationMixer;
  clips: Record<string, THREE.AnimationClip>;
  socket(name: string): THREE.Object3D | null;
  dispose(): void;
}

/**
 * Dress a swimmer in a Character Forge body. Swim, Tread, and Idle keep the
 * same crossfade as the old GLB. The throw hand's ball sits on `hand_r`.
 */
export function attachForgeSwimmer(group: THREE.Group, body: ForgeBody, playerId: number): SwimmerRig | null {
  const existing = group.userData.swimmerRig as SwimmerRig | undefined;
  if (existing) return existing;
  const swimClip = body.clips.Swim;
  const treadClip = body.clips.Tread;
  if (!swimClip || !treadClip) return null;
  const wrapper = new THREE.Group();
  wrapper.name = 'swimmerModel';
  wrapper.add(body.object3D);
  body.object3D.updateWorldMatrix(true, true);
  const trans = body.object3D.getObjectByName('Trans');
  const transHeight = new THREE.Vector3();
  if (trans) trans.getWorldPosition(transHeight);
  const pivotY = trans ? transHeight.y : MODEL_PIVOT_Y;
  wrapper.scale.setScalar(SWIMMER_MODEL_SCALE);
  wrapper.position.y = -pivotY * SWIMMER_MODEL_SCALE;
  try {
    const spine = requireBone(wrapper, 'Spine');
    const chest = requireBone(wrapper, 'Chest');
    const upperL = requireBone(wrapper, 'UpperArm_L');
    const lowerL = requireBone(wrapper, 'LowerArm_L');
    const handL = requireBone(wrapper, 'Hand_L');
    const upperR = requireBone(wrapper, 'UpperArm_R');
    const lowerR = requireBone(wrapper, 'LowerArm_R');
    const handR = requireBone(wrapper, 'Hand_R');
    const mixer = body.mixer;
    const swim = mixer.clipAction(swimClip);
    const tread = mixer.clipAction(treadClip);
    const idleClip = body.clips.Idle ?? null;
    const idle = idleClip ? mixer.clipAction(idleClip) : null;
    swim.setLoop(THREE.LoopRepeat, Infinity);
    tread.setLoop(THREE.LoopRepeat, Infinity);
    swim.play();
    tread.play();
    if (idle) {
      idle.setLoop(THREE.LoopRepeat, Infinity);
      idle.play();
      idle.setEffectiveWeight(0);
    }
    swim.time = (playerId * 0.41) % Math.max(0.01, swim.getClip().duration);
    tread.time = (playerId * 0.27) % Math.max(0.01, tread.getClip().duration);
    tread.setEffectiveWeight(1);
    swim.setEffectiveWeight(0);
    mixer.update(0);
    const rig: SwimmerRig = {
      model: wrapper,
      mixer,
      swim,
      tread,
      spine,
      chest,
      upperL,
      lowerL,
      handL,
      upperR,
      lowerR,
      handR,
      palmSocket: body.socket('hand_r'),
      hips: findBone(wrapper, 'Hips') ?? findBone(wrapper, 'Pelvis'),
      thighL: findBone(wrapper, 'Thigh_L'),
      thighR: findBone(wrapper, 'Thigh_R'),
      idle,
      head: findBone(wrapper, 'Head'),
      neck: findBone(wrapper, 'Neck'),
      posed: [],
      hasClip: false,
      aimSpring: spring1(),
      wIdle: spring1(),
      wTread: spring1(1),
      wSwim: spring1(),
      stroke: spring1(),
      catchSpring: spring1(),
      holdSpring: spring1(),
      throwSpring: spring1(),
      curveRightSpring: spring1(),
      curveUpSpring: spring1(),
      kickSpring: spring1(),
      burstSpring: spring1(),
      bankSpring: spring1(),
      pitchSpring: spring1(),
      headYaw: spring1(),
      headPitch: spring1(),
      armLag: spring1(),
      legLag: spring1(),
      prevFacing: new THREE.Vector3(),
      lenUpperL: lowerL.position.length(),
      lenLowerL: handL.position.length(),
      lenUpperR: lowerR.position.length(),
      lenLowerR: handR.position.length(),
      swimWeight: 0,
      catchBlend: 0,
      holdBlend: 0,
      throwShown: 0,
      curveRightShown: 0,
      curveUpShown: 0,
      speedSwim: 0,
      aimPosture: 0,
    };
    body.object3D.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of list) ensureWaterFog(material);
    });
    disposeProcedural(group);
    group.add(wrapper);
    const flash = group.getObjectByName('hitFlash');
    if (flash) flash.scale.setScalar(1.35);
    const head = requireBone(wrapper, 'Head');
    const badge = group.getObjectByName('teamBadge');
    if (badge) {
      head.add(badge);
      badge.position.set(0, 0.46, 0.02);
      badge.scale.setScalar(0.62 / SWIMMER_MODEL_SCALE);
    }
    const ring = group.getObjectByName('youRing');
    if (ring) ring.position.y = -0.08;
    group.userData.swimmerRig = rig;
    group.userData.forgeBody = body;
    return rig;
  } catch {
    wrapper.remove(body.object3D);
    return null;
  }
}

export function releaseSwimmerRig(group: THREE.Group): void {
  const existing = group.userData.swimmerRig as SwimmerRig | undefined;
  if (!existing) return;
  const badge = existing.model.getObjectByName('teamBadge');
  if (badge) group.add(badge);
  existing.mixer.stopAllAction();
  group.remove(existing.model);
  const forge = group.userData.forgeBody as ForgeBody | undefined;
  if (forge) forge.dispose();
  else releaseModel(existing.model);
  delete group.userData.swimmerRig;
  delete group.userData.forgeBody;
}

export function swimmerRig(group: THREE.Object3D): SwimmerRig | null {
  return (group.userData.swimmerRig as SwimmerRig | undefined) ?? null;
}

function fillGoal(player: PlayerState, _sim: Simulation, swimWeight: number, catchBlend: number, holdBlend: number): void {
  goal.weight = 0;
  goal.lean = 0;
  goal.chestYaw = 0;
  goal.cock = 0;
  goal.driven = false;
  goal.palm = 0;
  const upright = 1 - swimWeight;
  const pose = player.actionPose;

  if (pose === 'burst') {
    const follow = THREE.MathUtils.clamp(player.actionPoseTime / 0.12, 0, 1);
    _goalL.copy(BURST_L);
    _goalR.copy(BURST_R);
    goal.weight = follow;
    goal.chestYaw = -0.55 * follow;
    goal.lean = 0.2 * follow * upright;
    return;
  }

  if (throwLive.active) {
    const sample = sampleThrowPose(
      throwLive.power,
      throwLive.release,
      throwLive.pass,
      throwLive.curveRight,
      throwLive.curveUp,
      throwLive.throwRight,
    );
    // Swim is already horizontal around Trans, so a full pitch would fold the body.
    // The twist still reads. Tread gets the whole lunge.
    const leanScale = 0.4 + 0.6 * upright;
    const yawScale = 0.62 + 0.38 * upright;
    const fade = sample.armWeight;
    _goalL.set(sample.offX, sample.offY, sample.offZ);
    _goalR.set(sample.handX, sample.handY, sample.handZ);
    // sampleThrowPose already mirrored for a left throw, so hand is always the throw side's numbers
    // and off is the other side. Map them onto L/R by which arm throws.
    if (throwLive.throwRight) {
      goal.weightL = sample.offWeight;
      goal.weightR = sample.armWeight;
      goal.poleLX = 0.8;
      goal.poleLY = -0.15;
      goal.poleLZ = 0.2;
      goal.poleRX = sample.poleX;
      goal.poleRY = sample.poleY;
      goal.poleRZ = sample.poleZ;
    } else {
      _goalL.set(sample.handX, sample.handY, sample.handZ);
      _goalR.set(sample.offX, sample.offY, sample.offZ);
      goal.weightL = sample.armWeight;
      goal.weightR = sample.offWeight;
      goal.poleRX = -0.8;
      goal.poleRY = -0.15;
      goal.poleRZ = 0.2;
      goal.poleLX = sample.poleX;
      goal.poleLY = sample.poleY;
      goal.poleLZ = sample.poleZ;
    }
    goal.chestYaw = sample.chestYaw * yawScale * fade;
    goal.lean = sample.lean * leanScale * fade;
    goal.weight = Math.max(sample.armWeight, sample.offWeight);
    goal.driven = true;
    goal.palm = fade;
    goal.palmX = sample.palmX;
    goal.palmY = sample.palmY;
    goal.palmZ = sample.palmZ;
    return;
  }

  const reach = catchBlend * (1 - holdBlend);
  const hold = holdBlend;
  const weight = reach + hold - reach * hold;
  if (weight < 0.001) return;
  _goalL.copy(CATCH_L).lerp(HOLD_L, hold);
  _goalR.copy(CATCH_R).lerp(HOLD_R, hold);
  goal.weight = weight;
  // Tread is upright and the carry point is in front of the hips. Lean the spine
  // toward it. Swim is already horizontal around Trans, so this lean fades out.
  goal.lean = (0.28 * reach + 0.42 * hold) * upright;
}

const _kickAxis = new THREE.Vector3(1, 0, 0);
const _kickQ = new THREE.Quaternion();
const _clipQ = new THREE.Quaternion();
const _lagQ = new THREE.Quaternion();

function rememberPosed(rig: SwimmerRig, bone: THREE.Bone | null): void {
  if (!bone) return;
  if (rig.posed.some((entry) => entry.bone === bone)) return;
  rig.posed.push({ bone, clip: bone.quaternion.clone() });
}

/** Put last frame's sampled pose back so a skipped mixer write cannot stack offsets. */
function restoreClipPose(rig: SwimmerRig): void {
  if (!rig.hasClip) return;
  for (const entry of rig.posed) entry.bone.quaternion.copy(entry.clip);
}

function captureClipPose(rig: SwimmerRig): void {
  for (const entry of rig.posed) entry.clip.copy(entry.bone.quaternion);
  rig.hasClip = true;
}

function clipOf(rig: SwimmerRig, bone: THREE.Bone): THREE.Quaternion {
  const entry = rig.posed.find((item) => item.bone === bone);
  return entry ? entry.clip : bone.quaternion;
}

/** `offset` is applied on the pose the mixer sampled this frame, never on last frame's result. */
function applyOffset(bone: THREE.Bone, clip: THREE.Quaternion, offset: THREE.Quaternion): void {
  bone.quaternion.copy(clip).multiply(offset);
}

/** Shortest swing of `from` onto `to`. Near-opposite directions use a stable axis. */
function swingOnto(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Quaternion): void {
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) {
    out.identity();
    return;
  }
  _fromY.copy(from).normalize();
  _localDir.copy(to).normalize();
  const dot = THREE.MathUtils.clamp(_fromY.dot(_localDir), -1, 1);
  if (dot > 0.9995) {
    out.identity();
    return;
  }
  if (dot < -0.9995) {
    _pole.set(0, 1, 0);
    if (Math.abs(_fromY.y) > 0.9) _pole.set(1, 0, 0);
    _pole.cross(_fromY);
    if (_pole.lengthSq() < 1e-8) _pole.set(1, 0, 0);
    else _pole.normalize();
    out.setFromAxisAngle(_pole, Math.PI);
    return;
  }
  out.setFromUnitVectors(_fromY, _localDir);
}

/**
 * Point the bone's local +Y along `worldDir`, then twist so local +X favors `twistWorld`.
 * `weight` slerps from the clip pose the mixer just wrote.
 */
function aimBone(bone: THREE.Bone, worldDir: THREE.Vector3, twistWorld: THREE.Vector3, weight: number): void {
  const parent = bone.parent;
  if (!parent) return;
  parent.updateWorldMatrix(true, false);
  _parentQ.copy(parent.getWorldQuaternion(_parentQ));
  _invParent.copy(_parentQ).invert();
  _localDir.copy(worldDir).applyQuaternion(_invParent);
  if (_localDir.lengthSq() < 1e-8) return;
  _localDir.normalize();

  const current = bone.quaternion;
  _clipQ.copy(current);
  _fromY.set(0, 1, 0).applyQuaternion(_clipQ);
  if (_fromY.lengthSq() < 1e-10) return;
  swingOnto(_fromY, _localDir, _swing);
  _aimed.copy(_swing).multiply(_clipQ);

  _localX.set(1, 0, 0).applyQuaternion(_aimed);
  _twist.copy(twistWorld).applyQuaternion(_invParent);
  _twist.addScaledVector(_localDir, -_twist.dot(_localDir));
  _localX.addScaledVector(_localDir, -_localX.dot(_localDir));
  if (_twist.lengthSq() > 1e-6 && _localX.lengthSq() > 1e-6) {
    // Roll around the aimed axis. atan2 stays on the short arc, including across ±180°.
    _pole.crossVectors(_localX, _twist);
    const twistAngle = Math.atan2(_pole.dot(_localDir), THREE.MathUtils.clamp(_localX.dot(_twist), -1, 1));
    _roll.setFromAxisAngle(_localDir, twistAngle);
    _aimed.premultiply(_roll);
  }

  const blend = THREE.MathUtils.clamp(weight, 0, 1);
  if (blend >= 0.999) current.copy(_aimed);
  else current.copy(_clipQ).slerp(_aimed, blend);
}

function solveArm(
  upper: THREE.Bone,
  lower: THREE.Bone,
  lenUpper: number,
  lenLower: number,
  targetWorld: THREE.Vector3,
  poleWorld: THREE.Vector3,
  weight: number,
): void {
  if (weight < 0.02) return;
  upper.updateWorldMatrix(true, false);
  _shoulder.setFromMatrixPosition(upper.matrixWorld);
  const L1 = Math.max(1e-4, lenUpper * SWIMMER_MODEL_SCALE);
  const L2 = Math.max(1e-4, lenLower * SWIMMER_MODEL_SCALE);
  _dir.copy(targetWorld).sub(_shoulder);
  const raw = _dir.length();
  if (raw < 1e-5) return;
  _dir.multiplyScalar(1 / raw);
  const dist = THREE.MathUtils.clamp(raw, Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
  const cosShoulder = THREE.MathUtils.clamp((dist * dist + L1 * L1 - L2 * L2) / (2 * dist * L1), -1, 1);
  const shoulderAngle = Math.acos(cosShoulder);

  _pole.copy(poleWorld).sub(_shoulder);
  _pole.addScaledVector(_dir, -_pole.dot(_dir));
  if (_pole.lengthSq() < 1e-8) _pole.set(0, 1, 0).addScaledVector(_dir, -_dir.y);
  if (_pole.lengthSq() < 1e-8) _pole.set(1, 0, 0);
  _pole.normalize();

  _upperDir
    .copy(_dir)
    .multiplyScalar(Math.cos(shoulderAngle))
    .addScaledVector(_pole, Math.sin(shoulderAngle))
    .normalize();
  aimBone(upper, _upperDir, _pole, weight);

  upper.updateWorldMatrix(true, true);
  _elbow.setFromMatrixPosition(lower.matrixWorld);
  _lowerDir.copy(targetWorld).sub(_elbow);
  if (_lowerDir.lengthSq() < 1e-8) return;
  _lowerDir.normalize();
  aimBone(lower, _lowerDir, _pole, weight);
}

/**
 * Swim when moving, tread when slow or aiming. The group stays on facing/up.
 * Swim lays the body along +Z around `Trans`. Tread stands upright, and the aim
 * posture pitches only the visual rig so the camera aim is unchanged.
 * Gameplay poses are bone offsets after the mixer, so the throw arms still win.
 */
export function updateSwimmerRig(
  rig: SwimmerRig,
  group: THREE.Group,
  player: PlayerState,
  sim: Simulation,
  dt: number,
): void {
  const tun = sim.tunables;
  const stiffness = Math.max(0.5, tun.blendStiffness);
  const speed = player.velocity.length();
  const cruise = Math.max(4, tun.playerMaxSpeed * tun.sprintMult);
  const speed01 = Math.min(1, speed / cruise);
  const slow = Math.max(0.4, tun.bodyIdleSpeed);
  const moving = THREE.MathUtils.smoothstep(speed, slow * 0.45, slow * 1.25);

  const pose = player.actionPose;
  const aimingShot = sim.shotAim.active && player.id === sim.humanId;
  const catchTarget = pose === 'claim' || player.catchReady ? 1 : 0;
  const holdTarget = pose === 'hold' || aimingShot ? 1 : 0;
  rig.catchBlend = springTo(rig.catchSpring, catchTarget, stiffness, dt);
  rig.holdBlend = springTo(rig.holdSpring, holdTarget, stiffness * 1.15, dt);

  const humanThrow = player.id === sim.humanId && player.role === 'human';
  const aiWind = player.role === 'ai' && player.windup > 0.01 && player.windupKind !== 'none';
  const chargingShot =
    (humanThrow && sim.charge.active && sim.charge.kind === 'shoot' && (sim.shotAim.active || pose === 'hold')) ||
    (aiWind && player.windupKind === 'shoot');
  const chargingPass = (humanThrow && sim.charge.active && sim.charge.kind === 'pass') || (aiWind && player.windupKind === 'pass');
  const releasingShot = pose === 'shoot' && !chargingShot;
  const releasingPass = pose === 'pass' && !chargingPass;
  const throwing = chargingShot || chargingPass || releasingShot || releasingPass;
  let targetPower = 0;
  let release = -1;
  let curveR = 0;
  let curveU = 0;
  if (chargingShot) {
    targetPower = aiWind ? player.windup : sim.charge.amount;
    curveR = aiWind ? player.throwCurveRight : THREE.MathUtils.clamp(sim.shotAim.bendRight / 22, -1, 1);
    curveU = aiWind ? player.throwCurveUp : THREE.MathUtils.clamp(sim.shotAim.bendUp / 22, -1, 1);
  } else if (chargingPass) {
    targetPower = aiWind ? player.windup : sim.charge.amount;
  } else if (releasingShot || releasingPass) {
    targetPower = player.throwPosePower;
    const duration = Math.max(0.05, player.actionPoseDuration);
    release = 1 - THREE.MathUtils.clamp(player.actionPoseTime / duration, 0, 1);
    curveR = player.throwCurveRight;
    curveU = player.throwCurveUp;
  }
  rig.throwShown = springTo(rig.throwSpring, throwing ? targetPower : 0, stiffness, dt);
  rig.curveRightShown = springTo(rig.curveRightSpring, throwing ? curveR : 0, stiffness, dt);
  rig.curveUpShown = springTo(rig.curveUpSpring, throwing ? curveU : 0, stiffness, dt);
  throwLive.active = throwing;
  throwLive.power = rig.throwShown;
  throwLive.release = release;
  throwLive.pass = chargingPass || releasingPass;
  throwLive.curveRight = rig.curveRightShown;
  throwLive.curveUp = rig.curveUpShown;
  throwLive.throwRight = player.throwArm !== 'left';

  const aiming = wantsAimPosture({
    human: humanThrow,
    strafing: sim.strafing,
    hasBall: player.hasBall,
    catchReady: player.catchReady,
    throwing,
    burst: pose === 'burst',
    pose,
  });
  rig.aimPosture = stepAimPosture(rig.aimSpring, aiming, tun.aimPostureBlend, dt);
  // Moving picks swim. Still picks idle. Aim stands up into the tread. Springs keep the crossfade from popping.
  const upright = rig.aimPosture;
  const idleTarget = rig.idle ? (1 - moving) * (1 - upright) : 0;
  const swimTarget = moving * (1 - upright);
  const treadTarget = rig.idle ? upright : upright + (1 - moving) * (1 - upright);
  springTo(rig.wIdle, idleTarget, stiffness, dt);
  springTo(rig.wSwim, swimTarget, stiffness, dt);
  springTo(rig.wTread, treadTarget, stiffness, dt);
  rig.wIdle.value = Math.max(0, rig.wIdle.value);
  rig.wSwim.value = Math.max(0, rig.wSwim.value);
  rig.wTread.value = Math.max(0, rig.wTread.value);
  let weightSum = rig.wIdle.value + rig.wSwim.value + rig.wTread.value;
  if (weightSum < 1e-4) {
    rig.wTread.value = 1;
    weightSum = 1;
  }
  rig.swimWeight = rig.wSwim.value / weightSum;
  rig.speedSwim = moving;
  rig.swim.setEffectiveWeight(rig.swimWeight);
  rig.tread.setEffectiveWeight(rig.wTread.value / weightSum);
  if (rig.idle) rig.idle.setEffectiveWeight(rig.wIdle.value / weightSum);
  const amount = tun.swimAnim ? tun.swimAnimAmount / Math.max(0.05, PLAYER.swimAnimAmount) : 0;
  const strokeTarget = tun.swimAnim ? tun.swimAnimRate * (0.35 + 1.05 * speed01) * amount : 0;
  springTo(rig.stroke, strokeTarget, stiffness, dt);
  rig.swim.setEffectiveTimeScale(Math.max(0, rig.stroke.value) * SWIM_CLIP_SECONDS);
  const treadRate = tun.swimAnim ? 0.65 + 0.55 * upright + 0.3 * speed01 : 0;
  rig.tread.setEffectiveTimeScale(treadRate);
  if (rig.idle) rig.idle.setEffectiveTimeScale(tun.swimAnim ? 0.75 : 0);

  rememberPosed(rig, rig.spine);
  rememberPosed(rig, rig.chest);
  rememberPosed(rig, rig.upperL);
  rememberPosed(rig, rig.lowerL);
  rememberPosed(rig, rig.handL);
  rememberPosed(rig, rig.upperR);
  rememberPosed(rig, rig.lowerR);
  rememberPosed(rig, rig.handR);
  rememberPosed(rig, rig.hips);
  rememberPosed(rig, rig.thighL);
  rememberPosed(rig, rig.thighR);
  rememberPosed(rig, rig.head);
  rememberPosed(rig, rig.neck);
  restoreClipPose(rig);
  rig.mixer.update(dt);
  captureClipPose(rig);

  const up = authoritativeUp(tun.goalAxisUp);
  const turn = bodyTurn(rig, player, up);
  rig.headYaw.value += turn.yaw * 0.85;
  rig.headPitch.value += turn.pitch * 0.55;
  rig.armLag.value += turn.yaw * 0.45;
  rig.legLag.value += turn.yaw * -0.3;
  springTo(rig.headYaw, 0, stiffness * 0.7, dt);
  springTo(rig.headPitch, 0, stiffness * 0.7, dt);
  springTo(rig.armLag, 0, stiffness * 0.65, dt);
  springTo(rig.legLag, 0, stiffness * 0.65, dt);
  rig.headYaw.value = THREE.MathUtils.clamp(rig.headYaw.value, -0.55, 0.55);
  rig.headPitch.value = THREE.MathUtils.clamp(rig.headPitch.value, -0.4, 0.4);
  rig.armLag.value = THREE.MathUtils.clamp(rig.armLag.value, -0.4, 0.4);
  rig.legLag.value = THREE.MathUtils.clamp(rig.legLag.value, -0.35, 0.35);

  const right = _pole.crossVectors(player.up, player.facing);
  const lateral = right.lengthSq() > 1e-8 ? player.velocity.dot(right.normalize()) : 0;
  const bankTarget = THREE.MathUtils.clamp(-lateral / cruise, -1, 1) * tun.bankAmount * (1 - upright * 0.65);
  springTo(rig.bankSpring, bankTarget, stiffness, dt);
  const climb = player.velocity.dot(player.up);
  const along = player.velocity.dot(player.facing);
  const swimPitch = Math.atan2(climb, Math.max(1.5, Math.abs(along))) * 0.4 * (1 - upright);
  springTo(rig.pitchSpring, swimPitch, stiffness, dt);
  const burstTarget = pose === 'burst' ? -0.48 : 0;
  springTo(rig.burstSpring, burstTarget, stiffness, dt);
  const visualPitch = aimPosturePitch(player.facing.dot(up), rig.aimPosture) + rig.pitchSpring.value;
  const visualRoll = rig.bankSpring.value + rig.burstSpring.value;
  if (Number.isFinite(visualPitch) && Number.isFinite(visualRoll)) {
    rig.model.rotation.set(visualPitch, 0, visualRoll);
  }

  fillGoal(player, sim, rig.swimWeight, rig.catchBlend, rig.holdBlend);
  if (player.catchReady && !throwLive.active) {
    group.updateMatrixWorld(true);
    _toBall.copy(sim.ball.position);
    group.worldToLocal(_toBall);
    const dist = _toBall.length();
    if (dist > 1e-4) {
      const reach = Math.min(0.95, Math.max(0.5, dist * 0.28));
      _toBall.multiplyScalar(reach / dist);
    } else {
      _toBall.set(0, 0.2, 0.7);
    }
    _goalL.set(0.2, 0.24, 0.12).add(_toBall);
    _goalR.set(-0.2, 0.24, 0.12).add(_toBall);
    goal.weight = Math.max(goal.weight, rig.catchBlend, 0.85);
  }
  if (player.deflectTime > 0.02 && !throwLive.active) {
    const slap = THREE.MathUtils.clamp(player.deflectTime / 0.18, 0, 1);
    _goalL.set(0.16, 0.22, 0.35 + 0.7 * slap);
    _goalR.set(-0.16, 0.22, 0.35 + 0.7 * slap);
    goal.weight = 1;
  }
  if (goal.lean > 0.001) {
    _leanQ.setFromAxisAngle(_leanAxis, goal.lean);
    applyOffset(rig.spine, clipOf(rig, rig.spine), _leanQ);
  }
  if (Math.abs(goal.chestYaw) > 0.001) {
    _yawQ.setFromAxisAngle(_yawAxis, goal.chestYaw);
    applyOffset(rig.chest, clipOf(rig, rig.chest), _yawQ);
  }
  applyKick(rig, player, sim, stiffness, dt);
  applySecondary(rig);
  if (goal.weight < 0.02) {
    group.updateMatrixWorld(true);
    return;
  }

  group.updateMatrixWorld(true);
  // IK solves from the sampled clip, not from this frame's lag offset.
  for (const bone of [rig.upperL, rig.lowerL, rig.handL, rig.upperR, rig.lowerR, rig.handR]) {
    bone.quaternion.copy(clipOf(rig, bone));
  }
  group.localToWorld(_targetL.copy(_goalL));
  group.localToWorld(_targetR.copy(_goalR));

  if (goal.driven) {
    _poleL.set(goal.poleLX, goal.poleLY, goal.poleLZ);
    _poleR.set(goal.poleRX, goal.poleRY, goal.poleRZ);
  } else {
    const cock = goal.cock;
    _poleL.set(0.85, -0.2, THREE.MathUtils.lerp(0.2, -1.15, cock));
    _poleR.set(-0.85, -0.2, THREE.MathUtils.lerp(0.2, -1.15, cock));
  }
  _poleWorld.copy(_poleL).applyQuaternion(group.quaternion);
  _shoulder.setFromMatrixPosition(rig.upperL.matrixWorld);
  _poleL.copy(_shoulder).add(_poleWorld);
  _poleWorld.copy(_poleR).applyQuaternion(group.quaternion);
  _shoulder.setFromMatrixPosition(rig.upperR.matrixWorld);
  _poleR.copy(_shoulder).add(_poleWorld);

  const carryRight = player.throwArm !== 'left';
  let weightL: number;
  let weightR: number;
  if (goal.driven) {
    weightL = goal.weightL;
    weightR = goal.weightR;
  } else {
    // The off arm fades back to the swim or tread clip. A full two-arm hold
    // plus the stroke flings a palmed ball through the torso.
    const off = 1 - rig.holdBlend;
    weightL = carryRight ? goal.weight * off : goal.weight;
    weightR = carryRight ? goal.weight : goal.weight * off;
  }
  solveArm(rig.upperL, rig.lowerL, rig.lenUpperL, rig.lenLowerL, _targetL, _poleL, weightL);
  solveArm(rig.upperR, rig.lowerR, rig.lenUpperR, rig.lenLowerR, _targetR, _poleR, weightR);
  const palmWeight = goal.driven ? goal.palm : rig.holdBlend;
  if (palmWeight > 0.02) {
    const hand = carryRight ? rig.handR : rig.handL;
    const axis = carryRight ? PALM_AXIS_R : PALM_AXIS_L;
    if (goal.driven) _twist.set(goal.palmX, goal.palmY, goal.palmZ);
    else _twist.copy(carryRight ? PALM_DIR_R : PALM_DIR_L);
    _twist.applyQuaternion(group.quaternion);
    orientPalm(hand, axis, _twist, palmWeight);
  }
  group.updateMatrixWorld(true);
}

/**
 * World-space center of a ball sitting in the throw hand's palm.
 * Call after `updateSwimmerRig` so the mixer and the pose offsets are in.
 */
export function readCarrierPalm(rig: SwimmerRig, player: PlayerState, out: THREE.Vector3): THREE.Vector3 {
  const right = player.throwArm !== 'left';
  const hand = right ? rig.handR : rig.handL;
  const axis = right ? PALM_AXIS_R : PALM_AXIS_L;
  const socket = right ? rig.palmSocket : null;
  if (socket) {
    socket.updateWorldMatrix(true, false);
    socket.getWorldPosition(_palmOrigin);
    hand.updateWorldMatrix(true, false);
    hand.getWorldPosition(_palmWant);
    _palmNormal.copy(_palmOrigin).sub(_palmWant);
    if (_palmNormal.lengthSq() < 1e-8) {
      hand.getWorldQuaternion(_parentQ);
      _palmNormal.copy(axis).applyQuaternion(_parentQ);
    }
    if (_palmNormal.lengthSq() > 1e-8) _palmNormal.normalize();
    return out.copy(_palmOrigin).addScaledVector(_palmNormal, BALL.radius * 0.35);
  }
  hand.updateWorldMatrix(true, false);
  hand.getWorldPosition(_palmOrigin);
  hand.getWorldQuaternion(_parentQ);
  _palmNormal.copy(axis).applyQuaternion(_parentQ);
  if (_palmNormal.lengthSq() > 1e-8) _palmNormal.normalize();
  return out.copy(_palmOrigin).addScaledVector(_palmNormal, BALL.radius);
}

const _palmOrigin = new THREE.Vector3();
const _palmNormal = new THREE.Vector3();
const _palmWant = new THREE.Vector3();

/**
 * Roll the hand around the forearm so the palm axis favors `desiredWorld`.
 * The clip's wrist bend stays; only the twist changes. `weight` slerps from
 * the quaternion the mixer just wrote.
 */
function kickAngle(player: PlayerState, sim: Simulation): number {
  const visual = sim.kickVisual.playerId === player.id;
  if (visual && !sim.kickVisual.swinging && sim.kickVisual.power > 0.02) {
    return -0.95 * THREE.MathUtils.clamp(sim.kickVisual.power, 0, 1);
  }
  const humanKick = player.role === 'human' && sim.charge.kind === 'kick' && sim.charge.active;
  const aiKick = player.windupKind === 'kick' && player.windup > 0.01;
  const charging = humanKick || aiKick;
  const swinging = player.actionPose === 'kick';
  if (!charging && !swinging) return 0;
  const power = swinging ? player.throwPosePower : aiKick ? player.windup : sim.charge.amount;
  if (!swinging) return -0.9 * THREE.MathUtils.clamp(power, 0, 1);
  const duration = Math.max(0.05, player.actionPoseDuration);
  const t = 1 - THREE.MathUtils.clamp(player.actionPoseTime / duration, 0, 1);
  const cock = -1.05 * Math.max(0.35, power);
  const through = 1.15 * Math.max(0.45, power);
  return t < 0.45
    ? THREE.MathUtils.lerp(cock, through, t / 0.45)
    : THREE.MathUtils.lerp(through, 0.2, (t - 0.45) / 0.55);
}

function applyKick(rig: SwimmerRig, player: PlayerState, sim: Simulation, stiffness: number, dt: number): void {
  springTo(rig.kickSpring, kickAngle(player, sim), stiffness, dt);
  const angle = rig.kickSpring.value;
  const lag = rig.legLag.value;
  const poseThigh = (thigh: THREE.Bone | null, kick: number, trail: number): void => {
    if (!thigh) return;
    const total = kick + trail;
    if (Math.abs(total) < 0.015) return;
    _kickQ.setFromAxisAngle(_kickAxis, total);
    applyOffset(thigh, clipOf(rig, thigh), _kickQ);
  };
  const throwLeft = player.throwArm === 'left';
  poseThigh(rig.thighL, throwLeft ? angle : 0, lag);
  poseThigh(rig.thighR, throwLeft ? 0 : angle, -lag * 0.8);
  if (rig.hips && Math.abs(angle) >= 0.02) {
    _kickQ.setFromAxisAngle(_kickAxis, angle * 0.16);
    applyOffset(rig.hips, clipOf(rig, rig.hips), _kickQ);
  }
}

/** Head, arms, and legs trail the body's turn. Offsets start from this frame's clip pose. */
function applySecondary(rig: SwimmerRig): void {
  if (rig.head && (Math.abs(rig.headYaw.value) > 0.01 || Math.abs(rig.headPitch.value) > 0.01)) {
    _yawQ.setFromAxisAngle(_yawAxis, rig.headYaw.value);
    _leanQ.setFromAxisAngle(_leanAxis, rig.headPitch.value);
    _lagQ.copy(_yawQ).multiply(_leanQ);
    applyOffset(rig.head, clipOf(rig, rig.head), _lagQ);
  }
  const arm = rig.armLag.value;
  if (Math.abs(arm) > 0.01) {
    _lagQ.setFromAxisAngle(_yawAxis, arm);
    applyOffset(rig.upperL, clipOf(rig, rig.upperL), _lagQ);
    _lagQ.setFromAxisAngle(_yawAxis, arm * 0.85);
    applyOffset(rig.upperR, clipOf(rig, rig.upperR), _lagQ);
  }
}

/**
 * Yaw and pitch the facing gained this frame, wrapped to the short arc.
 * A zero or broken facing contributes nothing.
 */
function bodyTurn(rig: SwimmerRig, player: PlayerState, up: THREE.Vector3): { yaw: number; pitch: number } {
  const facing = player.facing;
  const prev = rig.prevFacing;
  if (facing.lengthSq() < 1e-8 || !Number.isFinite(facing.x)) return { yaw: 0, pitch: 0 };
  if (prev.lengthSq() < 1e-8) {
    prev.copy(facing);
    return { yaw: 0, pitch: 0 };
  }
  _fromY.copy(prev).addScaledVector(up, -prev.dot(up));
  _localDir.copy(facing).addScaledVector(up, -facing.dot(up));
  let yaw = 0;
  if (_fromY.lengthSq() > 1e-8 && _localDir.lengthSq() > 1e-8) {
    _fromY.normalize();
    _localDir.normalize();
    _pole.crossVectors(_fromY, _localDir);
    yaw = Math.atan2(_pole.dot(up), THREE.MathUtils.clamp(_fromY.dot(_localDir), -1, 1));
  }
  const prevPitch = Math.asin(THREE.MathUtils.clamp(prev.dot(up), -1, 1));
  const nextPitch = Math.asin(THREE.MathUtils.clamp(facing.dot(up), -1, 1));
  let pitch = nextPitch - prevPitch;
  if (pitch > Math.PI) pitch -= Math.PI * 2;
  if (pitch < -Math.PI) pitch += Math.PI * 2;
  prev.copy(facing);
  return { yaw, pitch };
}

function orientPalm(hand: THREE.Bone, palmLocal: THREE.Vector3, desiredWorld: THREE.Vector3, weight: number): void {
  if (weight < 0.02) return;
  const parent = hand.parent;
  if (!parent) return;
  parent.updateWorldMatrix(true, false);
  _parentQ.copy(parent.getWorldQuaternion(_parentQ));
  _invParent.copy(_parentQ).invert();

  _localX.copy(palmLocal).applyQuaternion(hand.quaternion);
  _palmWant.copy(desiredWorld).applyQuaternion(_invParent);
  _fromY.set(0, 1, 0);
  _localX.addScaledVector(_fromY, -_localX.dot(_fromY));
  _palmWant.addScaledVector(_fromY, -_palmWant.dot(_fromY));
  if (_localX.lengthSq() < 1e-6 || _palmWant.lengthSq() < 1e-6) return;
  _localX.normalize();
  _palmWant.normalize();
  _roll.setFromUnitVectors(_localX, _palmWant);
  _aimed.copy(_roll).multiply(hand.quaternion);
  if (weight >= 0.999) hand.quaternion.copy(_aimed);
  else hand.quaternion.slerp(_aimed, weight);
}
