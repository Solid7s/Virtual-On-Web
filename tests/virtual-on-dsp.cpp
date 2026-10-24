// Differential SCSP DSP decoding: compare architectural state and sound RAM
// with the pinned interpreter, including live program/coeff/address writes.
#include "sound_dsp.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
using namespace von;
static uint32_t rng = 0x6d2b79f5;
static uint32_t random_word() { rng ^= rng << 13; rng ^= rng >> 17; return rng ^= rng << 5; }
template<class T> static void equal(const T &a, const T &b, const char *name) {
    if (std::memcmp(&a, &b, sizeof(T))) { std::fprintf(stderr, "DSP mismatch: %s\n", name); std::abort(); }
}
int main() {
    unsigned samples = 0, mutations = 0;
    for (unsigned program = 0; program < 160; ++program) {
        SCSPDSP reference, cached; SoundRam a, b;
        reference.Init(); reference.space = &a;
        reference.RBP = random_word() & 63; reference.RBL = 8192u << (program % 4);
        reference.DEC = random_word();
        for (auto &v : reference.COEF) v = random_word();
        for (auto &v : reference.MADRS) v = random_word();
        for (auto &v : reference.TEMP) v = sext(random_word(), 24);
        for (auto &v : reference.MEMS) v = sext(random_word(), 24);
        for (auto &v : a.bytes) v = random_word();
        const unsigned length = program ? 1 + program % 128 : 0;
        for (unsigned n = 0; n < length * 4; ++n) reference.WriteProgram(n, random_word());
        // Valid input selectors exercise full programs; some fixtures also
        // deliberately retain invalid selectors to check early return behavior.
        if (program % 4) for (unsigned n = 0; n < length; ++n)
            reference.WriteProgram(n * 4 + 1, (reference.MPRO[n * 4 + 1] & ~0xfc0u) | ((random_word() % 50) << 6));
        reference.Start(); cached = reference; b.bytes = a.bytes; cached.space = &b;
        for (unsigned frame = 0; frame < 96; ++frame) {
            if (frame % 19 == 18) {
                // Grow the active program after an earlier decode, including
                // writes whose instruction was outside the old LastStep.
                const unsigned word = 504 + frame % 8; const u16 value = random_word();
                reference.WriteProgram(word, value); cached.WriteProgram(word, value); ++mutations;
                reference.Start(); cached.Start();
            }
            if (frame % 7 == 0 && length) {
                const unsigned word = random_word() % (length * 4); const u16 value = random_word();
                reference.WriteProgram(word, value); cached.WriteProgram(word, value); ++mutations;
            }
            if (frame % 5 == 0) {
                const unsigned i = random_word() % 64; reference.COEF[i] = cached.COEF[i] = random_word();
                reference.MADRS[i % 32] = cached.MADRS[i % 32] = random_word();
            }
            for (unsigned n = 0; n < 16; ++n) reference.MIXS[n] = cached.MIXS[n] = sext(random_word(), 20);
            for (unsigned n = 0; n < 2; ++n) reference.EXTS[n] = cached.EXTS[n] = random_word();
            reference.Stopped = cached.Stopped = frame % 17 == 0;
            reference.StepReference(); cached.Step(); ++samples;
#define CHECK(field) equal(reference.field, cached.field, #field)
            CHECK(RBP); CHECK(RBL); CHECK(COEF); CHECK(MADRS); CHECK(MPRO);
            CHECK(TEMP); CHECK(MEMS); CHECK(DEC); CHECK(MIXS); CHECK(EXTS);
            CHECK(EFREG); CHECK(Stopped); CHECK(LastStep);
#undef CHECK
            if (a.bytes != b.bytes) { std::fprintf(stderr, "DSP sound RAM mismatch\n"); return 1; }
        }
        if (length && !cached.decoded_instructions) return 2;
    }
    std::printf("{\"matchedSamples\":%u,\"liveProgramWrites\":%u,\"programs\":160}\n", samples, mutations);
}
