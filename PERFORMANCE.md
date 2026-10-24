# CPU and GPU optimization checks — 2026-10-24

Selected release default: O3 + LTO with the guarded SHARC polynomial specialization,
and diagnostic audio checksums disabled during normal play.
Buffered AudioWorklet playback is available with `?audio=worklet` and remains
optional. The default browser audio method is unchanged. See the final checksum
section for current results, artifact hashes, and limitations.

The earlier CPU optimizations and GPU tile compositor remain enabled.
The sections below record local experiments before publication. References to
unpublished or local-only work describe its status at the time of those tests.
The website package uses the selected defaults and artifact hashes in the final
checksum section.
The later register-block AOT experiment described below is disabled by default;
it did not establish a consistent additional speedup.

## Compiler sound and GPU preparation experiments

The research notes are saved in [docs/OPTIMIZATION_RESEARCH.md](docs/OPTIMIZATION_RESEARCH.md).
Before implementing priorities 1–3, the complete checkout was copied to
`../Virtual-On-Web-backup-20261024-114254-pre-optimization-123`; 2,429 files were
SHA-256 verified and four symlinks preserved. Experiments use isolated build
directories. O3 plus LTO is now the local playable default. The other new
experiments remain optional, and GitHub has not been updated.

Implemented experiments:

- Compiler O3, O2 plus LTO, and O2 plus Wasm SIMD; strict floating-point settings
  remain enabled. These switches do not enable register-block AOT.
- SCSP DSP decoded-instruction cache, invalidated on every microprogram word
  write and refreshed when playback starts. Coefficients, address tables,
  feedback, and event timing remain live and unchanged.
- GPU frame ABI 6 with unique 56-byte vertices and a 32-bit triangle-index stream.
  Mode 1 moves projection and rendering attributes into the vertex shader.
  Mode 2 keeps screen coordinates and reciprocal depth on the CPU, while GPU
  shaders calculate UV attributes and flat color. Polygon ordering, viewport
  scissoring, widescreen coverage, and the scoped water correction are preserved.

Correctness results:

- O3, LTO, O3 plus LTO, SIMD, and cached DSP each matched 30 baseline CPU/board/memory/SHARC/
  cumulative-audio checkpoints through frame 7,602 in both regions. This includes
  the first win and next fight. Timing during these correctness runs is not a
  performance result: some checks overlapped compiler work.
- The isolated cached DSP matched the pinned interpreter for 15,360 samples over
  160 generated programs, including 3,026 live program writes, program growth,
  changing coefficients/address tables, stopped execution, feedback and RAM.
- Each regional gameplay replay produced 5,810,225 active DSP samples with only
  248 instruction decodes; the final effects program has 110 steps.
- The original renderer passed the UI/browser checks with the extended shader.
  The full GPU projection candidate also passed basic browser and mode-switching
  checks, but is not pixel-exact: at 1920x1080 Enhanced+, attract/selection/combat
  differed in 157/1/170 pixels out of 2,073,600. Maximum channel errors were
  77/4/12; mean absolute channel errors were 0.000340/0.00000161/0.000303.
- GPU mode 2 matched every pixel, state hash, audio hash and tile layer at the
  same three Enhanced+ checkpoints. These are initial scene checks, not yet a
  claim about every game scene or GPU.
- GPU mode 2 also passed the Japan browser progression test through the first
  win and next fight, including mode changes, upload-cache checks and fullscreen.
- All 43 existing unit tests passed.

The previous default Wasm contains a 1,151,259-byte profiling-name section.
Unprofiled O2 is about 8.10 MB and unprofiled O3 is about 8.08 MB; the larger
reduction from the old 9.25 MB artifact is mostly removal of diagnostic names,
not a compiler optimization speedup. The selected O3 plus LTO Wasm is 8,791,941
bytes: about 5% smaller than the old named artifact, but about 8.5% larger than
the unprofiled O2 control. Startup performance was not benchmarked.

### Initial CPU screening at 3x throttling

