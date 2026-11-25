import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { PLAYER } from '../game/constants';
import type { PlayerState } from '../game/types';
import type { Simulation } from '../sim/Simulation';
import { TEAM } from './swimmer';

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
 * Carry point is facing×0.85 + up×0.15, and the ball radius is 0.42.
 * Wrists sit on the near face, right hand on the ball, so the head does not
 * have to dive through it.
 */
const HOLD_L = new THREE.Vector3(0.26, 0.16, 0.5);
const HOLD_R = new THREE.Vector3(-0.2, 0.3, 0.54);
const WIND_L = new THREE.Vector3(0.36, 0.42, -0.02);
const WIND_R = new THREE.Vector3(-0.4, 0.5, -0.22);
const PASS_L = new THREE.Vector3(0.3, 0.18, 0.28);
const PASS_R = new THREE.Vector3(-0.12, 0.3, 1.02);
const FOLLOW_L = new THREE.Vector3(0.26, 0.2, 0.98);
const FOLLOW_R = new THREE.Vector3(-0.2, 0.24, 1.12);
const BURST_L = new THREE.Vector3(0.42, 0.14, -0.08);
const BURST_R = new THREE.Vector3(-0.16, 0.18, 1.05);

export interface SwimmerTemplate {
  scene: THREE.Group;
  swim: THREE.AnimationClip;
  tread: THREE.AnimationClip;
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
  lenUpperL: number;
  lenLowerL: number;
  lenUpperR: number;
  lenLowerR: number;
  swimWeight: number;
  catchBlend: number;
  holdBlend: number;
}

const _goalL = new THREE.Vector3();
const _goalR = new THREE.Vector3();
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
      if (material.name === 'TeamTint') tint = true;
    }
  });
  if (!tint) return null;
  return { scene, swim, tread };
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
      nearestTextures(cloned);
      if (cloned instanceof THREE.MeshStandardMaterial && cloned.name === 'TeamTint') {
        cloned.color.setHex(suit);
      }
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
    swim.setLoop(THREE.LoopRepeat, Infinity);
    tread.setLoop(THREE.LoopRepeat, Infinity);
    swim.play();
    tread.play();
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
      lenUpperL: lowerL.position.length(),
      lenLowerL: handL.position.length(),
      lenUpperR: lowerR.position.length(),
      lenLowerR: handR.position.length(),
      swimWeight: 0,
      catchBlend: 0,
      holdBlend: 0,
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

export function swimmerRig(group: THREE.Object3D): SwimmerRig | null {
  return (group.userData.swimmerRig as SwimmerRig | undefined) ?? null;
}

