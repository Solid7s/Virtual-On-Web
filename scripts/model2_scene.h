// SPDX-License-Identifier: BSD-3-Clause
// Daytona-style 8-pixel coverage estimate, bounded at the scene threshold.
#pragma once
#include <algorithm>
#include <array>
#include <cmath>

struct model2_scene_coverage {
    static constexpr int columns = 62, rows = 48;
    static constexpr int threshold = (columns * rows * 15 + 99) / 100;
    std::array<unsigned char, columns * rows> cells{};
    int covered = 0;
    void reset() { cells.fill(0); covered = 0; }
    bool scene() const { return covered >= threshold; }
    void triangle(float ax, float ay, float bx, float by, float cx, float cy) {
        if (scene()) return;
        const float area = (bx-ax)*(cy-ay) - (by-ay)*(cx-ax);
        if (!(std::abs(area) > 0) || !std::isfinite(area)) return;
        // Clamp floats before integer conversion, including offscreen geometry.
        const int x0 = int(std::clamp(std::floor(std::min({ax,bx,cx}) / 8), 0.0f, float(columns)));
        const int x1 = int(std::clamp(std::floor(std::max({ax,bx,cx}) / 8), -1.0f, float(columns-1)));
        const int y0 = int(std::clamp(std::floor(std::min({ay,by,cy}) / 8), 0.0f, float(rows)));
        const int y1 = int(std::clamp(std::floor(std::max({ay,by,cy}) / 8), -1.0f, float(rows-1)));
        for (int y = y0; y <= y1; ++y) for (int x = x0; x <= x1; ++x) {
            auto &cell = cells[y * columns + x];
            if (cell) continue;
            const float qx = x * 8 + 4, qy = y * 8 + 4;
            const float a = (bx-ax)*(qy-ay) - (by-ay)*(qx-ax);
            const float b = (cx-bx)*(qy-by) - (cy-by)*(qx-bx);
            const float c = (ax-cx)*(qy-cy) - (ay-cy)*(qx-cx);
            if ((a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0)) {
                cell = 1;
                if (++covered >= threshold) return;
            }
        }
    }
};
