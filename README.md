# Virtual-On-Web

**A WebAssembly / WebGPU recompilation port of Cyber Troopers Virtual-On.**

[Play in your browser](https://solid7s.github.io/Virtual-On-Web/) ·
[Releases](https://github.com/Solid7s/Virtual-On-Web/releases)

Virtual-On-Web translates the arcade game's i960, SHARC, and 68000 CPU programs
ahead of time into compiled WebAssembly. An independent Model 2 runtime handles
the hardware, graphics, sound, and input, with WebGPU displaying the game.

This is a **recompilation (recomp) port**, not a decompilation project. It does
not recover SEGA's original source code. The shipped standalone player does not
link the MAME emulator framework or a CPU interpreter, but its hardware and
instruction semantics incorporate credited MAME and Daytona recompilation code.

## Play

1. Open the [website](https://solid7s.github.io/Virtual-On-Web/) in a browser with
   WebGPU support. Desktop Chrome is the browser used for validation.
2. Select your own supported ROM ZIP: **USA Revision B (`vonu.zip`)** or
   **Japan Revision B (`vonj.zip`)**. Required parent/shared files must be present
   in the selected archives. ROM contents are checked before starting.
3. Choose **Classic**, **Enhanced**, or **Enhanced+**, then **Launch Virtual-On**.
4. Click the game to focus controls and enable audio. Press **5**, then **Enter**.

ROM files are read locally in the browser; the application does not upload them.
No ROM archives or extracted graphics/audio ROM files are provided. The included
WebAssembly binary **does contain translated instructions derived from the game
programs**; the ROM requirement does not change that. See [NOTICE.md](NOTICE.md).

## Controls

| Action | Keyboard | Standard gamepad |
| --- | --- | --- |
| Left stick | W / A / S / D | Left stick |
| Right stick, up / left / down / right | P / L / ; / ' | Right stick |
| Left / right weapon | Left / right Shift | LT / RT (L2 / R2) |
| Both weapons | Both Shift keys | Both triggers |
| Dash | Space (both dash buttons) | LB / RB (L1 / R1) |
| Coin | 5 | Back / Select |
| Start | Enter | Start / Options |
| Pause / resume | Tab | Tab on the keyboard |

The front page has an interactive twin-stick diagram and Keyboard / Gamepad
views. The in-screen **X** saves arcade settings and quits; **□** toggles
fullscreen. **Shift+Tab** moves keyboard focus from the game to these buttons.
Settings are saved locally per region; this is not a gameplay save-state feature.

## Graphics

- **Classic:** original arcade resolution and 4:3 presentation.
- **Enhanced:** higher-resolution rendering with a 4:3 view.
- **Enhanced+:** higher-resolution rendering with a wider view on wide displays.

## Status

The first public release is experimental. Both supported regions have passed
boot, character selection, combat, and first-match timeout-win progression into
the next fight in local validation. Browser checks also cover input, sound,
display modes, settings persistence, fullscreen, and quitting/relaunching.

Every character, stage, ending, and knockout path has **not** been verified.
There is no guarantee of complete compatibility or full speed on every machine.
An undiscovered compiled instruction path can still stop the game. Networked
cabinet play and gameplay save states are not implemented.

## Run locally

Node.js 20 or newer is sufficient to serve the included player:

```sh
git clone https://github.com/Solid7s/Virtual-On-Web.git
cd Virtual-On-Web
npm run serve
```

Open `http://localhost:8084/`. No npm packages are required just to serve or run
the unit tests. `npm test` runs the unit tests; `npm run build:site` creates the
allowlisted GitHub Pages site in `_site/`.

For browser development checks, run `npm ci`, install Google Chrome, and use
`TEST_ROM_DIR=/path/to/your/roms npm run test:player -- vonu enhanced-plus` with
the local server running. The browser test uses your own USA and Japan archives.
See [BUILDING.md](BUILDING.md) for offline engine rebuilding.

## Credits and rights

Original game © SEGA. Characters © SEGA/AUTOMUSS.
Character design: KATOKI HAJIME.

This is an unofficial community project with no SEGA affiliation or endorsement.
Software licenses do not grant rights to SEGA's game programs, artwork, logos,
or other assets. Read [NOTICE.md](NOTICE.md), [THIRD_PARTY.md](THIRD_PARTY.md),
and the [runtime attribution](runtime/virtual_on/THIRD_PARTY.md).