Eight engines ran identical warm-up inputs in one Chrome thread, then alternated
order over twelve 30-frame chunks (360 measured frames per engine). Complete
state and cumulative audio matched at each checkpoint. This excludes GPU
submission and browser audio scheduling, and is a screening result rather than
end-to-end game speed. Evidence: `build/opt-screen-3.json`.

| Engine | CPU seconds | Throughput relative to rebuilt O2 |
| --- | ---: | ---: |
| Previous playable default | 9.425 | 0.968x |
| Rebuilt O2 control | 9.126 | 1.000x |
| O3 | 8.842 | 1.032x |
| O2 plus LTO | 8.569 | 1.065x |
| O2 plus SIMD | 9.091 | 1.004x |
| O2 plus DSP decode cache | 9.311 | 0.980x |
| O2 plus full GPU projection preparation | 8.952 | 1.019x |
| O2 plus GPU attributes preparation | 9.436 | 0.967x |

LTO was faster than the rebuilt control in nine of twelve chunks, with a median
paired throughput ratio of 1.052x. Cached sound decoding and GPU attribute
preparation did not establish CPU throughput gains. The latter still reduces
vertex uploads; its actual browser playback measurements are recorded below.

### Browser playback comparison and selected build

Chrome 156.0.8078.48, AMD RDNA 1, headless, 1920x1080 Enhanced+, DPR 1. No
profiler was attached. Build jobs and other tests had completed before timing.
Each sample measured 20 seconds of the opening fight after warm-up; two rounds
reversed candidate order. All cases matched exact attract, selection and combat
screenshots, complete state/audio hashes and tile layers before timing. The
measurements include browser audio scheduling and WebGPU submission.

| Build at 3x CPU throttling | Round 1 game speed | Round 2 game speed | Mean |
| --- | ---: | ---: | ---: |
| Previous local default | 60.20% | 58.93% | 59.56% |
| LTO | 60.66% | 58.03% | 59.34% |
| O3 plus LTO | 63.84% | 60.35% | 62.10% |
| LTO plus GPU attributes | 60.77% | 55.23% | 58.00% |

| Build at 2.5x CPU throttling | Round 1 game speed | Round 2 game speed | Mean |
| --- | ---: | ---: | ---: |
| Previous local default | 80.65% | 83.24% | 81.95% |
| O3 plus LTO | 80.98% | 84.95% | 82.96% |

O3 plus LTO improved speed in all four samples: about 4.25% relative improvement
at 3x and 1.24% at 2.5x. This is a modest gain on this machine and workload;
absolute speed varied between test blocks. It is now the local default, with
`npm run build:player` updated to use the selected compiler flags.

The GPU attribute variant transferred roughly 187 KB of vertices plus indices
per emulated frame during these samples, versus about 271 KB for the baseline
(approximately 31% less). That did not translate into a repeatable playback
speed gain here. It remains optional, as do SIMD, DSP caching, register-block
AOT, and full GPU projection. The full projection mode additionally has the
pixel differences documented above. Production builds do not create the
experimental vertex pipeline unless the loaded engine supports that path.

The selected CJS and Wasm files were copied unchanged from the tested candidate,
and the copied hashes were verified:

- CJS: `4a0a29dc0dbb080113157db8aa2b41fba9724c49a0cd6d31d1f85bab8c97b9ed`
- Wasm: `8d72df921d9f75bcba29ad061e2ca0784714561bd18ea57fd4d3b9683e67e78a`

Final USA and Japan browser checks passed against those selected hashes, covering
ROM import, controls, all graphics modes, fullscreen, cache invalidation, quitting
and relaunch. All 43 unit tests passed again. Site packaging verified the same
engine hashes across the 33 allowlisted publication files; no experimental
engines, dependencies, or ROM files were included. No commit, push or deployment
was made, and the test server was stopped.

Evidence: `build/opt-final-3/report.json`, `build/opt-final-2.5/report.json`,
`build/opt-o3-lto-runtime.json`, `build/opt-dsp-runtime.json`,
`build/opt-gpu-pixels/report.json`, and `build/opt-gpu-attributes-pixels/report.json`.
The saved `build/opt-*-specs.json` files now point their baseline at the preserved
backup so they remain usable after the local default changes. Their engine hashes
in each original report identify the artifacts actually measured.

