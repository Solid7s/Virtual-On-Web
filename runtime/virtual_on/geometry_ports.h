// SPDX-License-Identifier: BSD-3-Clause
// Geometrizer command/upload ports adapted from Daytona's m2_tgp_board.cpp
// and MAME model2.cpp. Display-list execution/rendering is a separate consumer.
// Copyright holders: R. Belmont, Olivier Galibert, ElSemi, Angelo Salese,
// Matthew Daniels. See THIRD_PARTY.md.
#pragma once
#include "board.h"
namespace von {
class GeometryPorts {
public:
    Board &board;
    uint32_t control = 0, uploaded = 0, read_start = 0, write_start = 0;
    explicit GeometryPorts(Board &b) : board(b) {}
    void push(uint32_t v) {
        if (write_start >= 0x20000) fatalerror("Geometry list exceeds shared buffer: %x", write_start);
        board.write_dword(0x900000 + (write_start & ~3u), v); write_start += 4;
    }
    uint32_t read(uint32_t a) const {
        if (a >= 0x804000) return ~0u;
        if (a == 0x802008) return write_start;
        if (a == 0x803008) return read_start;
        return 0;
    }
    void write(uint32_t a, uint32_t v) {
        if (a == 0x980008) {
            if ((v ^ control) == 0x80000000 && (v & 0x80000000)) uploaded = 0;
            control = v; return;
        }
        if (a >= 0x804000 && a <= 0x807ffc) {
            // Like Daytona/MAME's high-level geometrizer, retain the upload
            // handshake/count. Its undocumented microcode is not a CPU program.
            if (control & 0x80000000) ++uploaded; else push(v);
            return;
        }
        const uint32_t address = a - 0x800000;
        if (address < 0x1000) {
            if (v & 0x80000000) push((v & 0x800fffff) | (((address >> 4) & 0x3f) << 23));
            else if ((address & 0xf) == 0) {
                uint32_t r = (v & 0xfffff) | (((address >> 4) & 0x3f) << 23);
                if (((address >> 4) & 0xc0) && ((address >> 4) & 0x3f) == 1) r |= ((address >> 10) & 3) << 29;
                push(r);
            }
        } else if (address == 0x1008) write_start = v & 0xfffff;
        else if (address == 0x3008) read_start = v & 0xfffff;
        else throw DeviceBoundary("Geometry register write", a, v, ~0u, true);
    }
};
}
