# Standalone runtime source attribution

The standalone runtime does not link the MAME emulator framework. It does reuse
MAME-derived hardware and instruction semantics, as the Daytona native runtime
also does. Removing the framework does not remove the source's attribution.

The generator reads MAME commit
`f9b2a9da4e937468fdd9099e8316e6ad40659f86`. The following individually BSD-3-Clause
sources supply the relevant semantics:

| Source | Copyright holders | Adaptation |
| --- | --- | --- |
| `src/devices/cpu/i960/i960.cpp`, `.h` | Farfetch'd, R. Belmont | Architectural fields, operand helpers, instructions, register cache, interrupt and burst-stall services. Framework removed; memory goes through `von::Bus`. Only the separate test oracle retains the interpreter. |
| `src/mame/sega/model2.cpp`, `model2_v.cpp` | R. Belmont, Olivier Galibert, ElSemi, Angelo Salese, Matthew Daniels | Model 2B maps, registers, timer/IRQ semantics, input wiring, video origin and SHARC host upload wiring. |
| `src/mame/sega/315_5649.cpp` | Dirk Best | Input port direction, lane mapping, analog mux and serial defaults. |
| `src/devices/machine/eeprom.cpp`, `eepromser.cpp` | Aaron Giles | Serial EEPROM protocol and busy timings, rewritten around a plain clock value. |
| `src/devices/cpu/sharc/sharc.cpp`, `.h`, `sharcinternal.ipp`, `sharcops.hxx`, `sharcops_table.cpp`, `compute.hxx`, `sharcdma.hxx` | Ville Linde | Plain architectural state, compiled instruction bodies, arithmetic, PM/DM packing and mirrors, loops, DMA, delayed writes and interrupts. MAME framework removed; interpreter compiled only in native tests. |
| `src/devices/cpu/m68000/m68000.cpp`, `.h`, generated instruction handlers | Olivier Galibert | Compiled sound-program instructions, arithmetic, partial instructions and interrupt/reset sequences; independent sound bus. |
| `src/devices/sound/scsp.cpp`, `.h`, `scspdsp.cpp`, `.h` | ElSemi, R. Belmont | PCM slots, envelopes, pitch/LFO, sound DSP, timers, MIDI and interrupts. Framework/timers/stream replaced by plain C++ services; deterministic noise source. |
| `src/devices/machine/i8251.cpp`, `.h` | smf, Robbbert | Sound UART register protocol and timed serial byte transfer. |
| `src/mame/sega/m2comm.cpp`, `.h` | Ariane Fugmann | Single-cabinet communication-board register and no-link behavior. |

The offline reachability analyzer uses `daytona-arcade-recomp` at
`b33baeb28a1e1c94d90a4a80811f0b2c7f61106b` (BSD-3-Clause; see its `LICENSE` and
`THIRD_PARTY.md`). Its pinned `src/runtime/geo.cpp`, `geo.h`, `fast_paths.h` and
`rom_source.h` now also provide the independent high-level geometrizer. The
geometry command ports adapt `m2_tgp_board.cpp`, which credits the same MAME
Model 2 authors above. Generated copies retain the source notices.
The player also uses pinned `video.cpp`, `video.h`, `raster.cpp`, `raster.h`,
`raster_texel.h` and `video_profile.h`. The generator disables the Vita/GXM
tile-composition shortcut so the browser receives complete CPU tile layers.

Daytona project copyright: Copyright (c) 2026, Ben Templeman and contributors.
Its BSD-3-Clause terms are the same three conditions and disclaimer reproduced
below; the original full notice also remains in `vendor/daytona-recompiler/LICENSE`.

Generated C++ instruction bodies, uploaded programs, extracted ROM data and
full test traces remain local build products. This release includes a compiled
WebAssembly player containing ROM-derived translated instructions; those
instructions are not relicensed by the software terms below. See ../../NOTICE.md.

The BSD-3-Clause terms applicable to the adapted MAME sources are reproduced
below. Copyright remains with the holders identified above.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED
AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
