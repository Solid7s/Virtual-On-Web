// SPDX-License-Identifier: BSD-3-Clause
// Single-cabinet Model 2 communication board. Same no-link model as the
// installed web engine (prepare_model2.py), derived from MAME m2comm.cpp
// (Ariane Fugmann).
// It reports a live board and NO peer; this is not multiplayer emulation.
#pragma once
#include <array>
#include <cstdint>
namespace von {
class Comm {
public:
    std::array<uint8_t, 0x4000> ram{};
    uint8_t cn = 0, fg = 0, zfg = 0;
    uint8_t read(uint32_t offset) const {
        if (offset < 0x4000) return ram[offset];
        if (offset == 0x4000) return cn | 0xfe;
        if (offset == 0x4002) return fg | ((~zfg & 1) << 7) | 0x7e;
        return 0;
    }
    void tick() {
        if (cn) { ram[0] = 0; ram[2] = ram[3] = 0xff; zfg ^= 1; }
    }
    void write(uint32_t offset, uint8_t value) {
        if (offset < 0x4000) { ram[offset] = value; return; }
        if (offset == 0x4002) { fg = value & 1; return; }
        if (offset != 0x4000) return;
        cn = value & 1;
        if (!cn) { fg = zfg = 0; return; }
        ram.fill(0); ram[1] = 2;
        ram[0x12] = 0; ram[0x13] = 0x0e;
        ram[0x14] = 0xc0; ram[0x15] = 1;
        tick();
    }
};
}
