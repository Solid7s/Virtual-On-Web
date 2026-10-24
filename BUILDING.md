# Offline engine builds

The selected build uses O3, LTO and guarded SHARC math specialization.
`npm run build:player` reproduces those feature choices. Buffered AudioWorklet
playback remains opt-in with `?audio=worklet`.
Continuous audio checksums are disabled during normal play; sound generation
and peak tracking remain enabled. Diagnostic replay hosts opt in explicitly.

The repository includes the tested precompiled player. Serving the website does
not require rebuilding it, downloading MAME, or installing Emscripten.

The optimization research and acceptance criteria are in
[docs/OPTIMIZATION_RESEARCH.md](docs/OPTIMIZATION_RESEARCH.md). Experimental
compiler, sound, and GPU switches should use isolated variant directories:

```sh
python3 scripts/build_virtual_on_standalone.py --player --wasm --optimization O3 --variant opt-o3
python3 scripts/build_virtual_on_standalone.py --player --wasm --lto --variant opt-lto
python3 scripts/build_virtual_on_standalone.py --player --wasm --simd --variant opt-simd
python3 scripts/build_virtual_on_standalone.py --player --wasm --dsp-cache --variant opt-dsp
python3 scripts/build_virtual_on_standalone.py --player --wasm --gpu-projection --variant opt-gpu
```

These options are independent and do not enable register-block AOT. All retain
strict floating-point behavior. Use the same `--profiling` setting when comparing
binary sizes; the previous default player includes a large function-name section.

The DSP cache can be checked without ROMs against the pinned DSP interpreter
after sound sources have been generated:

```sh
clang++ -std=c++20 -O2 -fno-fast-math -ffp-contract=off -DVON_DSP_CACHE -DVON_DSP_TEST -Iruntime/virtual_on -Ibuild/v3-standalone tests/virtual-on-dsp.cpp build/v3-standalone/sound_dsp.cpp -o build/virtual-on-dsp-test
./build/virtual-on-dsp-test
```

`tests/virtual-on-cpu-paired.cjs` accepts `TEST_SPECS`, a JSON array of objects
with `name` and `engine` directory fields, for comparisons beyond the earlier
three AOT cases. `TEST_SPECS_FILE` reads that array from a local JSON file.
Optional `blocks` enables/disables that separate experiment. For the experimental
GPU build, `projection: 1` selects full GPU projection, `projection: 2` retains
CPU screen coordinates and reciprocal depth while offloading UV attributes and
flat color, and `projection: 0` selects the original renderer packet.
`TEST_CPU_RATE` selects throttling, `TEST_ROUNDS` defaults to 24, and `TEST_GAME=vonj`
selects Japan. Every six chunks, complete state and cumulative audio hashes must
match. Optional `checksums: 0` disables diagnostic audio hashing for that case;
the default is `1`. Disabled cases must report a null audio hash and zero
hashed frames while all other state matches. The harness also compares raw PCM
after each timed chunk, outside the timing interval. It excludes GPU
presentation and browser audio scheduling.

`tests/virtual-on-runtime-compare.cjs` can use `TEST_REFERENCE` pointing to a
previous baseline replay JSON instead of executing that baseline again. The
reference must have the identical inputs and checkpoints; missing checkpoints
fail. `TEST_RENDER=1 TEST_TILES=1` also exercises CPU render preparation with GPU
tiles, although it does not submit any GPU draws.
It enables audio checksums by default to preserve historical reference checks.
`TEST_CHECKSUMS=0` instead exercises the candidate's production default and
requires `TEST_BASELINE` (not a saved reference): it compares every frame's
raw PCM bytes, all non-diagnostic state, and verifies zero checksum work.
Both modes also check checksum toggling and reinitialization.

The core exports `_von_audio_checksums(1)` to enable diagnostic hashing after
`von_init`, before the first frame. `_von_audio_hashed_frames()` reports its
coverage. The `audio` field in `von_state`'s JSON is null when hashing is disabled or any
audio frames have been skipped; reinitializing starts a fresh stream with
hashing disabled. The native command-line replay enables it automatically.

The browser performance harness normally requires identical screenshots. Its
explicit diagnostic option `TEST_PIXEL_REPORT=1` reports differing pixels and
channel errors while keeping state, audio and tile comparisons strict. Such a
report is not a claim of exact graphical equivalence or an acceptance threshold.
`TEST_PROJECTION=2` selects the narrower GPU path in the candidate for this
browser harness; the backup remains unchanged.
For checksum-capable cores, the full-game performance harness enables hashing
through its exact checkpoints, then disables it for timed realtime play by
default. A spec's `checksums: 1` keeps it on. The optional fixed-frame interval
retains hashing; use the paired CPU harness to isolate checksum savings.