Further work should profile later space/boss fights and additional real GPUs.
For sound, compiling stable DSP microprograms could remove more work than the
decoded-field cache, but has not been implemented or benchmarked. CPU throttling
does not reproduce GPU, memory, or thermal behavior of another computer.

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
The register-only block experiment below tested one way to reduce remaining
per-instruction dispatch overhead. Wider blocks remain future work and require
interrupt/device-timing checks. Browsers still compile Wasm into native machine
code locally.

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

## Register-block AOT experiment — not enabled by default

Before this work, the current checkout was copied to
`../Virtual-On-Web-backup-20261024-100716-pre-block-aot`. All 948 regular files
were verified with SHA-256, including the current CPU + GPU player and Git
history. `BACKUP_MANIFEST.json` records hashes and working-tree status. The four
local dependency/ROM symlinks were preserved as symlinks, not duplicated.

The experiment specializes register operand helpers at compile time and joins
up to eight register-only instructions into one compiled Wasm function. It
generates 4,810 unique blocks, entered at 12,606 USA and 12,591 Japan addresses.
Loads, stores, branches, floating-point operations and interrupt-priority
changes retain the preceding instruction path. Blocks are refused during
pending interrupts/stalled transfers and must finish strictly before the next
board, UART, sound-service or video deadline. Instruction coverage is unchanged.

The first implementation performed an additional lookup before instruction
dispatch and showed a slowdown. The revised implementation stores the optional
block alongside the existing instruction entry and selects it inside the same
dispatch. It also preserves the cost of interrupt entry before the first
handler instruction. Both versions remain as ignored local build artifacts.

### Real-time comparisons

The baseline here is the **immediately preceding CPU + GPU version**, not the
older engine from the first table above. Both engines use GPU tile composition,
Classic mode, Chrome 156.0.8078.48, AMD RDNA 1, viewport 1920×1080 and DPR 1.
Each case has a fresh context, matching attract/selection/combat checkpoints,
three equal-work CPU samples of 120 frames, then three seconds of real-time
warm-up and 20 seconds of measurement. The second round reverses case order.
No profiler, build or other test ran concurrently with these timings.

| CPU throttle | Current round 1 | AOT round 1 | Current round 2 | AOT round 2 | Current mean | AOT mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2.5× | 55.9% | 48.9% | 58.5% | 56.1% | 57.2% | 52.5% |
| 3× | 57.6% | 65.8% | 54.8% | 51.5% | 56.2% | 58.7% |

These percentages measure **emulated game speed**, not presentation FPS. At
2.5×, the candidate averaged about 8.2% slower; at 3× it averaged about 4.4%
faster, with the direction reversing between the two 3× rounds. Specializing
helpers while disabling blocks in the same candidate averaged 51.7% at 3×.
The initial, separate-lookup prototype had also produced inconsistent results:
60.8% current, 58.8% blocks, 69.7% helper specialization alone at 2.5×, before
the equal-work samples were added. Do not combine those protocols into one mean.

The equal-work CPU samples were also unconvincing. Across 720 identical frames
per engine, the revised candidate took 22.34 seconds versus 18.74 for the
baseline at 2.5×, and 21.84 versus 20.68 at 3×. These measurements include
emulated sound and CPU render preparation, but exclude GPU presentation and
browser audio scheduling. They are not substitutes for the real-time results.

To reduce drift, an additional 3× test ran three independent engine instances
inside one browser thread, alternating execution order every 30 frames across
24 adjacent chunks. All instances ran the same 720 combat frames, and their
complete states/audio matched at every checkpoint:

| Path | Total CPU time | Throughput relative to current |
| --- | ---: | ---: |
| Current | 25.935 s | 1.000× |
| Revised blocks + helper specialization | 25.415 s | 1.020× |
| Helper specialization, blocks disabled | 25.679 s | 1.010× |

