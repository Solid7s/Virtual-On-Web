// P1 gun layouts from the pinned model2.cpp. Clones inherit the catalog's
// input layout. Values are final hardware readings, including reversed axes.
export const SHOOTING_PROFILES = {
  vcop: { mask: 0x3ff, x: [131, 630], y: [36, 425], reload: true },
  vcop2: { mask: 0x3ff, x: [137, 630], y: [36, 425], reload: true },
  hotd: { mask: 0x3ff, x: [173, 596], y: [87, 380], reload: true },
  rchase2: { mask: 0xff, x: [202, 58], y: [203, 28] },
  rchase2a: { mask: 0xff, x: [0, 255], y: [0, 255] },
  gunblade: { mask: 0xff, x: [105, 255], y: [17, 174] },
  bel: { mask: 0xff, x: [105, 255], y: [17, 174], secondary: 0x10 },
};
export const shootingProfile = layout => SHOOTING_PROFILES[layout] || null;
export function shootingGuide(profile) {
  return 'Mouse: aim; left-click: fire. '
    + (profile.reload ? 'Right-click: reload. ' : profile.secondary ? 'Right-click: missile. ' : 'No manual reload. ')
    + '5: coin; 1: Player 1 start; Tab: MAME menu; P: pause.';
}

// Gun calibration belongs to the centered arcade 4:3 playfield, irrespective
// of canvas pixels or devicePixelRatio. Enhanced+ reveals side scenery without
// moving those targets; outside the arcade playfield retains off-screen aim.
export function gunPosition(clientX, clientY, bounds, profile) {
  const width = Math.min(bounds.width, bounds.height * 4 / 3);
  const height = width * 3 / 4;
  const left = bounds.left + (bounds.width - width) / 2;
  const top = bounds.top + (bounds.height - height) / 2;
  const unit = (v, origin, size) => Math.max(0, Math.min(1, (v - origin) / Math.max(1, size)));
  const axis = ([min, max], value) => Math.round(min + (max - min) * value);
  return { x: axis(profile.x, unit(clientX, left, width)),
    y: axis(profile.y, unit(clientY, top, height)) };
}

export class ShootingState {
  constructor(profile) { this.profile = profile; this.clear(); }
  clear() { this.left = false; this.right = false; this.shotUntil = -1; this.phase = ''; this.until = -1; }
  button(button, down, now) {
    if (button === 0) { this.left = down; if (down) this.shotUntil = now + 0.08; }
    if (button === 2) {
      if (down && !this.right && this.profile.reload) {
        // Release the trigger first, even if left-click was held. Every phase
        // lasts emulated time, so a short browser click survives a slow frame.
        this.phase = 'release'; this.until = now + 0.04;
      }
      this.right = down;
    }
  }
  read(now) {
    if (this.phase && now >= this.until) {
      this.phase = this.phase === 'release' ? 'fire' : this.phase === 'fire' ? 'settle' : '';
      this.until = now + (this.phase === 'fire' ? 0.08 : 0.04);
    }
    return { offscreen: !!this.phase,
      trigger: this.phase ? this.phase === 'fire' : this.left || now < this.shotUntil,
      secondary: !!this.profile.secondary && this.right };
  }
}