The build scripts translate user-supplied arcade CPU programs into C++ and then
WebAssembly. They are developer tooling for macOS/Linux with Python 3.10+, Git,
Clang with C++20 support, and Emscripten 6.0.2. Generated files remain in ignored
`build/` directories, apart from the three explicitly shipped player artifacts.

## Dependencies

Use these exact upstream source revisions:

```sh
mkdir -p vendor tools roms/ready
git clone https://github.com/mamedev/mame.git vendor/mame
git -C vendor/mame checkout f9b2a9da4e937468fdd9099e8316e6ad40659f86
git clone https://github.com/alphanu1/daytona-arcade-recomp.git vendor/daytona-recompiler
git -C vendor/daytona-recompiler checkout b33baeb28a1e1c94d90a4a80811f0b2c7f61106b
git clone https://github.com/emscripten-core/emsdk.git tools/emsdk
tools/emsdk/emsdk install 6.0.2
tools/emsdk/emsdk activate 6.0.2
```

Place your complete USA and Japan Revision B ZIPs at `roms/ready/vonu.zip` and
`roms/ready/vonj.zip`. Both regions are compiled into the player. Archives must
contain the shared data as well as the regional CPU programs. Do not commit them.
These are offline compiler input filenames; the browser's primary input is the
`von.zip` parent archive described in [README.md](README.md).

```sh
python3 scripts/build_virtual_on_standalone.py --player --wasm --optimization O3 --lto
```

The address-only entrypoint lists in `runtime/virtual_on/` retain discovery
coverage from development. Instruction words and graphics/audio data are read
from the supplied ROMs. The generator may also incorporate additional local
traces if present. Compiler versions and discovery inputs can change binary
hashes; this is not a claim of byte-for-byte reproducible builds.

The selected player uses O3 plus LTO. `npm run build:player` includes those flags.
The compiler script's own default remains O2 for controlled experiments. SIMD,
DSP caching, register-block AOT and GPU vertex preparation remain opt-in. For the
GPU variant, add `--gpu-projection-mode attributes` to start with the path that
retains CPU projection; full GPU projection showed small pixel differences.

The shipped manifest records the actual release engine hashes. A rebuilt engine
must be validated independently, including first-match progression. The public
release packaging does not recompile the already validated engine.

## Performance and graphics regression checks

Keep a copy of the previous player artifacts before building a candidate with
`--variant candidate --profiling`. The function names assist profiling; the
timed comparisons below do not attach a profiler, which can affect Wasm tiers.
Set `TEST_BASELINE` to the previous `player-wasm` directory and `TEST_CANDIDATE`
to `build/v3-standalone/player-wasm-candidate`:

```sh
node tests/virtual-on-runtime-compare.cjs
node tests/virtual-on-performance.cjs
```

The runtime comparison checks both regions' CPU, board, memory, SHARC and audio
states through the first win and next fight. The browser comparison checks
pixels and state at attract, selection and combat, then measures the backup,
the candidate with CPU tile composition and the candidate with GPU tile composition. It
defaults to two rounds in reversed order, 20 seconds each, at 2× CPU throttling.
Use `TEST_CPU_RATE=1` for normal speed or `TEST_MODE=enhanced-plus` for widescreen.
This emulates main-thread CPU pressure, not a particular CPU or GPU model.

Register-block AOT is an **opt-in experiment**, because the October 24 tests
did not show a consistent real-time benefit. Normal builds and the shipped
player retain the preceding CPU + GPU implementation. Build an isolated
experiment with `--player --wasm --aot-blocks --variant blocks --profiling`.
Compare against the preceding CPU + GPU build with GPU tiles enabled in both
engines. The `no-blocks` case isolates register-helper specialization from
instruction batching:

```sh
TEST_BASELINE_TILES=1 TEST_CASES=backup,no-blocks,aot TEST_CPU_RATE=2.5 node tests/virtual-on-performance.cjs
TEST_BASELINE_TILES=1 TEST_CASES=backup,aot TEST_CPU_RATE=3 node tests/virtual-on-performance.cjs
```

`TEST_FIXED_FRAMES=120` adds three equal-work CPU samples before the real-time
test. These samples include emulated audio and CPU render preparation, but
exclude GPU presentation and browser audio scheduling. For shorter alternating
CPU samples of all three paths in one browser thread, use
`TEST_CPU_RATE=3 node tests/virtual-on-cpu-paired.cjs` with the same engine paths.