The block path won 16 of 24 adjacent chunks; its median paired throughput gain
was 2.6%. This small result does not establish an end-to-end performance win.
The candidate also increases Wasm from 9,252,377 to 11,062,791 bytes, about 19.6%.

**Decision:** preserve the current playable artifacts and make the new path
opt-in through `--aot-blocks`. Normal builds omit block tables, helper inlining
and block diagnostic exports. The GPU optimizations from the preceding task
remain enabled. No GitHub commit, push or deployment was performed.

CPU throttling is an approximation, not a simulation of a particular processor
or GPU. Run-to-run drift was substantial; no specific thermal or browser cause
was established. These samples cover early combat, not late stages or bosses.

### Correctness and reproduction

- The native interpreter oracle matched all 302,364 block/register cases across
  every generated entry in both regions. All 2,418,912 deadline, IRQ, burst,
  disabled-mode and invalid-address guards passed. Blocks made no bus accesses.
- The first block implementation matched 30 CPU/board/memory/SHARC/audio
  checkpoints through frame 7,602 in both regions, including first win/next
  fight. Both regional Enhanced+ browser progression checks passed with no
  errors, including controls, graphics modes, fullscreen and quit/relaunch.
- The revised implementation matched state, complete audio hashes, screenshots
  and both tile buffers at all four checkpoints in every real-time comparison.
  The adjacent CPU comparison also matched its four complete-state checkpoints.
- The revised implementation additionally matched all 30 progression replay
  checkpoints through frame 7,602 in USA and Japan, including the first win and
  next fight. It executed 85,158,753 / 84,101,756 instructions through blocks.
- A normal rebuild's CJS and Wasm match the backed-up player byte for byte.
  Rebuilding with `--aot-blocks` matches the measured revised candidate byte for
  byte. The actual shipped player and its manifest were never replaced.
- All 43 unit tests passed; site packaging verified the unchanged player hashes
  and the 33-file allowlist. ROMs and experimental engines remain outside it.

See `BUILDING.md` for build and test commands. Local evidence:

- `build/block-performance-2.5/report.json` — initial separate lookup.
- `build/block-fused-performance-2.5/report.json` and
  `build/block-fused-performance-3/report.json` — revised end-to-end results.
- `build/block-fused-paired-3.json` — adjacent equal-work CPU comparisons.
- `build/block-oracle-results.json`, `build/block-fused-oracle-results.json`.
- `build/block-runtime-comparison.json` and
  `build/block-fused-runtime-comparison.json` — progression state replays.
- `build/v3-standalone/player-wasm-blocks-opt-in/` — reproducible opt-in build.
- `build/v3-standalone/player-wasm-stable-check/` — normal build verification.

Useful next work is profiling the remaining sound/SHARC costs or selecting hot
memory-access blocks that can preserve each bus/event boundary while avoiding
dispatch overhead. Any new attempt should use adjacent equal-work comparisons
as well as game-speed measurements before replacing the stable player.

## Steps 4–5: SHARC polynomial specialization and AudioWorklet

Baseline backup: `../Virtual-On-Web-backup-20261024-161328-pre-optimization-45`,
4,096 regular files verified by SHA-256. Baseline is the selected O3+LTO engine
and its preserved per-frame browser playback code. No GitHub deployment was
performed for these experiments.

SHARC instruction profiles (`build/sharc-profile-45.json`) sampled boot/attract,
selection and early combat in both regions. During frames 2065–4000, the
two-instruction polynomial tail accounted for 16,406,304 / 123,395,888 USA
instructions (13.30%) and 16,391,808 / 123,352,838 Japan instructions (13.29%).
This is instruction frequency, not a CPU-time percentage. The specialization
preserves separate native float multiply/add operations and their hardware
flags. It eliminates repeated dispatch for up to six iterations under strict
no-event/internal-memory guards; it does not send synchronous CPU work to the
GPU.

The 3× throttled adjacent CPU comparison executed 24 alternating chunks of
30 frames per engine. Total time was 17,841.5 ms baseline versus 17,651.0 ms
specialized: 1.0108× throughput (about 1.1% faster). The median paired ratio was
1.0128×; the candidate won 16 of 24 chunks. State and audio hashes matched at
each six-chunk boundary. This excludes browser audio scheduling and GPU
presentation. Evidence: `build/sharc45-cpu-3.json`.

