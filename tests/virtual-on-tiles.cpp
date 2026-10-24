// SPDX-License-Identifier: BSD-3-Clause
// Generate ROM-free fixtures with the pinned CPU compositor as the oracle.
// Compile after prepare_virtual_on_standalone.py, with video.cpp/raster.cpp.
#include "runtime/video.h"
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

int main(int argc, char **argv) {
    if (argc != 2) return 1;
    const std::filesystem::path output(argv[1]);
    std::filesystem::create_directories(output);
    std::vector<uint8_t> tiles(0x10000), chars(0x80000), palette(0x4000), colors(0xc000);
    auto word = [](auto &bytes, unsigned index, uint16_t value) {
        bytes[index*2] = uint8_t(value); bytes[index*2+1] = uint8_t(value >> 8);
    };
    uint32_t random = 0x27182818;
    auto next = [&] { random ^= random << 13; random ^= random >> 17; return random ^= random << 5; };
    for (auto &c : chars) c = uint8_t(next());
    // Include fully transparent characters, category changes, and all pens.
    std::fill_n(chars.begin(), 64, uint8_t(0));
    for (unsigned i = 0; i < 0x2000; ++i) word(palette, i, uint16_t(next()));
    for (unsigned i = 0; i < 0x6000; ++i) word(colors, i, uint16_t(64 + next()%192));
    rt::Video video(tiles.data(), chars.data());
    video.set_external_3d(true);
    const rt::VideoMem mem{palette.data(), colors.data(), nullptr, nullptr, nullptr, 0};
    std::vector<rt::GeoPoly> polys;
    for (unsigned fixture = 0; fixture < 24; ++fixture) {
        for (unsigned i = 0; i < 0x8000; ++i) word(tiles, i, uint16_t(next()));
        const unsigned mode = fixture % 4, line_scroll = (fixture / 4) & 1;
        for (unsigned layer = 0; layer < 4; ++layer) {
            word(tiles, 0x5000 + layer, uint16_t((next() & 0x3ff) | (line_scroll << 15)));
            word(tiles, 0x5004 + layer, uint16_t((next() & 0x3ff) | (mode << 13)
                | ((fixture >= 16 && layer == (fixture & 3)) ? 0x8000 : 0)));
        }
        // Explicit boundaries: zero and off-screen split coordinates.
        if (fixture >= 8 && fixture < 16) {
            word(tiles, 0x5000, uint16_t(fixture & 1 ? 511 : 0));
            word(tiles, 0x5004, uint16_t((mode << 13) | (fixture & 1 ? 512 : 0)));
        }
        for (unsigned i = 0; i < 0x2000; ++i) video.palette_w(i, palette.data(), colors.data());
        video.screen_update(polys, 0, mem);
        std::ofstream file(output / (std::to_string(fixture) + ".dat"), std::ios::binary);
        auto write = [&](const void *p, size_t n) { file.write(static_cast<const char *>(p), n); };
        write(tiles.data(), tiles.size()); write(chars.data(), chars.size());
        for (unsigned i = 0; i < 4096; ++i) { const auto pen = video.system24_pen(i); write(&pen, sizeof pen); }
        write(video.background_layer().data(), 496*384*4);
        write(video.foreground_layer().data(), 496*384*4);
    }
}
