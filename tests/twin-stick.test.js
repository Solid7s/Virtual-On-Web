import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TwinStickState, twinStickProfile } from '../web/model2/twin-stick.js';
import { mameArguments } from '../web/model2/session.js';

const { games } = JSON.parse(readFileSync(new URL('../web/model2/catalog.json', import.meta.url)));
const pad = () => ({ connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 10 }, () => ({ pressed: false, value: 0 })) });
const value = (fields, port, mask) => fields.find(f => f[0] === port && f[1] === mask)?.[2];
const active = fields => fields.filter(f => f[2]).map(f => [f[0], f[1]]);

test('all Virtual-On revisions have twin sticks and custom pads cannot also drive SDL inputs', () => {
  assert.deepEqual(games.filter(g => twinStickProfile(g.inputs)).map(g => g.id).sort(), ['von', 'vonj', 'vonr', 'vonu']);
  assert.ok(mameArguments('vonu', 'enhanced', true).includes('-nojoystick'));
  assert.ok(mameArguments('vf2').includes('-joystick'));
});
test('WASD and PL-semicolon-quote independently drive every digital stick direction and diagonals', () => {
  const state = new TwinStickState();
  for (const [key, port, mask] of [['KeyW', 'IN1', 32], ['KeyA', 'IN1', 128], ['KeyS', 'IN1', 16], ['KeyD', 'IN1', 64],
    ['KeyP', 'IN2', 32], ['KeyL', 'IN2', 128], ['Semicolon', 'IN2', 16], ['Quote', 'IN2', 64]]) {
    assert.equal(state.key(key, true), true);
    assert.deepEqual(active(state.read(null)), [[port, mask]]);
    state.key(key, false);
    assert.deepEqual(active(state.read(null)), []);
  }
  for (const key of ['KeyW', 'KeyA', 'Semicolon', 'Quote']) state.key(key, true);
  assert.equal(active(state.read(null)).length, 4);
  state.clear();
  assert.deepEqual(active(state.read(null)), []);
  assert.equal(state.key('Tab', true), false);
  for (const key of ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'KeyQ', 'KeyE', 'Slash', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'])
    assert.equal(state.key(key, true), false, `${key} must no longer control a stick`);
});
test('both pad sticks have hysteresis, neutralize on disconnect, and opposing keys cancel', () => {
  const state = new TwinStickState(), controller = pad();
  controller.axes = [-1, -1, 1, 1];
  assert.deepEqual(active(state.read(controller)), [['IN1', 128], ['IN1', 32], ['IN2', 64], ['IN2', 16]]);
  controller.axes = [-0.28, -0.28, 0.28, 0.28];
  assert.equal(active(state.read(controller)).length, 4);
  controller.axes.fill(0.1);
  assert.deepEqual(active(state.read(controller)), []);
  controller.axes.fill(0.28);
  assert.deepEqual(active(state.read(controller)), []);
  controller.axes[0] = 1;
  state.key('KeyA', true); state.key('KeyD', true);
  assert.equal(value(state.read(controller), 'IN1', 64), 0);
  state.clear(); controller.connected = false;
  assert.deepEqual(active(state.read(controller)), []);
  controller.connected = true; controller.mapping = '';
  assert.deepEqual(active(state.read(controller)), []);
});
test('triggers are weapons, shoulders are dash, and keyboard actions combine without sticking', () => {
  const state = new TwinStickState(), controller = pad();
  for (const [index, port, mask] of [[6, 'IN1', 1], [7, 'IN2', 1], [4, 'IN1', 2], [5, 'IN2', 2], [8, 'IN0', 1], [9, 'IN0', 16]]) {
    controller.buttons[index].value = 1;
    assert.deepEqual(active(state.read(controller)), [[port, mask]]);
    controller.buttons[index].value = 0;
  }
  for (const [key, port, mask] of [['ShiftLeft', 'IN1', 1], ['ShiftRight', 'IN2', 1],
    ['Enter', 'IN0', 16], ['Digit1', 'IN0', 16],
    ['Digit5', 'IN0', 1], ['F2', 'IN0', 4], ['F3', 'IN0', 8]]) {
    state.key(key, true); assert.deepEqual(active(state.read(null)), [[port, mask]]); state.key(key, false);
  }
  state.key('Space', true);
  assert.deepEqual(active(state.read(null)), [['IN1', 2], ['IN2', 2]]);
  state.key('ShiftRight', true); state.key('Space', false);
  assert.deepEqual(active(state.read(null)), [['IN2', 1]]);
  state.clear(); assert.deepEqual(active(state.read(null)), []);
});
test('Space dashes with both sticks while Shift weapons and movement stay independent', () => {
  const state = new TwinStickState();
  for (const key of ['KeyW', 'KeyP', 'ShiftLeft', 'ShiftRight', 'Space']) state.key(key, true);
  assert.deepEqual(active(state.read(null)), [['IN1', 32], ['IN1', 1], ['IN1', 2], ['IN2', 32], ['IN2', 1], ['IN2', 2]]);
  state.key('Space', false);
  assert.deepEqual(active(state.read(null)), [['IN1', 32], ['IN1', 1], ['IN2', 32], ['IN2', 1]]);
  state.key('ShiftLeft', false); state.key('KeyW', false);
  assert.deepEqual(active(state.read(null)), [['IN2', 32], ['IN2', 1]]);
  state.key('Semicolon', true);
  assert.deepEqual(active(state.read(null)), [['IN2', 1]], 'Opposite right-stick directions cancel');
  state.clear();
  assert.deepEqual(active(state.read(null)), []);
});