Audio uses one persistent AudioWorklet with a bounded PCM ring and 16 recycled
8 KiB transfer buffers. The normal path allocates no per-frame AudioBuffer or
AudioBufferSourceNode. Small message objects/views still exist; this is not an
allocation-free transport. It buffers about 40 ms before starting/restarting
and bounds backlog to 250 ms, resynchronizing on overflow. Worklet diagnostics
separately count starvation, discarded backlog and transport-pool misses.
Under sustained CPU slowdown, starvation is expected: this moves playback
buffering, not the emulated sound CPU, to another thread.

The worklet runs at native 44.1 kHz. Failed loading, processor errors, missing
AudioWorklet support or a different context sample rate use the original
browser playback path, preserving the browser's resampling. No
SharedArrayBuffer or cross-origin-isolation deployment is required.

Correctness evidence:

- Native polynomial test: 6,000 oracle comparisons across random registers,
  NaNs/infinities/denormals, nested loop stacks and iteration counts; 19 unsafe
  entry checks. Complete architectural state, SRAM and cycle counts matched.
- Full USA/Japan replay: 30 exact CPU/board/RAM/SHARC/audio checkpoints through
  frame 7602 and the second fight. Specialized instruction totals were
  53,848,572 USA and 51,556,500 Japan (`build/sharc-math-runtime45.json`).
- Worklet offline output: every one of 8,192 stereo sample values matched.
  Real browser tests covered buffer recycling, suspension/resumption, repeated
  close, a 48 kHz fallback and failed module loading (`build/audio-45.json`).
- USA UI replay and Japan progression replay passed ROM import, all graphics
  modes, fullscreen, toolbar, quit/relaunch and screenshot/cache checks.

Full-game 3× CPU throttling, 1080p Enhanced+, two 20-second rounds with
reversed case order, no profiler, AMD RDNA1 / Chrome 156.0.8078.48:

| Path | Round 1 speed | Round 2 speed | Mean |
| --- | ---: | ---: | ---: |
| Previous O3+LTO and audio | 60.71% | 53.84% | 57.27% |
| SHARC math only | 61.11% | 53.76% | 57.44% |
| Buffered audio only | 60.82% | 54.84% | 57.83% |
| Both | 59.32% | 53.95% | 56.64% |

The buffered path was slightly faster in both rounds; SHARC was mixed, and
combining them did not establish a gain. The substantial between-round drift
limits claims about small differences. The OS reported no thermal warning or
CPU speed limit during the run, but that does not make the host noiseless.
Every case matched the three reference state/audio, tile and screenshot
checkpoints. All worklet cases used 16 buffers and zero playback-source nodes,
with no buffer-pool misses, transport drops or queue overflow. Underflow
remained under forced slowdown; no audio-quality or stutter improvement is
claimed from these results. Evidence: `build/steps45-e2e-3/report.json`.

The matching 2.5× full-game comparison produced:

| Path | Round 1 speed | Round 2 speed | Mean |
| --- | ---: | ---: | ---: |
| Previous O3+LTO and audio | 70.03% | 72.23% | 71.13% |
| SHARC math only | 76.99% | 85.50% | 81.24% |
| Buffered audio only | 76.10% | 68.70% | 72.40% |
| Both | 75.90% | 76.27% | 76.09% |

SHARC improved both 2.5× rounds; audio alone was mixed. The larger full-game
differences should not be treated as a universal 14% SHARC speedup: the
controlled CPU result was much smaller, and the browser results vary strongly.
All 24 checkpoint records matched exact state/audio, tiles and pixels. Worklet
buffer counts remained bounded with zero transport drops or pool misses.
Evidence: `build/steps45-e2e-2.5/report.json`.

