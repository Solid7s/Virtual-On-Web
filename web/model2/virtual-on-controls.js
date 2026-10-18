// Original SVG artwork for the guide. These labels describe the existing
// TwinStickState bindings; the diagram never sends input to the game.
const bindings = {
  keyboard: {
    left: { move: ['W', 'A', 'S', 'D'], weapon: ['Left Shift'], dash: ['Space'] },
    right: { move: ['P', 'L', ';', "'"], weapon: ['Right Shift'], dash: ['Space'] },
    coin: ['5'], start: ['Enter'], both: ['Left Shift', 'Right Shift'],
  },
  gamepad: {
    left: { move: ['Left stick'], weapon: ['LT / L2'], dash: ['LB / L1'] },
    right: { move: ['Right stick'], weapon: ['RT / R2'], dash: ['RB / R1'] },
    coin: ['Back / Select'], start: ['Start / Options'], both: ['LT + RT'],
  },
};

function stickArtwork(side) {
  // Each illustration uses a separate gradient ID so both sticks can coexist.
  return `<svg class="stick-art" viewBox="0 0 440 310" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="${side}-grip" x1="0" x2="1">
        <stop stop-color="#111d25"/><stop offset=".4" stop-color="#40525d"/><stop offset=".67" stop-color="#263640"/><stop offset="1" stop-color="#101a22"/>
      </linearGradient>
      <linearGradient id="${side}-metal" x1="0" x2="1">
        <stop stop-color="#71848e"/><stop offset=".35" stop-color="#f3f8fa"/><stop offset=".55" stop-color="#a4b4bc"/><stop offset="1" stop-color="#425660"/>
      </linearGradient>
      <radialGradient id="${side}-shadow">
        <stop stop-color="#263640" stop-opacity=".18"/><stop offset="1" stop-color="#263640" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <ellipse cx="134" cy="272" rx="105" ry="28" fill="url(#${side}-shadow)"/>
    <g class="stick-part stick-part--move">
      <ellipse class="stick-halo" cx="134" cy="250" rx="101" ry="38"/>
      <path d="M53 244 Q53 226 134 226 Q215 226 215 244 L215 254 Q215 275 134 275 Q53 275 53 254Z" fill="#1c2b34"/>
      <ellipse cx="134" cy="244" rx="81" ry="24" fill="#42535d" stroke="#657781"/>
      <ellipse cx="134" cy="243" rx="59" ry="17" fill="#18272f" stroke="#73858d"/>
      <ellipse cx="134" cy="241" rx="42" ry="12" fill="#101c24" stroke="#455963"/>
      <ellipse cx="134" cy="239" rx="27" ry="8" fill="#364952"/>
      <path d="M124 203 H144 V237 Q134 244 124 237Z" fill="url(#${side}-metal)"/>
      <path class="stick-direction" d="m32 239 -7 5 7 5 m204 -10 7 5 -7 5 M128 285 l6 5 6 -5"/>
    </g>
    <path d="M108 80 Q108 64 124 61 L156 65 Q176 68 176 87 L170 130 L156 151 L153 195 Q152 212 137 214 L121 211 Q108 207 108 192 L112 141 L103 110Z"
      fill="url(#${side}-grip)" stroke="#14232c" stroke-width="2"/>
    <path d="M116 89 L116 125 Q121 134 120 147 L117 189 Q117 199 124 201" fill="none" stroke="#7b909a" stroke-opacity=".65" stroke-width="3" stroke-linecap="round"/>
    <path d="m134 149 19 2 m-21 10 19 2 m-21 10 19 2 m-20 10 18 2" fill="none" stroke="#0e1a22" stroke-width="4" stroke-linecap="round"/>
    <g class="stick-part stick-part--dash">
      <ellipse class="stick-halo" cx="135" cy="69" rx="38" ry="22"/>
      <path d="M110 72 L110 62 Q110 52 131 51 Q154 51 159 62 L159 72 Q137 86 110 72Z" fill="#182a32"/>
      <ellipse class="stick-accent" cx="134" cy="62" rx="24" ry="10"/>
      <path d="M118 60 Q131 54 146 59" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="2" stroke-linecap="round"/>
    </g>
    <g class="stick-part stick-part--weapon">
      <path class="stick-halo" d="M173 86 Q201 92 191 121 L172 141 L157 122Z"/>
      <path d="M171 91 Q188 94 184 109 L172 128 Q168 133 160 128 L158 120 L169 103Z" fill="#12232b" stroke="#677b85"/>
      <path class="stick-accent" d="M174 95 Q183 97 179 107 L168 124 L163 121 L174 104Z"/>
    </g>
    <g class="stick-connector stick-connector--dash"><path d="M165 62 H250"/><circle cx="165" cy="62" r="3"/></g>
    <g class="stick-connector stick-connector--weapon"><path d="M188 107 H212 L234 153 H250"/><circle cx="188" cy="107" r="3"/></g>
    <g class="stick-connector stick-connector--move"><path d="M219 244 H250"/><circle cx="219" cy="244" r="3"/></g>
  </svg>`;
}

