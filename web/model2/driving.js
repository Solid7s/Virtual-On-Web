// Hardware port layouts from the pinned MAME model2.cpp input definitions.
// Clone sets share their catalog's input layout, not a guessed name prefix.
const wheel = { steer: ['STEER', 0, 128, 255], gas: ['ACCEL', 0, 255], brake: ['BRAKE', 0, 255] };
const sequential = { ...wheel, gearbox: 'sequential', start: 0x40,
  views: [['IN1', 1], ['IN1', 2]], shiftUp: ['IN1', 0x10], shiftDown: ['IN1', 0x20] };
const bike = { ...sequential, steer: ['BANK', 255, 128, 0], gas: ['THROTTLE', 0, 255], views: [['IN0', 0x40]] };
export const DRIVING_PROFILES = {
  daytona: { ...wheel, steer: ['STEER', 32, 128, 224], gas: ['ACCEL', 32, 224], brake: ['BRAKE', 32, 224],
    gearbox: 'hpattern', start: 0x10, views: [['IN0', 0x20], ['IN0', 0x40], ['IN0', 0x80], ['IN1', 1]] },
  srallyc: { ...wheel, gearbox: 'hpattern', start: 0x40, views: [['IN0', 0x20]], handbrake: ['IN2', 0, 255] },
  indy500: sequential, // Also Sega Touring Car Championship.
  sgt24h: { ...sequential, gas: ['ACCEL', 255, 0], brake: ['BRAKE', 255, 0], views: [['IN1', 1]] },
  overrev: { ...sequential, gas: ['ACCEL', 255, 0], brake: ['BRAKE', 255, 0] },
  manxtt: bike,
  motoraid: { ...bike, gearbox: 'none', shiftUp: null, shiftDown: null,
    views: [['IN1', 0x10], ['IN1', 0x20]], cameraLabel: 'A/S: punch/kick; Enter: start/view' },
  desert: { ...wheel, gearbox: 'toggle', start: 0x10, shiftToggle: ['IN1', 1],
    views: [['IN0', 0x20], ['IN0', 0x40], ['IN0', 0x80]], weapons: [['IN1', 0x10], ['IN1', 0x20]] },
};
export const drivingProfile = layout => DRIVING_PROFILES[layout] || null;

export function drivingGuide(profile) {
  const gears = profile.gearbox === 'hpattern' ? '1–4: gears; Q/W: shift down/up.'
    : profile.gearbox === 'sequential' ? 'Q/W: shift down/up (sequential gearbox).'
    : profile.gearbox === 'toggle' ? 'Q/W: toggle low/high gear.' : 'No manual gear input on this game.';
  return `←/→: steer; ↑: accelerate; ↓: brake; 5: coin; Enter: start. ${gears} `
    + (profile.cameraLabel || 'A/S/D/F: camera views (available views depend on the game).')
    + (profile.handbrake ? ' Space: handbrake.' : '')
    + (profile.weapons ? ' J/K: machine gun/cannon.' : '')
    + ' Gamepad: left stick, RT/LT pedals, LB/RB shifting, Back/Start, A/B/X/Y views/actions. F2: arcade test; F3: service. Tab: MAME menu; P: pause.';
}

