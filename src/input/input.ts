// Unified input: touch joystick + buttons, keyboard, gamepad. Zero per-frame alloc.
export interface InputState {
  moveX: number; moveY: number; // -1..1 (x strafe, y forward)
  camDX: number; camDY: number; // camera delta px accumulated per frame
  sprint: boolean; crouch: boolean; crouchToggle: boolean;
  jump: boolean; attack: boolean; heavy: boolean; parry: boolean;
  dodge: boolean; interact: boolean; assassinate: boolean;
  smoke: boolean; knife: boolean; pause: boolean; lure: boolean; special: boolean;
}

export type InputAction = 'jump' | 'attack' | 'heavy' | 'parry' | 'dodge' | 'interact' | 'assassinate' | 'smoke' | 'knife' | 'pause' | 'lure' | 'special';

function freshState(): InputState {
  return {
    moveX: 0, moveY: 0, camDX: 0, camDY: 0, sprint: false, crouch: false, crouchToggle: false,
    jump: false, attack: false, heavy: false, parry: false, dodge: false,
    interact: false, assassinate: false, smoke: false, knife: false, pause: false,
    lure: false, special: false,
  };
}

export class InputManager {
  state: InputState = freshState();
  /** edge-trigger queue: consumed by game each frame */
  pressed = freshState();
  usingTouch = false;
  gamepadPrev: boolean[] = [];
  invertY = false;
  sens = 1;
  private keys = new Set<string>();
  private joyActive = false; private joyId = -1;
  private joyCX = 0; private joyCY = 0; private joyDX = 0; private joyDY = 0;
  private camId = -1; private camLX = 0; private camLY = 0;
  private crouchOn = false;

