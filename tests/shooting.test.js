import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shootingProfile, gunPosition, ShootingState } from '../web/model2/shooting.js';

test('gun profiles follow hardware layouts, including clones, without capturing racing/fighting games', () => {
  const { games } = JSON.parse(readFileSync(new URL('../web/model2/catalog.json', import.meta.url)));
  for (const id of ['vcop', 'vcopa', 'vcop2', 'hotd', 'hotdo', 'hotdp']) {
    assert.equal(shootingProfile(games.find(g => g.id === id).inputs).reload, true);
  }
  for (const id of ['daytona', 'srallyc', 'vf2', 'doa', 'dynamcop']) {
    assert.equal(shootingProfile(games.find(g => g.id === id).inputs), null);
  }
  assert.equal(shootingProfile('bel').secondary, 0x10);
  assert.equal(shootingProfile('gunblade').reload, undefined);
});

test('aim uses the displayed 4:3 image, not the letterbox or framebuffer resolution', () => {
  const gun = shootingProfile('vcop2');
  const wide = { left: 100, top: 50, width: 1000, height: 600 }; // image x=200..1000
  assert.deepEqual(gunPosition(200, 50, wide, gun), { x: 137, y: 36 });
  assert.deepEqual(gunPosition(600, 350, wide, gun), { x: 384, y: 231 });
  assert.deepEqual(gunPosition(1000, 650, wide, gun), { x: 630, y: 425 });
  assert.deepEqual(gunPosition(101, 49, wide, gun), { x: 137, y: 36 });
  const tall = { left: 0, top: 0, width: 400, height: 600 }; // image y=150..450
  assert.deepEqual(gunPosition(200, 300, tall, gun), { x: 384, y: 231 });
  assert.deepEqual(gunPosition(0, 150, tall, shootingProfile('rchase2')), { x: 202, y: 203 });
});

test('right-click reload releases a held trigger, fires off-screen, then restores normal aim', () => {
  const state = new ShootingState(shootingProfile('vcop2'));
  state.button(0, true, 10);
  assert.equal(state.read(10).trigger, true);
  state.button(2, true, 10);
  state.button(2, false, 10); // a click shorter than one emulator frame
  assert.deepEqual(state.read(10), { offscreen: true, trigger: false, secondary: false });
  assert.deepEqual(state.read(10.05), { offscreen: true, trigger: true, secondary: false });
  assert.equal(state.read(10.10).trigger, true);
  assert.deepEqual(state.read(10.14), { offscreen: true, trigger: false, secondary: false });
  assert.deepEqual(state.read(10.19), { offscreen: false, trigger: true, secondary: false });
  state.button(0, false, 10.2);
  assert.equal(state.read(10.2).trigger, false);
  state.button(2, true, 11);
  state.clear();
  assert.deepEqual(state.read(20), { offscreen: false, trigger: false, secondary: false });
});

test('short fire clicks survive polling and mounted guns keep their actual secondary action', () => {
  const gun = new ShootingState(shootingProfile('vcop'));
  gun.button(0, true, 0); gun.button(0, false, 0);
  assert.equal(gun.read(0.04).trigger, true);
  assert.equal(gun.read(0.10).trigger, false);
  const mounted = new ShootingState(shootingProfile('bel'));
  mounted.button(2, true, 0);
  assert.deepEqual(mounted.read(0), { offscreen: false, trigger: false, secondary: true });
});
