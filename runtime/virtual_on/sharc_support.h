// SPDX-License-Identifier: BSD-3-Clause
#pragma once
#include "bus.h"
#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstring>
#include <functional>
#include <limits>
#include <memory>
#include <vector>
namespace von {
constexpr int64_t mul_32x32(int32_t a, int32_t b) { return int64_t(a) * b; }
constexpr int32_t mul_32x32_shift(int32_t a, int32_t b, unsigned shift) { return int32_t(mul_32x32(a, b) >> shift); }
template<class T> constexpr T make_bitmask(unsigned bits) {
    return bits >= sizeof(T)*8 ? T(~T(0)) : T((uint64_t(1) << bits) - 1);
}
template<class T, class U> constexpr T BIT(T x, U n, unsigned bits) { return (x >> n) & make_bitmask<T>(bits); }
}