  init(root: HTMLElement): void {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.applyKey(e.code, true);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); this.applyKey(e.code, false); });
    window.addEventListener('blur', () => this.keys.clear());

    // touch joystick (left half) + camera drag (right half)
    // MULTITOUCH: joy-zone and cam-zone track independent touch identifiers
    // (joyId vs camId), so a joystick finger + a camera finger coexist.
    // Buttons use discrete tap/setHold paths (re-entrant); releaseAll() resets
    // both zones on pause/death.
    const joyZone = root.querySelector<HTMLElement>('#joy-zone');
    const camZone = root.querySelector<HTMLElement>('#cam-zone');
    const knob = root.querySelector<HTMLElement>('#joy-knob');
    const base = root.querySelector<HTMLElement>('#joy-base');
    if (joyZone) {
      joyZone.addEventListener('touchstart', (e) => {
        this.usingTouch = true;
        const t = e.changedTouches[0];
        this.joyId = t.identifier; this.joyActive = true;
        const r = (base ?? joyZone).getBoundingClientRect();
        this.joyCX = r.left + r.width / 2; this.joyCY = r.top + r.height / 2;
        this.moveJoy(t.clientX, t.clientY, knob);
        e.preventDefault();
      }, { passive: false });
      joyZone.addEventListener('touchmove', (e) => {
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier === this.joyId) this.moveJoy(t.clientX, t.clientY, knob);
        }
        e.preventDefault();
      }, { passive: false });
      const end = (e: TouchEvent): void => {
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier === this.joyId) {
            this.joyId = -1; this.joyActive = false; this.joyDX = 0; this.joyDY = 0;
            if (knob) knob.style.transform = 'translate(-50%,-50%)';
          }
        }
      };
      joyZone.addEventListener('touchend', end); joyZone.addEventListener('touchcancel', end);
    }
    if (camZone) {
      camZone.addEventListener('touchstart', (e) => {
        const t = e.changedTouches[0];
        this.camId = t.identifier; this.camLX = t.clientX; this.camLY = t.clientY;
        e.preventDefault();
      }, { passive: false });
      camZone.addEventListener('touchmove', (e) => {
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier === this.camId) {
            this.state.camDX += (t.clientX - this.camLX) * 2.4 * this.sens;
            this.state.camDY += (t.clientY - this.camLY) * 2.4 * this.sens * (this.invertY ? -1 : 1);
            this.camLX = t.clientX; this.camLY = t.clientY;
          }
        }
        e.preventDefault();
      }, { passive: false });
      const end = (): void => { this.camId = -1; };
      camZone.addEventListener('touchend', end); camZone.addEventListener('touchcancel', end);
    }
    // mouse camera for desktop testing
    let dragging = false; let lx = 0; let ly = 0;
    root.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      dragging = true; lx = e.clientX; ly = e.clientY;
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      this.state.camDX += (e.clientX - lx) * 2.2 * this.sens;
      this.state.camDY += (e.clientY - ly) * 2.2 * this.sens * (this.invertY ? -1 : 1);
      lx = e.clientX; ly = e.clientY;
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  private moveJoy(x: number, y: number, knob: HTMLElement | null): void {
    const R = 52;
    let dx = x - this.joyCX; let dy = y - this.joyCY;
    const m = Math.hypot(dx, dy);
    if (m > R) { dx = (dx / m) * R; dy = (dy / m) * R; }
    this.joyDX = dx / R; this.joyDY = dy / R;
    if (knob) knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  private applyKey(code: string, down: boolean): void {
    const s = this.state;
    switch (code) {
      case 'ShiftLeft': case 'ShiftRight': s.sprint = down; break;
      case 'KeyC': if (down) { this.crouchOn = !this.crouchOn; s.crouchToggle = true; } s.crouch = this.crouchOn; break;
      case 'ControlLeft': s.crouch = down; if (down) this.crouchOn = down; break;
      case 'Space': if (down) this.tap('jump'); break;
      case 'KeyJ': if (down) this.tap('attack'); break;
      case 'KeyK': if (down) this.tap('heavy'); break;
      case 'KeyL': if (down) this.tap('parry'); break;
      case 'KeyU': if (down) this.tap('dodge'); break;
      case 'KeyE': if (down) this.tap('interact'); break;
      case 'KeyQ': if (down) this.tap('assassinate'); break;
      case 'KeyG': if (down) this.tap('smoke'); break;
      case 'KeyF': if (down) this.tap('knife'); break;
      case 'KeyT': if (down) this.tap('lure'); break;
      case 'KeyR': if (down) this.tap('special'); break;
      case 'Escape': case 'KeyP': if (down) this.tap('pause'); break;
    }
  }

  tap(action: InputAction): void {
    // Re-entrant + idempotent: repeated taps just re-assert the edge flag;
    // central consumes via pressed[] + lateClear() each frame. Safe to call
    // from keyboard/gamepad/touch/multitouch paths concurrently.
    this.pressed[action] = true; this.state[action] = true;
  }

  /** called by touch buttons.
   *  Re-entrant: toggling crouch twice returns to the prior state; calling
   *  with the same (action, v) twice is a no-op beyond re-assertion. */
  setHold(action: 'sprint' | 'crouch', v: boolean): void {
    if (action === 'sprint') this.state.sprint = v;
    if (action === 'crouch') { if (v) { this.crouchOn = !this.crouchOn; this.pressed.crouchToggle = true; } this.state.crouch = this.crouchOn; }
  }

  /** Clear all held movement/camera state (central calls on pause/death/menu).
   *  Idempotent: safe to call repeatedly; no behavior change to tap/edge paths. */
  releaseAll(): void {
    this.crouchOn = false;
    this.state.sprint = false;
    this.state.crouch = false;
    this.state.crouchToggle = false;
    this.state.moveX = 0; this.state.moveY = 0;
    this.state.camDX = 0; this.state.camDY = 0;
    this.joyActive = false; this.joyId = -1;
    this.joyDX = 0; this.joyDY = 0;
    this.camId = -1; this.camLX = 0; this.camLY = 0;
    this.keys.clear();
    const p = this.pressed;
    (p as { sprint: boolean }).sprint = false;
    (p as { crouch: boolean }).crouch = false;
  }

  /** poll keyboard axes + gamepad, merge with touch joystick. Must be called once per frame. */
  poll(): void {
    const k = this.keys;
    let x = 0; let y = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (this.joyActive) { x += this.joyDX; y -= this.joyDY; }
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && pads[0];
    if (gp && gp.connected) {
      const dz = (v: number): number => (Math.abs(v) < 0.18 ? 0 : v);
      x += dz(gp.axes[0] ?? 0); y -= dz(gp.axes[1] ?? 0);
      this.state.camDX += dz(gp.axes[2] ?? 0) * 14 * this.sens;
      this.state.camDY += dz(gp.axes[3] ?? 0) * 14 * this.sens;
      const b = (i: number): boolean => !!(gp.buttons[i]?.pressed);
      const edge = (i: number, a: InputAction): void => {
        const was = this.gamepadPrev[i] ?? false;
        if (b(i) && !was) this.tap(a);
        this.gamepadPrev[i] = b(i);
      };
      edge(0, 'jump'); edge(2, 'attack'); edge(1, 'dodge'); edge(4, 'parry');
      edge(3, 'heavy'); edge(5, 'assassinate'); edge(9, 'pause');
      edge(14, 'lure'); edge(15, 'special');
      // RB (5) doubles as special when held with LT? keep simple: dpad L/R above.
      if (b(8)) this.pressed.crouchToggle = true;
      if (b(6)) this.tap('smoke'); if (b(7)) this.tap('knife');
      this.state.sprint = this.state.sprint || b(10);
    }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    this.state.moveX = x; this.state.moveY = y;
  }

  /** consume edge triggers at end of frame */
  lateClear(): void {
    const p = this.pressed;
    for (const k of Object.keys(p) as (keyof InputState)[]) {
      if (typeof p[k] === 'boolean') (p[k] as boolean) = false;
    }
    const s = this.state;
    s.jump = s.attack = s.heavy = s.parry = s.dodge = s.interact = s.assassinate = s.smoke = s.knife = s.pause = s.lure = s.special = false;
    s.crouchToggle = false;
    s.camDX = 0; s.camDY = 0;
  }
}