function fillGoal(player: PlayerState, sim: Simulation, swimWeight: number, catchBlend: number, holdBlend: number): void {
  goal.weight = 0;
  goal.lean = 0;
  goal.chestYaw = 0;
  goal.cock = 0;
  const upright = 1 - swimWeight;
  const pose = player.actionPose;
  const humanCharge =
    player.role === 'human' && player.id === sim.humanId && sim.charge.active ? sim.charge : null;
  const aimingShot = sim.shotAim.active && player.id === sim.humanId;

  if (pose === 'burst') {
    const follow = THREE.MathUtils.clamp(player.actionPoseTime / 0.12, 0, 1);
    _goalL.copy(BURST_L);
    _goalR.copy(BURST_R);
    goal.weight = follow;
    goal.chestYaw = -0.55 * follow;
    goal.lean = 0.2 * follow * upright;
    return;
  }
  if (!aimingShot && (pose === 'pass' || humanCharge?.kind === 'pass')) {
    const ext =
      humanCharge?.kind === 'pass' ? 0.3 + 0.7 * humanCharge.amount : Math.min(1, player.actionPoseTime / 0.22);
    _goalL.copy(PASS_L);
    _goalR.copy(PASS_R);
    goal.weight = ext;
    goal.lean = 0.4 * ext * upright;
    return;
  }
  if (!aimingShot && (pose === 'shoot' || humanCharge?.kind === 'shoot')) {
    if (humanCharge?.kind === 'shoot') {
      _goalL.copy(WIND_L);
      _goalR.copy(WIND_R);
      goal.weight = Math.max(0.35, humanCharge.amount);
      goal.cock = humanCharge.amount;
      return;
    }
    const follow = Math.min(1, player.actionPoseTime / 0.26);
    _goalL.copy(FOLLOW_L);
    _goalR.copy(FOLLOW_R);
    goal.weight = follow;
    goal.lean = 0.3 * follow * upright;
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
  if (aimingShot && humanCharge?.kind === 'shoot') goal.cock = humanCharge.amount;
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
  _fromY.set(0, 1, 0).applyQuaternion(current).normalize();
  _swing.setFromUnitVectors(_fromY, _localDir);
  _aimed.copy(_swing).multiply(current);

  _localX.set(1, 0, 0).applyQuaternion(_aimed);
  _twist.copy(twistWorld).applyQuaternion(_invParent);
  _twist.addScaledVector(_localDir, -_twist.dot(_localDir));
  _localX.addScaledVector(_localDir, -_localX.dot(_localDir));
  if (_twist.lengthSq() > 1e-6 && _localX.lengthSq() > 1e-6) {
    _twist.normalize();
    _localX.normalize();
    _roll.setFromUnitVectors(_localX, _twist);
    _aimed.premultiply(_roll);
  }

  if (weight >= 0.999) current.copy(_aimed);
  else current.slerp(_aimed, weight);
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
 * Swim when moving, tread when slow. The group stays on facing/up — Swim already
 * lays the body along +Z around `Trans`, and Tread stays upright, so a second
 * root pitch would fold the swimmer. Gameplay poses are bone offsets after the mixer.
 */
export function updateSwimmerRig(
  rig: SwimmerRig,
  group: THREE.Group,
  player: PlayerState,
  sim: Simulation,
  dt: number,
): void {
  const tun = sim.tunables;
  const speed = player.velocity.length();
  const cruise = Math.max(4, tun.playerMaxSpeed * tun.sprintMult);
  const speed01 = Math.min(1, speed / cruise);
  const slow = Math.max(0.4, tun.bodyIdleSpeed);
  const swimTarget = THREE.MathUtils.smoothstep(speed, slow * 0.45, slow * 1.25);
  rig.swimWeight = THREE.MathUtils.damp(rig.swimWeight, swimTarget, 5.5, dt);

  const amount = tun.swimAnim ? tun.swimAnimAmount / Math.max(0.05, PLAYER.swimAnimAmount) : 0;
  const hz = tun.swimAnimRate * (0.45 + 0.55 * speed01) * amount;
  rig.swim.setEffectiveWeight(rig.swimWeight);
  rig.tread.setEffectiveWeight(1 - rig.swimWeight);
  rig.swim.setEffectiveTimeScale(hz * SWIM_CLIP_SECONDS);
  rig.tread.setEffectiveTimeScale(amount > 0 ? 1 : 0);
  rig.mixer.update(dt);

  const pose = player.actionPose;
  const aimingShot = sim.shotAim.active && player.id === sim.humanId;
  const ready =
    pose === 'claim' ||
    (player.id === sim.humanId &&
      sim.catchStance &&
      !player.hasBall &&
      pose !== 'pass' &&
      pose !== 'shoot' &&
      pose !== 'burst');
  const catchTarget = ready ? 1 : 0;
  const holdTarget = pose === 'hold' || aimingShot ? 1 : 0;
  const ease = (current: number, target: number, rate: number) =>
    current + (target - current) * (1 - Math.exp(-rate * dt));
  rig.catchBlend = ease(rig.catchBlend, catchTarget, 8.5);
  rig.holdBlend = ease(rig.holdBlend, holdTarget, 11);

  fillGoal(player, sim, rig.swimWeight, rig.catchBlend, rig.holdBlend);
  if (goal.lean > 0.001) {
    _leanQ.setFromAxisAngle(_leanAxis, goal.lean);
    rig.spine.quaternion.multiply(_leanQ);
  }
  if (Math.abs(goal.chestYaw) > 0.001) {
    _yawQ.setFromAxisAngle(_yawAxis, goal.chestYaw);
    rig.chest.quaternion.multiply(_yawQ);
  }
  if (goal.weight < 0.02) return;

  group.updateMatrixWorld(true);
  group.localToWorld(_targetL.copy(_goalL));
  group.localToWorld(_targetR.copy(_goalR));

  const cock = goal.cock;
  _poleL.set(0.85, -0.2, THREE.MathUtils.lerp(0.2, -1.15, cock));
  _poleR.set(-0.85, -0.2, THREE.MathUtils.lerp(0.2, -1.15, cock));
  _poleWorld.copy(_poleL).applyQuaternion(group.quaternion);
  _shoulder.setFromMatrixPosition(rig.upperL.matrixWorld);
  _poleL.copy(_shoulder).add(_poleWorld);
  _poleWorld.copy(_poleR).applyQuaternion(group.quaternion);
  _shoulder.setFromMatrixPosition(rig.upperR.matrixWorld);
  _poleR.copy(_shoulder).add(_poleWorld);

  solveArm(rig.upperL, rig.lowerL, rig.lenUpperL, rig.lenLowerL, _targetL, _poleL, goal.weight);
  solveArm(rig.upperR, rig.lowerR, rig.lenUpperR, rig.lenLowerR, _targetR, _poleR, goal.weight);
}
