# CPU and GPU optimization checks — 2026-10-24

The selected release uses the combined CPU optimizations and GPU tile compositor.
At the user's request, the source and precompiled player were restored from
`Virtual-On-Web-backup-20261024-100716-pre-block-aot`, the snapshot taken
immediately after GPU offloading and before the later optimization experiments,
including numbered improvements 1–5. It restores the original audio playback
and continuous diagnostic checksums. The subsequent work remains recoverable
in commit
[`94ee0c9`](https://github.com/Solid7s/Virtual-On-Web/commit/94ee0c9bd6df3223dcffa476b9ff1347fd24e31d).

Restored engine SHA-256:

- Wasm: `ab95a25f700a001c28243d9bb8a9cd197c5e65dd118a38551ead951e40f55ae9`
- CJS: `47b1418b7b16d1093f5e5c5614ddcfa75c048813ca10b4fed8d95f972950eb53`

The results below describe the earlier retained optimizations.

## Backup

The entire original checkout, including Git history and the pre-existing docs,
was copied to `../Virtual-On-Web-backup-20261024-084926`. All 336 original files
were verified with SHA-256; `BACKUP_MANIFEST.json` records their hashes and the
original commit `6b484d53754e4270b8c1b58edf3cfe62e01ee2b9`.

## Changes retained

- WebGPU now decodes System 24 character/tile RAM and composes the background
  and foreground at 496×384. Existing passes scale these layers for Enhanced
  and Enhanced+. Game logic and audio stay on the CPU.
- Frame ABI 5 carries tile, character and palette snapshots captured at vblank.
  Generation tracking avoids uploading unchanged data. The CPU reference
  compositor remains available through `_von_gpu_tiles(0)` for diagnostics.
- The board uses a page lookup for mapped memory. Aliases share write counters,
  allowing unchanged textures/palettes/characters to skip repeated work.
- Sound synchronization skips event processing before the next deadline.
  Timer and MIDI scheduling update that deadline; emulated timing is preserved.
- Color lookup conversion is reused when unchanged, including correct
  invalidation of the character-selection water correction.

Two build issues were also corrected: the missing `scripts/model2_scene.h`
input was restored, and checked-in observed instruction addresses are now
included even where static discovery stops. The rebuilt player retains the
original 170,715 USA / 172,203 Japan address coverage and 30,188 compiled opcodes.

## Measurements

Chrome 156.0.8078.48, headless, AMD RDNA 1 adapter, viewport 1920×1080, DPR 1,
Classic mode. Each sample measured 20 seconds of the opening fight after
warm-up, using CDP 2× CPU throttling. No profiler was attached. Each case used
a fresh browser context and the same real input sequence. The second round
reversed case order. The backed-up engine used the same frontend harness.

| Strategy | Round 1 game speed | Round 2 game speed |
| --- | ---: | ---: |
| Backed-up engine | 67.9% | 76.0% |
| CPU changes, original CPU tile compositor | 67.8% | 63.9% |
| CPU changes + GPU tile compositor | 90.8% | 92.6% |

The combined version averaged 91.7%, versus 71.9% for the backup, approximately
27.5% faster in this comparison. CPU changes alone did not show a clear
end-to-end improvement. In these fight samples the layer input transfer fell
from 761,856 bytes per emulated frame to 65,536 bytes, about 91% less.

A separate, later comparison isolated GPU offloading from the extra CPU changes:

| Strategy | Round 1 game speed | Round 2 game speed |
| --- | ---: | ---: |
| GPU offloading alone | 71.3% | 64.4% |
| CPU changes + GPU offloading | 78.5% | 71.7% |

The combination was about 10–11% faster within those paired rounds. Absolute
speed varied substantially between test blocks; 91–93% is not a promised
minimum. CDP throttling applies main-thread CPU pressure and does not simulate
a named processor, slower GPU, memory bandwidth, or another device's thermals.
These are emulated game-speed measurements, not GPU presentation-FPS captures.

At normal CPU speed, Enhanced+ at 3840×2160 measured 99.96% for both the backup
and selected optimized build during the sampled opening fight.

## Correctness checks

- CPU, board, memory, SHARC and audio state hashes matched the backup at 30
  checkpoints through frame 7,602 in both USA and Japan, including the first
  timeout win and next fight. The GPU-only experiment also matched.
- Attract, character selection and combat screenshots, both tile buffers and
  state/audio hashes matched between all compared variants. The 4K comparison
  also matched exactly.
- 24 ROM-free graphics fixtures matched the independent CPU compositor across
  9,142,272 pixels: normal/split modes, line scrolling, masks, transparent pixels,
  disabled layers, and split boundaries.
- Both regions passed the Enhanced+ browser progression tests, controls,
  graphics-mode changes, cache invalidation, fullscreen, saved settings and
  quitting/relaunching, without unsafe WebGPU flags.
- All 43 unit tests passed. Site packaging verified artifact hashes and included
  the new shader among 33 explicitly allowlisted publication files.

This does not validate every character, late stage, boss or ending, or establish
performance on integrated GPUs and other physical computers.

## Daytona comparison

The checked Daytona-USA-Web source revision was
`1c05247ab0ae08821629ca1f751dbc38851200ba`:

- Its [renderer](https://github.com/johannruiz/Daytona-USA-Web/blob/1c05247ab0ae08821629ca1f751dbc38851200ba/renderer.js)
  draws 3D polygons on WebGPU, then combines CPU-produced background/foreground
  images. It uploads both completed tile images each frame and caches texture
  RAM using a generation counter.
- Its [bridge](https://github.com/johannruiz/Daytona-USA-Web/blob/1c05247ab0ae08821629ca1f751dbc38851200ba/bridge/daytona_gpu.cpp)
  projects, sorts and prepares polygon vertices on the CPU.
- Its [polygon shader](https://github.com/johannruiz/Daytona-USA-Web/blob/1c05247ab0ae08821629ca1f751dbc38851200ba/model2.wgsl)
  samples Model 2 textures, applies filtering, transparency and luma/color lookup
  on the GPU. Virtual-On already used this general 3D rendering approach; the
  new tile compute pass moves an additional graphics workload to WebGPU.

The game CPU instructions are already compiled ahead of time into Wasm.
Longer compiled instruction blocks may reduce remaining per-instruction dispatch
overhead, but that is future work and requires interrupt/device-timing checks.
Browsers still compile Wasm into native machine code locally.

## Local evidence and next steps

Reports are in ignored build directories:

- `build/performance-comparison/report.json` — backup, CPU-only and combined.
- `build/gpu-isolation/report.json` — GPU-only versus combined.
- `build/performance-4k/report.json` — normal-speed 4K comparison.
- `build/cpu-gpu-runtime-comparison.json` and `build/gpu-only-runtime-comparison.json`.
- `build/tile-fixtures/report.json` and regional `play-*-progression/report.json`.

The selected engine is copied into `build/v3-standalone/player-wasm/`; its CJS
and Wasm exactly match the tested `player-wasm-cpu-gpu` artifacts. Alternative
engines and CPU experiment source snapshots remain in ignored `build/`.
See `BUILDING.md` for the reusable checks. Next useful validation is real
low-end/integrated-GPU hardware and sustained later-stage gameplay, followed by
deployment when requested.
