# Virtual On performance optimization research

The next experiments target slower CPUs while preserving game timing, audio,
graphics, and both USA and Japan programs. The current local player includes
the tested CPU changes and GPU tile compositor. The register-block AOT
experiment remains optional because its measurements were inconsistent.

## Priorities

1. **Compiler optimization:** compare the existing O2 build with O3, link-time
   optimization (LTO), and WebAssembly SIMD separately before combining them.
   Keep strict floating-point behavior. LTO permits optimization across source
   files; SIMD permits parallel arithmetic but does not guarantee a speedup.
   Sources: [Emscripten optimization](https://emscripten.org/docs/optimizing/Optimizing-Code.html)
   and [WebAssembly SIMD](https://emscripten.org/docs/porting/simd.html).
2. **Sound DSP:** the SCSP effects interpreter decodes its microprogram at each
   sample while active. Measure its activity, then test cached decoding and
   potentially specialization of frequently used programs. Preserve program
   writes, timer/IRQ ordering, feedback, and exact audio results. Sound generation
   is a measured hotspot; the effects interpreter's individual share is not yet
   established. This is separate from the already compiled 68000 sound CPU.
3. **GPU polygon preparation:** move suitable per-vertex projection and rendering
   attribute calculations from the CPU into shaders. Reduce duplicated vertex
   payloads where possible. Preserve polygon ordering, viewport clipping,
   transparency, widescreen detection, and character-selection water correction.
   Keep intermediate GPU results on the GPU rather than reading them back.
4. **SHARC routine specialization:** identify expensive repeated math routines
   and replace them with equivalent native/SIMD operations or independent GPU
   batches. This requires deeper work to preserve memory effects and timing.
5. **Buffered audio and AudioWorklet:** replace per-frame playback-node allocation
   with persistent buffered delivery. This may improve stuttering and audio
   stability without increasing emulation throughput. Shared-memory designs need
   deployment support for cross-origin isolation. Sources:
   [Chrome AudioWorklet design](https://developer.chrome.com/blog/audio-worklet-design-pattern),
   [Emscripten AudioWorklets](https://emscripten.org/docs/api_reference/wasm_audio_worklets.html),
   and [threading requirements](https://emscripten.org/docs/porting/pthreads.html).

The i960 and SHARC exchange results that the game often needs immediately.
Offloading their entire instruction streams would introduce synchronization;
the best GPU candidates are independent batches whose results feed rendering.
[WebGPU buffer ownership and readback](https://gpuweb.github.io/gpuweb/explainer/#buffer-mapping)
explains why CPU access must wait for GPU access to finish.

An additional small candidate is gating the continuous diagnostic audio checksum
behind a testing option. Keep it available for exact regression comparisons.

## Measurement and acceptance

- Saved CPU profiles cover early combat, not the later space and boss stages.
- Run each candidate independently against the preserved current engine, with
  identical inputs, warm-up, and reversed comparison order at 2.5x and 3x CPU
  throttling. Keep compilation and other benchmarks out of timing runs.
- Compare CPU/board/memory/SHARC/audio state through match transitions in both
  regions. Check screenshots and GPU validation for graphics changes.
- GPU projection can differ in floating-point rounding across devices; visual
  tolerances must be explicit, measured, and reviewed, never silently relaxed.
- CPU throttling is not a simulation of a weaker GPU or a named computer.
  Verify on additional real GPUs before claiming broad performance gains.
- Retain the playable default until a candidate passes checks and shows a
  repeatable benefit. Do not publish experimental artifacts or ROM data.

## Implementation record

Work on priorities 1–3 began on 2026-10-24. The complete checkout was backed up
to `../Virtual-On-Web-backup-20261024-114254-pre-optimization-123`; all 2,429
regular files were SHA-256 verified and four dependency symlinks preserved.
Detailed results and reproduction commands belong in `PERFORMANCE.md` and
`BUILDING.md` alongside the earlier optimization experiments.

Priorities 1–3 now have implemented and tested variants. O3 plus LTO was selected
as the local default after a modest improvement in both comparison orders at
2.5x and 3x throttling. SIMD and the sound decode cache did not establish gains.
The indexed GPU attribute path matched the tested images and reduced geometry
uploads by about 31%, but did not improve playback consistently; it remains
optional. Full GPU projection also remains optional because it introduced small
pixel differences. See `PERFORMANCE.md` for measurements, correctness coverage,
artifact hashes, and the remaining work. GitHub has not been updated.

## Priorities 4–5: SHARC math and buffered audio

Work began on 2026-10-24 after saving
`../Virtual-On-Web-backup-20261024-161328-pre-optimization-45` (4,096 regular
files SHA-256 verified). The baseline is the selected O3+LTO build, including
its original browser audio code, rather than the older O2 baseline.

Instruction-frequency capture in both regions found that the two-instruction
polynomial loop at SHARC PCs `0x20dd8`–`0x20dd9` accounts for about 13.3% of
SHARC instructions during the tested early fights. A guarded native loop now
uses the same floating-point helpers, coefficient reads, status history, loop
stack restoration, and cycle accounting, avoiding repeated instruction dispatch.
It is not a replacement `sin`/`cos` approximation, an FMA contraction, or GPU
readback. Pending interrupts, DMA, register latency, circular addressing,
external memory, modified code and unexpected loop/pipeline state use the
original compiled instructions. Instruction tracing also disables batching.

The audio candidate uses one AudioWorklet and a bounded stereo ring, with 16
recycled transferable buffers. No shared memory or cross-origin isolation is
needed. It requests native 44.1 kHz; devices rejecting that rate retain the
browser's resampling through the original playback-node path. Worklet loading
or processing failure also falls back. Pause clears queued audio, and quit
closes the context and message port. The emulated SCSP/68000 still runs with
the game; this change moves playback buffering, not sound emulation, off the
main thread. It cannot synthesize missing sound when game execution is too slow.

See `PERFORMANCE.md` for the comparison results and selected defaults, and
`BUILDING.md` for reproduction commands. Profiling builds are excluded from
performance comparisons. Measurements still cover early fights, not the space
stages or final boss.

Selection after testing: enable the guarded SHARC math path alongside O3+LTO.
Adjacent equal-work CPU tests improved about 1.1% at 3× throttling and 1.7% at
2.5×, with exact state/audio matches. Buffered AudioWorklet is implemented and
verified but remains opt-in (`?audio=worklet`) because its full-game performance
was inconsistent. The ordinary playback path remains the default. Full-game
results varied substantially; no universal percentage gain, late-stage speedup,
or broad-device guarantee is established.

## Follow-up: optional diagnostic audio checksums

Normal gameplay was still accumulating a 64-bit FNV hash over every byte of
every stereo float sample. Playback does not use that hash. The runtime now
skips this work by default while preserving sound emulation, output samples,
sample counts and peak tracking. Replay tests explicitly enable the original
checksum, and a separate diagnostic counter verifies that normal play hashes
zero frames. A disabled or incomplete checksum is reported as JSON null.

The pre-change checkout is preserved in
`../Virtual-On-Web-backup-20261024-171916-pre-audio-checksum`; all 4,654 regular
files were SHA-256 verified. The checksum-off regression compares every
frame's PCM bytes against that engine in both regional replays; the enabled
path retains comparison against the saved cumulative hashes. CPU comparisons
use old engine, new engine with checksums, and new engine without checksums
to separate recompilation effects from the diagnostic work being removed.
Results belong in the final checksum section of `PERFORMANCE.md`.