function stickUnit(side) {
  const name = side === 'left' ? 'Left' : 'Right';
  return `<div class="stick-unit" data-side="${side}">
    <h3><span class="stick-dot" aria-hidden="true"></span>${name} stick</h3>
    <div class="stick-diagram">
      ${stickArtwork(side)}
      ${[['dash', 'Dash'], ['weapon', 'Weapon'], ['move', 'Move']].map(([part, label]) => `
        <button class="stick-callout stick-callout--${part}" type="button" data-part="${part}" aria-pressed="false">
          <span class="stick-action">${label}</span>
          <span class="stick-binding" data-binding="${side}.${part}"></span>
        </button>`).join('')}
    </div>
  </div>`;
}

export function renderVirtualOnControls(root) {
  // ROM detection calls renderGuide again. Preserve the selected view and
  // focused controls rather than replacing an already mounted diagram.
  if (root.dataset.twinSticks) return;
  root.dataset.twinSticks = 'true';
  root.className = 'twin-stick-guide';
  root.innerHTML = `
    <div class="stick-guide-header">
      <h2>Twin sticks</h2>
      <div class="stick-input-switch" role="radiogroup" aria-label="Show control bindings for">
        <button type="button" role="radio" data-input="keyboard" aria-checked="true" tabindex="0">Keyboard</button>
        <button type="button" role="radio" data-input="gamepad" aria-checked="false" tabindex="-1">Gamepad</button>
      </div>
    </div>
    <div class="stick-deck">${stickUnit('left')}${stickUnit('right')}</div>
    <dl class="stick-shortcuts">
      <div><dt>Both weapons</dt><dd data-binding="both"></dd></div>
      <div><dt>Coin</dt><dd data-binding="coin"></dd></div>
      <div><dt>Start</dt><dd data-binding="start"></dd></div>
      <div><dt>Pause</dt><dd><kbd>Tab</kbd><span class="pause-keyboard" hidden>keyboard</span></dd></div>
    </dl>`;

  const switches = [...root.querySelectorAll('[data-input]')];
  function selectInput(input) {
    const mapping = bindings[input];
    root.dataset.input = input;
    for (const button of switches) {
      const selected = button.dataset.input === input;
      button.setAttribute('aria-checked', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const node of root.querySelectorAll('[data-binding]')) {
      const path = node.dataset.binding.split('.');
      const values = path.reduce((value, key) => value[key], mapping);
      node.replaceChildren(...values.flatMap((value, index) => {
        const key = document.createElement(input === 'keyboard' ? 'kbd' : 'span');
        key.textContent = value;
        return path[0] === 'both' && index ? [document.createTextNode(' + '), key] : [key];
      }));
      node.classList.toggle('stick-key-grid', input === 'keyboard' && path[1] === 'move');
    }
    root.querySelector('.pause-keyboard').hidden = input !== 'gamepad';
    for (const unit of root.querySelectorAll('.stick-unit')) {
      for (const button of unit.querySelectorAll('[data-part]')) {
        const labels = mapping[unit.dataset.side][button.dataset.part].join(', ');
        button.setAttribute('aria-label', `Highlight ${unit.dataset.side} ${button.dataset.part}: ${labels}`);
      }
    }
  }
  for (const button of switches) {
    button.addEventListener('click', () => selectInput(button.dataset.input));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? switches[0] : event.key === 'End' ? switches[1]
        : switches.find(item => item !== button);
      selectInput(next.dataset.input);
      next.focus();
    });
  }
  for (const unit of root.querySelectorAll('.stick-unit')) {
    let selected = '', hovered = '', focused = '';
    const buttons = [...unit.querySelectorAll('[data-part]')];
    const highlight = () => {
      unit.dataset.highlight = hovered || focused || selected;
      for (const button of buttons) {
        button.classList.toggle('is-highlighted', button.dataset.part === unit.dataset.highlight);
        button.setAttribute('aria-pressed', String(button.dataset.part === selected));
      }
    };
    for (const button of buttons) {
      const part = button.dataset.part;
      button.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') { hovered = part; highlight(); } });
      button.addEventListener('pointerleave', () => { hovered = ''; highlight(); });
      button.addEventListener('focus', () => { focused = part; highlight(); });
      button.addEventListener('blur', () => { focused = ''; highlight(); });
      button.addEventListener('click', () => { selected = selected === part ? '' : part; highlight(); });
    }
  }
  selectInput('keyboard');
}
