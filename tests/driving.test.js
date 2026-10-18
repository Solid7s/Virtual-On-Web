import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DriverState, drivingFields, drivingProfile } from '../web/model2/driving.js';
import { mameArguments } from '../web/model2/session.js';
const { games } = JSON.parse(readFileSync(new URL('../web/model2/catalog.json', import.meta.url)));
const value = (fields, port, mask = 255) => fields.find(field => field[0] === port && field[1] === mask)?.[2];

test('racing clones inherit their real hardware profile; fighting controls remain native', () => {
  for (const id of ['daytona', 'daytonam', 'srallyc', 'srallycb', 'stcc', 'indy500', 'motoraid']) {
    assert.ok(drivingProfile(games.find(game => game.id === id).inputs), id);
  }
  assert.equal(drivingProfile('vf2'), null);
  assert.ok(mameArguments('vf2').includes('-joystick'));
  assert.ok(mameArguments('srallyc', 'enhanced', true).includes('-nojoystick'));
});
test('Daytona gear selection is latched, clamped and isolated from Start and view switches', () => {
  const profile = drivingProfile('daytona'), state = new DriverState(profile);
  state.key('Digit3', true); state.key('Digit3', false);
  let fields = drivingFields(profile, state.read());
  assert.equal(value(fields, 'GEARS', 8), 1);
  assert.equal(value(fields, 'IN0', 16), 0);
  state.key('KeyW', true); state.key('KeyW', true);
  assert.equal(state.gear, 4);
  state.key('KeyQ', true); state.key('KeyQ', true);
  assert.equal(state.gear, 3);
  state.key('Enter', true); state.key('KeyA', true);
  fields = drivingFields(profile, state.read());
  assert.equal(value(fields, 'IN0', 16), 1);
  assert.equal(value(fields, 'IN0', 32), 1);
  state.clear();
  assert.equal(state.gear, 3);
  assert.equal(state.read().buttons, 0);
});
test('arrows operate pedals, with correct hardware endpoints and reversed pedals', () => {
  for (const [layout, idle, full] of [['daytona', 32, 224], ['srallyc', 0, 255], ['sgt24h', 255, 0], ['overrev', 255, 0]]) {
    const profile = drivingProfile(layout), state = new DriverState(profile);
    assert.equal(value(drivingFields(profile, state.read()), 'ACCEL'), idle);
    state.key('ArrowUp', true); state.key('ArrowDown', true);
    const fields = drivingFields(profile, state.read());
    assert.equal(value(fields, 'ACCEL'), full);
    assert.equal(value(fields, 'BRAKE'), full);
    if (profile.shiftUp) assert.equal(value(fields, ...profile.shiftUp), 0, 'accelerator must not also shift');
  }
});
test('standard gamepad provides proportional steering/pedals and edge-triggered shoulder shifting', () => {
  const state = new DriverState(drivingProfile('srallyc'));
  const pad = { axes: [0.5], buttons: Array.from({ length: 10 }, () => ({ pressed: false, value: 0 })) };
  pad.buttons[7].value = 0.75; pad.buttons[6].value = 0.25; pad.buttons[5].pressed = true;
  assert.equal(state.read(pad).gear, 2);
  const input = state.read(pad);
  assert.equal(input.gear, 2); assert.equal(input.steer, 0.5);
  assert.equal(input.gas, 0.75); assert.equal(input.brake, 0.25);
});
test('single-view cameras accept all view buttons; Start/View is shared on Manx TT', () => {
  for (const code of ['KeyA', 'KeyS', 'KeyD', 'KeyF']) {
    const profile = drivingProfile('srallyc'), state = new DriverState(profile);
    state.key(code, true);
    assert.equal(value(drivingFields(profile, state.read()), 'IN0', 32), 1);
  }
  const profile = drivingProfile('manxtt'), state = new DriverState(profile);
  state.key('Enter', true);
  assert.equal(value(drivingFields(profile, state.read()), 'IN0', 64), 1);
});
test('touch controls combine steering, pedals, camera and gears without sticking on clear', () => {
  const profile = drivingProfile('srallyc'), state = new DriverState(profile);
  state.shift(1);
  const fields = drivingFields(profile, state.read(null, { steer: -100, accel: 100, buttons: 128 }));
  assert.equal(value(fields, 'STEER'), 0);
  assert.equal(value(fields, 'ACCEL'), 255);
  assert.equal(value(fields, 'GEARS', 4), 1);
  assert.equal(value(fields, 'IN0', 32), 1);
  state.clear();
  assert.equal(state.read().gas, 0);
});