Set `TEST_OUTPUT` to separate directories to retain both reports. Keep the
machine free of concurrent builds/replays during these timed runs. Each engine
uses the same graphics mode, warm-up, input sequence and browser; no profiler
is attached. `TEST_ROUNDS` defaults to two, reversing case order in round two.

The block generator joins up to eight whitelisted, register-only instructions.
It never batches loads, stores, branches or changes to interrupt priority, and
the runtime requires completion strictly before the next board, UART, sound or
video event. All other execution uses the existing compiled instruction path.
The native test checks every generated entry against the pinned interpreter
over deterministic edge cases and randomized registers, including deadline,
IRQ and stalled-transfer guards:

```sh
python3 scripts/build_virtual_on_standalone.py --block-test --oracle
build/v3-standalone/blocks-oracle/virtual-on-probe build/v3-standalone
```

The interpreter is confined to that native test. It is never linked into the
player. In experimental builds, `_von_blocks(0)` disables batching for
diagnostics; state hashes exclude optimization counters. Normal builds omit
the block tables, specialized helpers and diagnostic block exports entirely.

The GPU tile shader also has ROM-free fixtures generated by the pinned CPU
compositor, covering scroll modes, split boundaries, masks and disabled layers:

```sh
clang++ -std=c++20 -O2 -Ibuild/v3-standalone/daytona tests/virtual-on-tiles.cpp build/v3-standalone/daytona/runtime/video.cpp build/v3-standalone/daytona/runtime/raster.cpp -o build/virtual-on-tiles
./build/virtual-on-tiles build/tile-fixtures
node tests/virtual-on-tiles.cjs
```

Browser tests require the local server and Playwright. Reports and fixtures go
under ignored `build/`; ROMs, extracted binaries and generated instruction code
remain local.

## SHARC math and buffered audio

Generate the isolated math candidate with the same compiler settings as the
O3+LTO baseline:

```sh
python3 scripts/build_virtual_on_standalone.py --player --wasm --optimization O3 --lto --sharc-math --variant sharc-math
python3 scripts/build_virtual_on_standalone.py --sharc-math-test --oracle --optimization O3
build/v3-standalone/sharc-math-oracle/virtual-on-probe
```

The native oracle test covers 6,000 randomized/edge-case polynomial executions
and 19 fallback guards. Production Wasm contains no interpreter. The optional
`_von_sharc_math_instructions()` export counts specialized instructions. The
separate `--sharc-profile --variant sharc-profile` build exposes a PC histogram
for `node tests/virtual-on-sharc-profile.cjs`; do not use that instrumented build
for speed comparisons.

After generating sources, the focused oracle test can also be built directly:

```sh
clang++ -std=c++20 -O3 -fno-fast-math -ffp-contract=off -DVON_TEST_ORACLE -DVON_SHARC_MATH -Iruntime/virtual_on -Ibuild/v3-standalone build/v3-standalone/sharc_program.cpp runtime/virtual_on/sharc_runtime.cpp tests/virtual-on-sharc-math.cpp -o build/sharc-math-oracle-test
build/sharc-math-oracle-test
```

Use `tests/virtual-on-runtime-compare.cjs` for full USA/Japan replays. It requires
matching CPU, RAM, board, SHARC and cumulative audio hashes through the next
fight, and checks that the specialization actually runs.

The AudioWorklet's ring is covered by `npm test`. With the local server running,
`node tests/virtual-on-audio.cjs` checks actual offline worklet output sample for
sample, pooled delivery, pause/resume/close, and fallback for a 48 kHz context or
failed worklet loading. The player exposes diagnostics at
`virtualOn.audio.stats`; no diagnostic labels are added to the game UI.
`?audio=worklet` opts into the buffered playback experiment; `?audio=legacy`
selects the normal browser playback path. Automatic
fallback also preserves browser resampling if native 44.1 kHz is unavailable.

The end-to-end performance harness accepts `frontend` in a specs-file entry to
serve `web/model2/virtual-on-player.js` from a preserved checkout. This allows an
exact old/new audio comparison using identical engine files. An entry's
`audio: "worklet"` enables buffered playback, while `audio: "legacy"` selects
the normal playback path. Reports include audio
queue statistics and SHARC specialization counts. Keep the server current so
relative module imports resolve, and keep builds/replays out of timed runs.

## Website deployment

`npm run build:site` checks the engine hashes and copies only `site-files.json`
entries into `_site/`. It strips local compiler command paths from the deployed
manifest. It rejects symlinks and ROM/archive paths. GitHub Actions runs the unit
tests and this packaging step, then deploys `_site/` to GitHub Pages.

Keep the notices and licenses in the deployed site. Before committing a rebuilt
`build.json`, remove its local `linkCommand` field; it can contain machine paths.
