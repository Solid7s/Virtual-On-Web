// SPDX-License-Identifier: BSD-3-Clause
// Small cooperative frame driver, using Daytona's existing native geometrizer.
#pragma once
#include "coprocessor.h"
#include "runtime/geo.h"
namespace von {
class FrameRuntime {
public:
    Board &board;
    Coprocessor &copro;
    std::vector<uint32_t> buffer = std::vector<uint32_t>(0x8000);
    std::unique_ptr<rt::Geo> geometry;
    uint64_t frames = 0, parsed = 0, polygons = 0, next_vblank = 393600;
    uint64_t command_hash = 14695981039346656037ull;
    std::function<void()> present;
    FrameRuntime(Board &b, Coprocessor &c, const std::vector<uint8_t> &models, const std::vector<uint8_t> &textures)
        : board(b), copro(c), geometry(std::make_unique<rt::Geo>(models, textures, buffer.data())) {
        geometry->record_pushes = true;
    }
    void advance(unsigned ticks) {
        // Exact rational conversion: 16 MHz pixel clock, 656 x 424 total,
        // 384 visible lines, expressed in the main CPU's 25 MHz clock.
        const uint64_t end = board.now() + ticks;
        while (next_vblank <= end) {
            board.advance(next_vblank - board.now());
            if (copro.started) copro.pump(false);
            ++frames;
            if (copro.comm) copro.comm->tick();
            if (board.render_this_frame(frames)) {
                board.copy_buffer(buffer.data());
                geometry->zclip_w(board.zclip);
                geometry->parse(copro.geo.read_start);
                ++parsed; polygons += geometry->polys.size();
                for (auto word : geometry->pushed) for (unsigned i = 0; i < 4; ++i)
                    command_hash = (command_hash ^ uint8_t(word >> (i*8))) * 1099511628211ull;
            }
            board.vblank(frames);
            if (present) present();
            next_vblank += 434600;
        }
        board.advance(end - board.now());
        if (copro.uart) copro.uart->advance(board.now());
    }
};
}
