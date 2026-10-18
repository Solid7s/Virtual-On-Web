// SPDX-License-Identifier: BSD-3-Clause
// Byte-addressed, little-endian bus for the standalone Virtual-On runtime.
#pragma once
#include <bit>
#include <cstdint>
#include <cstdio>
#include <stdexcept>
#include <type_traits>
#include <utility>

namespace von {
using u8 = uint8_t; using u16 = uint16_t; using u32 = uint32_t; using u64 = uint64_t;
using s8 = int8_t; using s16 = int16_t; using s32 = int32_t; using s64 = int64_t;
template<class T, class U> constexpr T BIT(T x, U n) { return (x >> n) & T(1); }
template<class T> constexpr std::make_signed_t<T> sext(T x, unsigned bits) {
    using S = std::make_signed_t<T>;
    const unsigned shift = sizeof(T) * 8 - bits;
    return S(x << shift) >> shift;
}
inline float u2f(uint32_t x) { return std::bit_cast<float>(x); }
inline double u2d(uint64_t x) { return std::bit_cast<double>(x); }
inline uint32_t f2u(float x) { return std::bit_cast<uint32_t>(x); }
inline uint64_t d2u(double x) { return std::bit_cast<uint64_t>(x); }
constexpr uint64_t mulu_32x32(uint32_t a, uint32_t b) { return uint64_t(a) * b; }
template<class... Args> [[noreturn]] void fatalerror(const char *format, Args... args) {
    char text[512];
    if constexpr (sizeof...(args)) std::snprintf(text, sizeof(text), format, args...);
    else std::snprintf(text, sizeof(text), "%s", format);
    throw std::runtime_error(text);
}
inline void logerror(const char *, ...) {}
inline void osd_printf_debug(const char *, ...) {}
enum { I960_PFP = 0, I960_SP = 1, I960_RIP = 2, I960_FP = 31 };
enum { I960_IRQ0 = 0, I960_IRQ1 = 1, I960_IRQ2 = 2, I960_IRQ3 = 3 };

class Bus {
public:
    virtual ~Bus() = default;
    virtual uint8_t read_byte(uint32_t address) = 0;
    virtual uint16_t read_word(uint32_t address) = 0;
    virtual uint32_t read_dword(uint32_t address) = 0;
    virtual void write_byte(uint32_t address, uint8_t value) = 0;
    virtual void write_word(uint32_t address, uint16_t value) = 0;
    virtual void write_dword(uint32_t address, uint32_t value) = 0;
    virtual uint16_t flags(uint32_t address) const = 0;
    std::pair<uint32_t, uint16_t> read_dword_flags(uint32_t a) { return {read_dword(a), flags(a)}; }
    std::pair<uint8_t, uint16_t> read_byte_flags(uint32_t a) { return {read_byte(a), flags(a)}; }
    uint16_t write_dword_flags(uint32_t a, uint32_t v) { write_dword(a, v); return flags(a); }
    uint16_t write_byte_flags(uint32_t a, uint8_t v) { write_byte(a, v); return flags(a); }
};
} // namespace von
