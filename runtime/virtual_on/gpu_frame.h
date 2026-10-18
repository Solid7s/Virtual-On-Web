// SPDX-License-Identifier: BSD-3-Clause
// Standalone producer of the existing Model 2 WebGPU ABI. Vertex encoding and
// ordering follow scripts/model2_webgpu.ipp and Daytona's native Raster.
#pragma once
#include "frame_runtime.h"
#include "runtime/video.h"
#include "../../scripts/model2_scene.h"
#include <numeric>
namespace von {
class GpuFrame {
public:
    struct Vertex { float x, y, depth, ooz, uoz, voz, r, g, b, a; uint32_t info[4], more[2]; };
    struct Batch { uint32_t first, count, x, y, width, height; };
    static_assert(sizeof(Vertex) == 64 && sizeof(Batch) == 24);
    std::vector<Vertex> vertices;
    std::vector<Batch> batches;
    std::array<uint32_t, 0x8000> luma{};
    std::array<uint32_t, 0x6000> xlat{};
    std::array<uint8_t, 256> gamma{};
    std::array<uint32_t, 24> packet{};
    std::vector<size_t> order;
    int margin = 0;
    uint32_t sequence = 0;
    std::array<std::vector<uint32_t>, 4> previous;
    std::array<uint32_t, 4> generations{};
    void track(unsigned index, const uint32_t *data, size_t count) {
        auto &old = previous[index];
        if (old.size() != count || std::memcmp(old.data(), data, count*sizeof(uint32_t))) {
            old.assign(data, data + count);
            ++generations[index];
        }
    }
    GpuFrame() {
        for (unsigned i = 0; i < 256; ++i) gamma[i] = uint8_t(std::max((double(i)-64)*255/191, 0.0));
    }
    static uint16_t word(const uint8_t *p, unsigned i) { return uint16_t(p[2*i]) | uint16_t(p[2*i+1]) << 8; }
    void build(Board &board, Coprocessor &copro, rt::Video &video, const rt::VideoMem &mem) {
        vertices.clear(); batches.clear();
        const auto &polys = video.gpu_polys();
        order.resize(polys.size()); std::iota(order.begin(), order.end(), size_t(0));
        std::sort(order.begin(), order.end(), [&](size_t a, size_t b) {
            if (polys[a].window != polys[b].window) return polys[a].window > polys[b].window;
            if (polys[a].z != polys[b].z) return polys[a].z < polys[b].z;
            return a > b;
        });
        for (unsigned i = 0; i < xlat.size(); ++i) xlat[i] = gamma[word(mem.colorxlat, i) & 255];
        for (unsigned i = 0; i < luma.size(); ++i) luma[i] = copro.luma[i];
        // Preserve the existing scoped selection-water correction, without
        // changing palette RAM shared by the robots.
        const bool water = board.read_dword(0x5039f4) == 4 && board.read_dword(0x503a00) == 4;
        if (water) for (unsigned c = 0; c < 3; ++c) for (unsigned l = 0; l < 64; ++l) {
            const auto value = board.read_byte(0x2fb6fd0 + l*3 + c);
            xlat[c*0x2000 + 0x80 + l] = gamma[board.read_word(0x5775b0 + value*2) & 255];
        }
        model2_scene_coverage coverage;
        uint32_t count = 0, widened = 0, max_window = 0;
        for (auto index : order) {
            auto poly = polys[index];
            const uint32_t th0 = poly.texheader[0], th1 = poly.texheader[1], th2 = poly.texheader[2];
            const uint32_t renderer = (th0 >> 13) & 3;
            if (renderer == 1 || poly.num_vertices < 3 || poly.num_vertices > 8) continue;
            const int wide = poly.viewport[0] <= 0 && poly.viewport[2] >= 495 ? margin : 0;
            const int left = std::max(0, poly.viewport[0] + board.xoffset + margin - wide);
            const int right = std::min(495 + margin*2, poly.viewport[2] + board.xoffset + margin + wide);
            const int top = std::max(0, 384 - poly.viewport[3] + board.yoffset);
            const int bottom = std::min(383, 384 - poly.viewport[1] + board.yoffset);
            if (right < left || bottom < top) continue;
            bool finite = true;
            for (unsigned i = 0; i < poly.num_vertices; ++i) {
                auto &v = poly.v[i];
                const float z = v.p[0] + std::numeric_limits<float>::min();
                v.x = board.xoffset + poly.center[0] + v.x / z;
                v.y = 384 - poly.center[1] + board.yoffset - v.y / z;
                finite &= std::isfinite(v.x) && std::isfinite(v.y);
            }
            if (!finite) continue;
            Batch clip{uint32_t(vertices.size()), 0, uint32_t(left), uint32_t(top), uint32_t(right-left+1), uint32_t(bottom-top+1)};
            if (batches.empty() || std::memcmp(&batches.back().x, &clip.x, 16)) batches.push_back(clip);
            const uint32_t color = word(mem.palram, ((poly.texheader[3] >> 6) & 0x3ff) + 0x1000);
            const bool ocean = water && (th0 & 0x7fff) == 0x40d2 && th1 == 0 && th2 == 0x833
                && poly.texheader[3] == 0x8a00 && poly.luma == 255 && word(mem.palram, 0x1228) == 0xf7bd;
            const auto lum = poly.luma >> 2;
            const float r = xlat[((color & 31) << 8) + lum] / 255.0f;
            const float g = xlat[0x2000 + (((color >> 5) & 31) << 8) + lum] / 255.0f;
            const float b = xlat[0x4000 + (((color >> 10) & 31) << 8) + lum] / 255.0f;
            const float depth = float(++count) / 32770.0f;
            if (wide) ++widened;
            max_window = std::max(max_window, uint32_t(poly.window));
            if (margin && max_window <= 1) for (unsigned k = 1; k+1 < poly.num_vertices && !coverage.scene(); ++k)
                coverage.triangle(poly.v[0].x, poly.v[0].y, poly.v[k].x, poly.v[k].y, poly.v[k+1].x, poly.v[k+1].y);
            const uint32_t mirx = (th0 >> 8) & 1, miry = (th0 >> 9) & 1;
            const uint32_t wlog = th0 & 7, hlog = (th0 >> 3) & 7;
            const uint32_t flags = renderer | ((th0 >> 15) & 1) << 2 | (((th0 >> 6) & 1) & ~mirx) << 3 |
                (((th0 >> 7) & 1) & ~miry) << 4 | mirx << 5 | miry << 6 | ((th0 >> 12) & 1) << 7 |
                ((th0 >> 10) & 3) << 8 | ((th2 >> 12) & 1) << 10 | (4 + std::min(wlog, hlog)) << 12 | wlog << 17 | hlog << 20;
            Vertex v[8];
            for (unsigned k = 0; k < poly.num_vertices; ++k) {
                const auto &p = poly.v[k];
                const float ooz = 1 / (p.p[0] + std::numeric_limits<float>::min());
                v[k] = {p.x + margin, p.y, depth, ooz, p.p[1]*ooz/8, p.p[2]*ooz/8, r,g,b,1,
                    {flags, (32u*(th2 & 63)) | (32u*((th2 >> 6) & 31)) << 16,
                     (((th2 >> 13) & 1)*128) | (((th2 >> 14) & 3)*128) << 16,
                     ((th1 & 255) << 7) | uint32_t(poly.luma) << 16}, {uint32_t(poly.texlod), ocean ? 0x10000u : color & 0x7fff}};
            }
            for (unsigned k = 1; k+1 < poly.num_vertices; ++k) {
                vertices.push_back(v[0]); vertices.push_back(v[k]); vertices.push_back(v[k+1]);
            }
            batches.back().count = vertices.size() - batches.back().first;
        }
        auto ptr = [](const void *p) { return uint32_t(reinterpret_cast<uintptr_t>(p)); };
        track(0, video.background_layer().data(), video.background_layer().size());
        track(1, video.foreground_layer().data(), video.foreground_layer().size());
        track(2, luma.data(), luma.size()); track(3, xlat.data(), xlat.size());
        ++sequence;
        packet = {4,496,384,ptr(vertices.data()),uint32_t(vertices.size()),ptr(batches.data()),uint32_t(batches.size()),
            ptr(video.background_layer().data()),ptr(video.foreground_layer().data()),ptr(mem.tex0),ptr(mem.tex1),
            ptr(luma.data()),ptr(xlat.data()),sequence,count,uint32_t(mem.tex_generation),uint32_t(margin),widened,
            generations[0],generations[1],generations[2],generations[3],
            uint32_t(coverage.scene() && max_window <= 1),max_window};
    }
};
}
