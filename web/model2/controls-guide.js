import { drivingProfile } from './driving.js';
import { shootingProfile } from './shooting.js';
import { twinStickProfile } from './twin-stick.js';

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}
function column(title, rows) {
  const section = element('div');
  const heading = element('h2', title);
  const list = element('dl');
  for (const [action, binding] of rows) {
    const row = element('div'), value = element('dd');
    if (Array.isArray(binding)) {
      binding.forEach((key, index) => { if (index) value.append(' '); value.append(element('kbd', key)); });
    } else value.textContent = binding;
    row.append(element('dt', action), value); list.append(row);
  }
  section.append(heading, list);
  return section;
}

// The original Daytona guide's columns and keycaps, populated from the actual
// control profile so other games never inherit instructions they cannot use.
export function renderControlsGuide(game, { standalone = false } = {}) {
  const $ = id => document.getElementById(id);
  $('controls').replaceChildren();
  $('touchGuide').hidden = true;
  $('serviceNote').hidden = true;
  const driving = drivingProfile(game?.inputs), shooting = shootingProfile(game?.inputs);
  const twinStick = twinStickProfile(game?.inputs);
  const columns = [];
  if (driving) {
    const keyboard = [
      ['Steer / accelerate / brake', ['←', '→', '↑', '↓']],
      [driving.cameraLabel ? 'Insert coin / start & view' : 'Insert coin / start', ['5', 'Enter']],
    ];
    const gamepad = [['Steer', 'Left stick'], ['Accelerate / brake', 'RT / LT']];
    if (driving.gearbox !== 'none') {
      keyboard.push([driving.gearbox === 'hpattern' ? 'Gears / shift down & up'
        : driving.gearbox === 'toggle' ? 'Toggle low / high gear' : 'Shift down / up',
      driving.gearbox === 'hpattern' ? ['1–4', 'Q', 'W'] : ['Q', 'W']]);
      gamepad.push([driving.gearbox === 'toggle' ? 'Toggle low / high gear' : 'Shift down / up', 'LB / RB']);
    }
    keyboard.push([driving.cameraLabel ? 'Punch / kick' : 'Camera views', driving.cameraLabel ? ['A', 'S'] : ['A', 'S', 'D', 'F']]);
    if (driving.handbrake) keyboard.push(['Handbrake', ['Space']]);
    if (driving.weapons) keyboard.push(['Machine gun / cannon', ['J', 'K']]);
    gamepad.push([driving.cameraLabel ? 'Coin / start / actions' : 'Coin / start / camera', 'Back / Start / A B X Y']);
    columns.push(column('Keyboard', keyboard), column('Gamepad', gamepad));
    $('touchGuide').hidden = false;
    $('touchGuide').textContent = 'On phone: drag the left pad to steer; hold GAS or BRAKE with your right thumb. '
      + (driving.gearbox === 'none' ? '' : driving.gearbox === 'toggle' ? 'Tap + or − to toggle low/high gear. ' : 'Tap + / − to shift. ')
      + (driving.cameraLabel ? 'ACTION cycles punch/kick; START also changes view. ' : 'VIEW changes the camera. ')
      + 'COIN adds credit; START begins play. Ⅱ pauses; ⋯ reveals F2 and arcade settings controls. Use Touch controls below the game to show or hide the buttons. Landscape works best.';
    $('serviceNote').hidden = false;
    $('serviceText').replaceChildren('Opens the original arcade settings. Follow the game’s prompts to navigate and choose EXIT to return. ',
      element('kbd', 'F3'), ' is the service button.');
  } else if (twinStick) {
    columns.push(column('Keyboard', [
      ['Left stick', ['W', 'A', 'S', 'D']], ['Right stick', ['P', 'L', ';', "'"]],
      ['Left / right weapon', ['Left Shift', 'Right Shift']],
      ['Dash (both sticks)', ['Space']], ['Both weapons', ['Left Shift', 'Right Shift']],
      ['Insert coin / start', ['5', 'Enter']],
    ]), column('Gamepad', [
      ['Left / right arcade sticks', 'Left / right controller sticks'],
      ['Left / right weapon', 'LT / RT (L2 / R2)'],
      ['Left / right dash', 'LB / RB (L1 / R1)'],
      ['Insert coin / start', 'Back / Start (Select / Options)'],
    ]));
    $('serviceNote').hidden = false;
    $('serviceText').replaceChildren('For one cabinet: GAME ASSIGNMENTS → NETWORK LINK ATTRIBUTE → NOLINK. ',
      element('kbd', 'F3'), ' selects an item; ', element('kbd', 'F2'), ' confirms or changes it. Choose EXIT to return.');
  } else if (shooting) {
    columns.push(column('Mouse', [
      ['Aim', 'Move mouse'], ['Fire', 'Left-click'],
      shooting.reload ? ['Reload', 'Right-click'] : shooting.secondary ? ['Missile', 'Right-click'] : ['Reload', 'No manual reload'],
    ]));
    columns.push(column('Keyboard', [
      ['Insert coin / Player 1 start', ['5', '1']], ['Configure controls', ['Tab']], ['Pause / resume', ['P']],
    ]));
  } else {
    const baseball = game?.inputs === 'dynabb';
    columns.push(column('Keyboard', [
      ['Move', ['←', '→', '↑', '↓']], [baseball ? 'Action 1 / action 2 / bat swing' : 'Action buttons 1 / 2 / 3', ['Z', 'X', 'C']],
      ['Insert coin / Player 1 start', ['5', '1']], ['Configure controls', ['Tab']], ['Pause / resume', ['P']],
    ]));
    const help = element('div');
    help.append(element('p', (baseball ? 'Z and X are the action buttons; C swings the bat. ' : 'Z, X and C are the default action buttons. Actions depend on the game. ')
      + 'Open the MAME menu with Tab to view or change bindings; saved custom bindings take priority.'));
    columns.push(help);
  }
  $('controls').replaceChildren(...columns);
  $('guideFooter').replaceChildren(driving ? 'Click the game to focus. ' : shooting ? 'Move the mouse over the game to see your aiming cursor. ' : 'Click the game to focus. ',
    element('kbd', 'Tab'), ' opens the MAME menu; ', element('kbd', 'P'), ' pauses or resumes.');
  if (twinStick) $('guideFooter').replaceChildren('Click the game to enable sound and controls. ',
    element('kbd', 'Tab'), standalone ? ' pauses or resumes. Arcade settings are saved automatically.' : ' opens the MAME menu.');
}