The exact worklet frontend used during these comparisons was retained in
`build/steps45-tested-frontend/`. After measurement, the worklet became opt-in
via `?audio=worklet`; the specs file now supplies that option explicitly.
`build/steps45-specs.json` keeps the baseline engine/frontend in the preserved
checkout so the comparison stays reproducible if a new core is selected.

The adjacent 2.5× CPU comparison confirmed a small improvement: 17,040.6 ms
baseline versus 16,753.7 ms specialized for 720 identical frames (1.0171×,
about 1.7% throughput). Median paired ratio: 1.0274×; 16 of 24 chunks favored
the specialization. State/audio hashes matched. Evidence:
`build/sharc45-cpu-2.5.json`. Across both controlled rates the defensible CPU
improvement is about 1–2%, rather than the larger end-to-end outlier.

**Selected locally:** O3 + LTO + guarded SHARC polynomial specialization.
Buffered AudioWorklet remains opt-in because full-game gains were inconsistent.
The default audio wrapper retains the previous device-rate AudioContext,
per-frame playback and scheduling behavior. `?audio=worklet` requests native
44.1 kHz and the pooled worklet path. The renderer and CPU/sound timing are
unchanged by this selection.

Selected Wasm: 8,793,554 bytes, just 1,613 bytes larger than the preceding
O3+LTO player. The default artifacts were copied and SHA-256 verified from the
isolated `player-wasm-sharc-math` build:

- Wasm: `d1c38e11ca8685757ee6edbad30ace099681101fd5fda4b4a1e39d191536083b`
- CJS: `9ecdcc41a4db7fe76ff2e589917ab16cea94194396d7e8fe2a8c22a38cdd2bfb`

The final selected artifacts also passed the complete 30-checkpoint USA/Japan
replay through the first win and next fight (`build/steps45-selected-runtime.json`).
All CPU, board, RAM, SHARC and audio hashes match the preserved O3+LTO reference.


Final normal-speed check at 1080p Enhanced+: baseline 99.95%, selected core
with ordinary audio 99.94%, and selected core with optional worklet 99.97%.
All images/state/audio checkpoints matched. The worklet reported zero
underruns, silent starvation frames, dropped frames or pool misses throughout
the 20-second timed interval (and its warm-up). It used 16 transport buffers
and zero playback-source nodes; the ordinary path created 1,329 source nodes
across warm-up and measurement. This proves the expected allocation reduction
and healthy playback in this test, not better audio under sustained slowdown.
Evidence: `build/steps45-normal/report.json`.

Final checks: 47 unit tests passed; GitHub Pages packaging copied 36 allowlisted
files and verified engine hashes. Packaged audio/frontend modules were compared
byte for byte with the selected sources. No ROMs, dependency symlinks, test
profiles or experimental engine variants enter the site package. GitHub has
not been pushed or deployed.

The final selected USA browser UI replay passed with matching artifact hashes,
including fullscreen, quit and relaunch. The test server on localhost:8084 was
stopped after validation; no listener remained.

## Diagnostic audio checksum — 2026-10-24

Baseline: the selected O3 + LTO + SHARC math build above, preserved in
`../Virtual-On-Web-backup-20261024-171916-pre-audio-checksum`. All 4,654 regular
files were SHA-256 verified. This experiment changes only the diagnostic work
in the frame-end audio loop; the default browser playback path remains ordinary
AudioBuffer/BufferSource playback.

The old runtime accumulated a 64-bit FNV checksum over every byte of every
stereo Float32 sample, including during normal play. That checksum is now
disabled by default. Sound CPU/SCSP emulation, samples, sample counts and peak
tracking remain unchanged. `_von_audio_checksums(1)` enables replay validation;
`_von_audio_hashed_frames()` reports its coverage. The diagnostic JSON reports
`audio: null` if disabled or any audio has been skipped, so partial/stale
checksums cannot pass as full-stream checksums. Reinitialization resets the
setting and coverage. The native diagnostic command-line host opts in.

Correctness evidence:

- Checksums enabled: all 30 historical CPU/board/RAM/SHARC/audio checkpoints
  matched through frame 7602 and the second fight in both regions. Each region
  hashed all 5,827,882 stereo sample frames (`build/checksum-on-runtime.json`).
