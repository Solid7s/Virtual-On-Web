# v0.1.0 — Initial WebGPU recompilation release

**Virtual-On-Web is a recompilation (recomp) port, not a decompilation (decomp).**
The i960, SHARC, and 68000 arcade CPU programs are translated ahead of time into
compiled WebAssembly. This does not recover SEGA's original source code. The
standalone player uses an independent Model 2 runtime and WebGPU rendering;
it retains credited MAME/Daytona semantics without linking the full MAME
framework or a runtime CPU interpreter.

Play: https://solid7s.github.io/Virtual-On-Web/

## Included

- USA and Japan Revision B support using the player's own ROM ZIP files.
- Classic, Enhanced, and Enhanced+ graphics modes.
- Interactive twin-stick keyboard/gamepad guide.
- WASD and P/L/;/' movement, left/right Shift weapons, Space dash, and Tab pause.
- In-screen Quit and fullscreen buttons with compact icons and hover highlights.
- Audio and automatic local arcade-settings persistence.
- First-match progression fix and the tested compiled WebAssembly engine.

## Validation and limits

Local development checks cover boot, character selection, combat, controls,
audio, graphics modes, fullscreen, settings saving, and quit/relaunch. Both
regions previously passed first-match timeout-win progression into the second
fight. The JavaScript unit suite contains 40 passing tests.

This is an experimental first release. Not every character, stage, ending, or
knockout path has been validated, and full speed depends on the browser, GPU,
display resolution, and game scene. Networked cabinet play and gameplay save
states are not included.

## ROMs, attribution, and licensing

No ROM archives or extracted graphics/audio ROM files are included. Players
select their own ROMs locally; the website does not upload them. The precompiled
WebAssembly engine does contain ROM-derived translated game instructions.
Requiring a ROM does not grant distribution rights to those instructions.

Original game © SEGA. Characters © SEGA/AUTOMUSS. Character design: KATOKI HAJIME.
This project is unofficial and has no SEGA affiliation or endorsement. Software
licenses do not relicense SEGA's game code or assets. See NOTICE.md and the
included software attribution and license files.
