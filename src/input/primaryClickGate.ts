/**
 * The click that captures the pointer is not a shot and not a lunge.
 * A press counts only while the pointer is already locked, and a press that
 * is still held when the lock lands is dropped until the button comes up.
 */
export class PrimaryClickGate {
  pointerLocked = false;
  buttonDown = false;
  /** Drop the gesture that acquired pointer lock. */
  suppress = false;
  private suppressOnLock = false;

  setLocked(locked: boolean): void {
    const gained = locked && !this.pointerLocked;
    this.pointerLocked = locked;
    if (!locked) {
      this.suppress = false;
      this.suppressOnLock = false;
      return;
    }
    if (gained && (this.buttonDown || this.suppressOnLock)) {
      this.suppress = true;
      this.suppressOnLock = false;
    }
  }

  /** Call from the click that asks for pointer lock, while that button is down. */
  noteLockRequest(): void {
    if (!this.pointerLocked && this.buttonDown) this.suppressOnLock = true;
  }

  /** True when this press should shoot or burst. */
  pointerDown(): boolean {
    this.buttonDown = true;
    if (!this.pointerLocked || this.suppress) return false;
    return true;
  }

  pointerUp(): void {
    this.buttonDown = false;
    this.suppress = false;
    this.suppressOnLock = false;
  }
}
