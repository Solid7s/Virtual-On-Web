// SPDX-License-Identifier: BSD-3-Clause
#pragma once
#include "bus.h"
#include <array>
#include <vector>
#include <functional>
#include <algorithm>
#include <cstring>
#include <cmath>
namespace von {
constexpr int INPUT_LINE_NMI = 32, ASSERT_LINE = 1, CLEAR_LINE = 0, HOLD_LINE = 2;
struct NullCallback {
    bool isnull() const { return true; }
    template<class... Args> void operator()(Args...) const {}
};
class SoundBus {
public:
    virtual ~SoundBus() = default;
    virtual uint16_t read(uint32_t address, uint16_t mask, int &cycles) = 0;
    virtual void write(uint32_t address, uint16_t value, uint16_t mask, int &cycles) = 0;
};
inline void popmessage(const char *, ...) {}
struct SoundRam {
    std::vector<uint8_t> bytes = std::vector<uint8_t>(0x80000);
    uint8_t read_byte(uint32_t a) const { return bytes[a & 0x7ffff]; }
    uint16_t read_word(uint32_t a) const { return uint16_t(read_byte(a)) << 8 | read_byte(a+1); }
    void write_word(uint32_t a, uint16_t value) { bytes[a & 0x7ffff] = value >> 8; bytes[(a+1) & 0x7ffff] = value; }
};
struct SoundIrq {
    std::function<void(unsigned,int)> callback;
    bool isunset() const { return !callback; }
    void operator()(unsigned line, int value) { if (callback) callback(line,value); }
};
struct SoundTimer {
    uint64_t &now;
    uint64_t &next_event;
    uint64_t due = UINT64_MAX;
    void adjust(uint64_t ticks) { due = now + ticks; next_event = std::min(next_event, due); }
};
struct SoundStream {
    float output[2]{};
    int samples() const { return 1; }
    float get(int, int) const { return 0; }
    void put_int_clamp(unsigned channel, int, int32_t value, int32_t scale) {
        output[channel] = std::clamp(float(value) / scale, -1.0f, 1.0f);
    }
};
}
