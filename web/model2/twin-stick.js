// Virtual-On's two digital arcade sticks, from the pinned model2.cpp ports.
// Catalog input layouts cover the Export, US, Japan and Relay revisions.
export const twinStickProfile = layout => layout === 'von' ? { layout } : null;

const sticks = [
  { port: 'IN1', x: ['KeyA', 'KeyD'], y: ['KeyW', 'KeyS'],
    shot: ['ShiftLeft'], dash: ['Space'], trigger: 6, shoulder: 4 },
  { port: 'IN2', x: ['KeyL', 'Quote'], y: ['KeyP', 'Semicolon'],
    shot: ['ShiftRight'], dash: ['Space'], trigger: 7, shoulder: 5 },
];
const cabinet = [['Digit5', 1], ['Enter', 0x10], ['Digit1', 0x10], ['F2', 4], ['F3', 8]];
const keys = new Set([...sticks.flatMap(s => [...s.x, ...s.y, ...s.shot, ...s.dash]),
  ...cabinet.map(([key]) => key)]);

export class TwinStickState {
  constructor() { this.held = new Set(); this.axes = [0, 0, 0, 0]; }
  key(code, down) {
    if (!keys.has(code)) return false;
    if (down) this.held.add(code); else this.held.delete(code);
    return true;
  }
  clear() { this.held.clear(); this.axes.fill(0); }
  read(pad) {
    if (!pad?.connected || pad.mapping !== 'standard') pad = null;
    const pressed = index => !!pad?.buttons[index]?.pressed || (pad?.buttons[index]?.value || 0) > 0.3;
    const held = keys => keys.some(key => this.held.has(key));
    const axis = (index, keys) => {
      const value = Number.isFinite(pad?.axes[index]) ? pad.axes[index] : 0;
      // Hysteresis prevents a resting/wavering stick from flickering. The
      // hardware receives digital directions, including diagonal positions.
      this.axes[index] = Math.abs(value) >= 0.35 ? Math.sign(value)
        : Math.abs(value) <= 0.2 || Math.sign(value) !== this.axes[index] ? 0 : this.axes[index];
      // Opposite keyboard directions cancel even if the pad is being held.
      return held(keys) ? Number(this.held.has(keys[1])) - Number(this.held.has(keys[0])) : this.axes[index];
    };
    const fields = [];
    const button = (port, mask, on) => fields.push([port, mask, Number(!!on)]);
    for (const [i, stick] of sticks.entries()) {
      const x = axis(i * 2, stick.x), y = axis(i * 2 + 1, stick.y);
      button(stick.port, 0x80, x < 0); button(stick.port, 0x40, x > 0);
      button(stick.port, 0x20, y < 0); button(stick.port, 0x10, y > 0);
      button(stick.port, 1, held(stick.shot) || pressed(stick.trigger));
      button(stick.port, 2, held(stick.dash) || pressed(stick.shoulder));
    }
    for (const mask of [1, 0x10, 4, 8]) button('IN0', mask,
      cabinet.some(([key, bit]) => bit === mask && this.held.has(key))
      || (mask === 1 && pressed(8)) || (mask === 0x10 && pressed(9)));
    return fields;
  }
}

export function twinStickGuide() {
  return "Twin sticks: WASD + P L ; '; left/right Shift: weapons; Space: both dash buttons; "
    + 'both Shift keys: both weapons; 5: coin; Enter: start. Gamepad: both sticks, LT/RT weapons, LB/RB dash, Back/Start.';
}
