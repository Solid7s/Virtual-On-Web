// SPDX-License-Identifier: BSD-3-Clause
// SHARC host boot interface, derived from MAME sharc.cpp (Ville Linde) and
// model2.cpp (R. Belmont, Olivier Galibert, ElSemi, Angelo Salese, Matthew Daniels).
// CPU execution is deliberately a separate integration boundary.
#pragma once
#include "board.h"
#include <algorithm>

namespace von {
class SharcHost : public Devices {
public:
    // Emulated RAM belongs on the heap; a 128 KiB array exceeds Wasm's default
    // C++ stack before the first instruction and can corrupt dispatch tables.
    std::vector<uint64_t> program = std::vector<uint64_t>(0x4000);
    uint32_t program_words = 0, uploaded_halfwords = 0;
    uint32_t control = 0, syscon = 0, dma_control = 0xa1;
    uint32_t index = 0x20000, modifier = 1, count = 0x100;
    std::function<void()> boot;
    std::vector<uint8_t> program_bytes() const {
        std::vector<uint8_t> bytes;
        for (uint32_t i = 0; i < program_words; ++i)
            for (unsigned j = 0; j < 6; ++j) bytes.push_back(uint8_t(program[i] >> (j*8)));
        return bytes;
    }
    uint32_t read(uint32_t a, uint32_t mask) override {
        if (a == 0x00980000) return control;
        // Held in reset throughout boot; its output FIFO is genuinely empty.
        if (a == 0x00980004 && !running_) return 1;
        if (a == 0x00980014) return uploaded_halfwords ? 0 : ~0u;
        return Devices::read(a, mask);
    }
    void write(uint32_t a, uint32_t v, uint32_t mask) override {
        if (a == 0x00980000) {
            if ((v ^ control) == 0x80000000) {
                if (v & 0x80000000) uploaded_halfwords = 0;
                else {
                    if (!boot) throw DeviceBoundary("SHARC execution not connected", a, v, mask, true);
                    boot(); running_ = true;
                }
            }
            control = (control & ~mask) | (v & mask);
            return;
        }
        if (a >= 0x008c0000 && a <= 0x008c0ffc) { iop((a-0x008c0000)/4, v); return; }
        if (a >= 0x00884000 && a <= 0x00887ffc && (control & 0x80000000)) {
            dma(uploaded_halfwords, uint16_t(v)); ++uploaded_halfwords; return;
        }
        Devices::write(a, v, mask);
    }
private:
    uint32_t packed_ = 0, packed_count_ = 0;
    bool running_ = false;
    void iop(uint32_t address, uint32_t value) {
        if ((syscon & 0x10) && address != 4) {
            if ((packed_count_++ & 1) == 0) { packed_ = value & 0xffff; return; }
            packed_ |= (value & 0xffff) << 16;
        } else packed_ = value;
        switch (address) {
        case 0: syscon = packed_; return;
        case 2: return; // external memory wait-state configuration
        case 0x1c: dma_control = packed_; return; // external write does not start internal DMA
        case 0x40: index = packed_; return;
        case 0x41: modifier = packed_; return;
        case 0x42: count = packed_; return;
        default: throw DeviceBoundary("SHARC host IOP register not connected", 0x008c0000 + address*4, packed_, ~0u, true);
        }
    }
    void dma(uint32_t address, uint16_t value) {
        const uint32_t mode = (dma_control >> 6) & 3;
        if (mode != 2) fatalerror("SHARC boot requires 16/48 packing; got mode %u", mode);
        const uint32_t position = index & 0x1ffff;
        if (position >= program.size()) fatalerror("SHARC boot PM address outside first block: %08x", index);
        const unsigned word = address % 3;
        const unsigned shift = ((dma_control & 0x100) ? 2-word : word)*16;
        program[position] = (program[position] & ~(uint64_t(0xffff) << shift)) | (uint64_t(value) << shift);
        program_words = std::max(program_words, position+1);
        if (word == 2) index += modifier;
    }
};
} // namespace von