const keys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Digit5',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyQ', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'F2', 'F3', 'Space', 'KeyJ', 'KeyK']);
export class DriverState {
  constructor(profile) {
    this.profile = profile; this.held = new Set(); this.gear = 1; this.previousPad = [];
    this.shiftUntil = { up: 0, down: 0 };
  }
  key(code, down) {
    if (!keys.has(code)) return false;
    if (down && !this.held.has(code)) {
      if (code === 'KeyQ' || code === 'KeyW') this.shift(code === 'KeyW' ? 1 : -1);
      if (/^Digit[1-4]$/.test(code) && this.profile.gearbox === 'hpattern') this.gear = Number(code.at(-1));
    }
    if (down) this.held.add(code); else this.held.delete(code);
    return true;
  }
  shift(direction, now = performance.now()) {
    if (this.profile.gearbox === 'hpattern') this.gear = Math.max(1, Math.min(4, this.gear + direction));
    else this.shiftUntil[direction > 0 ? 'up' : 'down'] = now + 150;
  }
  clear() { this.held.clear(); this.previousPad = []; this.shiftUntil = { up: 0, down: 0 }; }
  read(pad, touch = {}, now = performance.now()) {
    const pressed = i => !!pad?.buttons[i]?.pressed;
    for (const [i, direction] of [[4, -1], [5, 1]]) if (pressed(i) && !this.previousPad[i]) this.shift(direction, now);
    this.previousPad = [0, 1, 2, 3, 4, 5].map(pressed);
    let buttons = touch.buttons || 0;
    for (const [code, bit] of [['Digit5', 1], ['Enter', 2], ['F2', 4], ['F3', 8],
      ['KeyA', 16], ['KeyS', 32], ['KeyD', 64], ['KeyF', 128]]) if (this.held.has(code)) buttons |= bit;
    if (pressed(8)) buttons |= 1;
    if (pressed(9)) buttons |= 2;
    for (let i = 0; i < 4; i++) if (pressed(i)) buttons |= 1 << (4 + i);
    const steering = Number(this.held.has('ArrowRight')) - Number(this.held.has('ArrowLeft'));
    const axis = Math.max(-1, Math.min(1, pad?.axes[0] || 0));
    return {
      steer: steering || (touch.steer || 0) / 100 || (Math.abs(axis) < 0.08 ? 0 : axis),
      gas: this.held.has('ArrowUp') ? 1 : Math.max(pad?.buttons[7]?.value || 0, (touch.accel || 0) / 100),
      brake: this.held.has('ArrowDown') ? 1 : Math.max(pad?.buttons[6]?.value || 0, (touch.brake || 0) / 100),
      buttons, gear: this.gear,
      up: now < this.shiftUntil.up, down: now < this.shiftUntil.down,
      handbrake: this.held.has('Space'), fire: this.held.has('KeyJ'), cannon: this.held.has('KeyK'),
    };
  }
}

export function drivingFields(profile, state) {
  const fields = new Map();
  const set = (port, mask, value) => fields.set(`${port}:${mask}`, [port, mask, value]);
  // A shared Start/View switch is the OR of both actions.
  const button = ([port, mask], on) => set(port, mask, Number(!!on || !!fields.get(`${port}:${mask}`)?.[2]));
  const pedal = ([port, idle, full], amount) => set(port, 255, Math.round(idle + (full - idle) * Math.max(0, Math.min(1, amount))));
  const [port, left, center, right] = profile.steer;
  set(port, 255, Math.round(center + Math.abs(state.steer) * ((state.steer < 0 ? left : right) - center)));
  pedal(profile.gas, state.gas); pedal(profile.brake, state.brake);
  button(['IN0', 1], state.buttons & 1);
  button(['IN0', profile.start], state.buttons & 2);
  button(['IN0', 4], state.buttons & 4); button(['IN0', 8], state.buttons & 8);
  // Reuse available views when a game has fewer than four, so every step of
  // the original touch VIEW cycle and all four face buttons still work.
  profile.views.forEach(field => button(field, false));
  for (let i = 0; i < 4; i++) button(profile.views[i % profile.views.length], state.buttons & (16 << i));
  if (profile.gearbox === 'hpattern') for (let i = 0; i <= 4; i++) button(['GEARS', 1 << i], i === state.gear);
  if (profile.shiftUp) button(profile.shiftUp, state.up);
  if (profile.shiftDown) button(profile.shiftDown, state.down);
  if (profile.shiftToggle) button(profile.shiftToggle, state.up || state.down);
  if (profile.handbrake) pedal(profile.handbrake, Number(state.handbrake));
  if (profile.weapons) { button(profile.weapons[0], state.fire); button(profile.weapons[1], state.cannon); }
  return [...fields.values()];
}