- Production default: raw PCM bytes matched the preserved engine after every
  one of 7,602 video frames in each region; all other state and peak/count fields
  matched at the same 30 checkpoints. Exactly zero audio frames were hashed
  (`build/checksum-off-runtime.json`). Both runs also tested toggling, incomplete
  coverage and reset behavior.
- Browser UI: USA import, gameplay, all graphics modes, fullscreen, controls,
  quit and relaunch passed; all seven captured checkpoints reported zero hashed
  frames and the game produced audible PCM
  (`build/v3-standalone/play-vonu-enhanced-plus-player-wasm-checksum/report.json`).
- All 47 unit tests passed.

The paired CPU test uses three cases in the same browser thread: preserved
engine, new engine with checksums, and the same new engine without checksums.
It alternates case order over 24 adjacent chunks of 30 identical combat frames.
PCM is compared after each chunk, outside timing; full non-diagnostic state and
all enabled audio hashes are compared every six chunks. This separates the
checksum switch from recompilation effects. Specs:
`build/checksum-cpu-specs.json`.

| CPU throttle | Old engine (ms) | New, checksum on (ms) | New, checksum off (ms) | Old / new-off |
| --- | ---: | ---: | ---: | ---: |
| 3× | 18,231.7 | 18,712.8 | 18,133.6 | 1.0054× |
| 2.5× | 13,253.4 | 13,077.2 | 13,090.4 | 1.0125× |

Each total covers 720 identical frames. Compared with the preserved build,
the new default was about 0.5% and 1.2% faster in these runs. Within the same
new binary, disabling checksums measured 3.2% faster at 3× (17/24 chunks,
median ratio 1.0166×), but 0.1% slower at 2.5× (12/24 chunks, median 0.9997×).
These results do not isolate a reliable percentage benefit from checksum
removal; chunk timing varied substantially. The disabled case did perform
zero checksum work, and enabled coverage, PCM and state checks all passed.
Evidence: `build/checksum-cpu-3.json`, `build/checksum-cpu-2.5.json`.

Full-game comparison: Chrome 156.0.8078.48, AMD RDNA1, 1080p Enhanced+, 3× CPU
throttling, two 20-second rounds in reversed order, without a profiler.

| Engine | Round 1 game speed | Round 2 game speed | Mean |
| --- | ---: | ---: | ---: |
| Preserved baseline | 60.72% | 54.52% | 57.62% |
| New, checksum off | 60.13% | 56.44% | 58.28% |

The new default was slightly slower in the first round and faster in the
second. The mean difference was +0.66 percentage points of game speed, but
between-round drift and mixed ordering make an FPS gain inconclusive. All
12 state/audio, tile-layer and screenshot checkpoints matched exactly. The
new core stopped accumulating hashes before realtime warm-up and performed
zero additional checksum work during either timed interval. Evidence:
`build/checksum-e2e-3/report.json`; specs: `build/checksum-e2e-specs.json`.
These tests cover early combat on this host with artificial CPU throttling,
not late stages, different GPUs or every user's hardware.

**Selected locally:** skip unused audio checksums during normal play, retain
the full diagnostic path for tests. The measured performance difference is
small and inconsistent; no noticeable FPS improvement is promised. Audio,
game timing, graphics quality and the optional worklet selection are unchanged.
The selected artifacts are byte-identical to the tested checksum candidate:

- Wasm: `22d10ac3852d32b8240c9f7973c7b4682b25941615f8c8bb5d13f209dceb283c`
- CJS: `cd30df653fa4100ff0bfb51a150323271d9c20698b2258aef9d1d5beeff51e94`
- Wasm size: 8,793,881 bytes (327 bytes larger than the preserved baseline).

The default build manifest omits the machine-local link command. GitHub has
not been pushed or deployed.

Final packaging passed with 36 allowlisted files and verified engine hashes;
all copied sources and engine files matched the selected files byte for byte.
`git diff --check` passed. The temporary localhost:8084 test server was stopped
after validation, with no listener remaining.
