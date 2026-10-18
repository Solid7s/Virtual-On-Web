import test from 'node:test';
import assert from 'node:assert/strict';
import { displayGeometry } from '../web/model2/display.js';
import { gunPosition, shootingProfile } from '../web/model2/shooting.js';

test('Enhanced+ adds horizontal field of view without changing vertical scale', () => {
  const bounds = { left: 0, top: 0, width: 1280, height: 720 };
  const classic = displayGeometry(bounds, 'classic');
  const enhanced = displayGeometry(bounds, 'enhanced');
  const wide = displayGeometry(bounds, 'enhanced-plus');
  assert.deepEqual([classic.width, classic.height, classic.margin], [496, 384, 0]);
  assert.deepEqual([enhanced.width, enhanced.height, enhanced.margin], [960, 720, 0]);
  assert.deepEqual([wide.width, wide.height], [1280, 720]);
  assert.ok(Math.abs(wide.width / wide.viewWidth - enhanced.width / enhanced.viewWidth) < 1e-10);
  assert.equal(wide.cssHeight, enhanced.cssHeight);
  assert.ok(wide.margin > 0);
  // A gun target in the original playfield stays at the same pixel under
  // the wider camera. Side scenery does not stretch its calibration.
  const gun = shootingProfile('vcop2');
  assert.deepEqual(gunPosition(400, 360, bounds, gun), { x: 260, y: 231 });
});

test('portrait, high-DPI and ultrawide layouts preserve the whole arcade image', () => {
  const portrait = displayGeometry({ width: 390, height: 700 }, 'enhanced-plus', 3);
  assert.equal(portrait.margin, 0);
  assert.equal(portrait.cssWidth, 390);
  assert.equal(portrait.cssHeight, 292.5);
  const wide = displayGeometry({ width: 3440, height: 1440 }, 'enhanced-plus', 2);
  assert.equal(wide.width, 6880);
  assert.equal(wide.height, 2880);
  const limited = displayGeometry({ width: 3440, height: 1440 }, 'enhanced-plus', 2, 2048);
  assert.equal(limited.width, 2048);
  assert.ok(wide.viewWidth > 496);
  const huge = displayGeometry({ width: 20000, height: 500 }, 'enhanced-plus');
  assert.equal(huge.aspect, 32 / 9);
  assert.ok(huge.margin <= 1024);
});
