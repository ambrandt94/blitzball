import * as THREE from 'three';
import { critDampScalar, critDampVec } from '../sim/math';

const _view = new THREE.Vector3();
const _back = new THREE.Vector3();
const _up = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _desired = new THREE.Quaternion();

/**
 * Chase camera. Position stays on the boom (stiffness). Rotation eases toward
 * the supplied upright basis and never picks a new up of its own.
 */
export class ChaseRig {
  readonly position = new THREE.Vector3();
  readonly posVel = new THREE.Vector3();
  readonly look = new THREE.Vector3();
  readonly lookVel = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly up = new THREE.Vector3(0, 1, 0);
  private angleVel = 0;
  private ready = false;

  snap(position: THREE.Vector3, look: THREE.Vector3, up: THREE.Vector3): void {
    this.position.copy(position);
    this.posVel.set(0, 0, 0);
    this.look.copy(look);
    this.lookVel.set(0, 0, 0);
    this.aimQuaternion(position, look, up, true);
    this.angleVel = 0;
    this.ready = true;
  }

  /**
   * `stiffness` is 0..1 (1 sticks to the boom). `swivel` is the orientation
   * rate in 1/seconds. A half-turn at the default rate finishes in under half
   * a second and is capped so it cannot snap.
   */
  step(
    desiredPos: THREE.Vector3,
    desiredLook: THREE.Vector3,
    cameraUp: THREE.Vector3,
    stiffness: number,
    swivel: number,
    dt: number,
  ): number {
    const stick = THREE.MathUtils.clamp(stiffness, 0, 1);
    const posRate = 10 + stick * 50;
    const turn = Math.max(1, swivel);
    if (!this.ready) {
      this.snap(desiredPos, desiredLook, cameraUp);
      return 0;
    }
    critDampVec(this.position, this.posVel, desiredPos, posRate, dt);
    critDampVec(this.look, this.lookVel, desiredLook, posRate, dt);
    return this.aimQuaternion(this.position, this.look, cameraUp, false, turn, dt);
  }

  private aimQuaternion(
    position: THREE.Vector3,
    look: THREE.Vector3,
    worldUp: THREE.Vector3,
    immediate: boolean,
    omega = 1,
    dt = 0,
  ): number {
    _view.copy(look).sub(position);
    if (_view.lengthSq() < 1e-10) _view.set(0, 0, -1);
    else _view.normalize();
    _back.copy(_view).negate();
    // Use the supplied up. Rebuilding it from world up is what rolled the
    // picture over once the look went steep.
    _up.copy(worldUp).addScaledVector(_view, -worldUp.dot(_view));
    if (_up.lengthSq() < 1e-6) {
      _up.copy(this.up).addScaledVector(_view, -this.up.dot(_view));
      if (_up.lengthSq() < 1e-8) _up.set(0, 1, 0);
    }
    _up.normalize();
    // Local +Z points back at the camera so Three's -Z looks toward `look`.
    _x.crossVectors(_up, _back);
    if (_x.lengthSq() < 1e-8) return 0;
    _x.normalize();
    _y.crossVectors(_back, _x).normalize();
    _basis.makeBasis(_x, _y, _back);
    _desired.setFromRotationMatrix(_basis);
    if (_desired.dot(this.quaternion) < 0) {
      _desired.set(-_desired.x, -_desired.y, -_desired.z, -_desired.w);
    }
    if (immediate || !this.ready) {
      this.quaternion.copy(_desired);
      this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
      return 0;
    }
    let theta = this.quaternion.angleTo(_desired);
    if (theta < 1e-5) {
      this.angleVel = 0;
      this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
      return 0;
    }
    // Spring the remaining angle toward 0. Cap the step so a pole glitch cannot roll the picture over.
    const sprung = critDampScalar(theta, -this.angleVel, omega, dt);
    const remain = Math.max(0, sprung.x);
    let applied = theta - remain;
    // About 10° per frame, so a half-turn takes roughly 0.3–0.5 s and never pops.
    const cap = 10 * (Math.PI / 180);
    if (applied > cap) applied = cap;
    this.angleVel = dt > 0 ? applied / dt : 0;
    this.quaternion.slerp(_desired, applied / theta);
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
    return applied;
  }
}
