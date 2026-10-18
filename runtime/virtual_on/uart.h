// SPDX-License-Identifier: BSD-3-Clause
// Model 2B's i8251 register protocol; derived from MAME i8251.cpp (smf,
// Robbbert). Time is expressed in 25 MHz board ticks.
#pragma once
#include "board.h"
namespace von {
class Uart {
public:
    explicit Uart(Board &board) : board_(board) {}
    std::function<void(uint8_t)> transmit;
    uint64_t bytes_sent = 0;
    uint64_t next_event() const { return due_; }
    void advance(uint64_t now) {
        while (due_ <= now) {
            const auto at = due_;
            due_ = UINT64_MAX;
            ++bytes_sent;
            if (transmit) transmit(shift_);
            if (!(status_ & 1) && (command_ & 1)) start(at);
            else status_ |= 4;
            update();
        }
    }
    uint8_t read(bool control) {
        advance(board_.now());
        if (control) return status_;
        status_ &= ~2; update(); return receive_;
    }
    void receive(uint8_t byte) {
        if (!(command_ & 4)) return;
        if (status_ & 2) status_ |= 0x10;
        receive_ = byte; status_ |= 2; update();
    }
    void write(bool control, uint8_t value) {
        advance(board_.now());
        if (!control) {
            hold_ = value; status_ &= ~1;
            if (due_ == UINT64_MAX && (command_ & 1)) start(board_.now());
        } else if (next_ == 0) {
            mode_ = value;
            next_ = (value & 3) ? 3 : (value & 0x80) ? 2 : 1;
        } else if (next_ < 3) ++next_;
        else {
            command_ = value;
            if (value & 0x10) status_ &= ~0x38;
            if (value & 0x40) next_ = 0;
            if ((command_ & 1) && !(status_ & 1) && due_ == UINT64_MAX) start(board_.now());
        }
        update();
    }
private:
    Board &board_;
    uint8_t status_ = 5, mode_ = 0, command_ = 0, next_ = 0, hold_ = 0, shift_ = 0, receive_ = 0;
    uint64_t due_ = UINT64_MAX;
    void update() { board_.sound_ready((status_ & 2) || ((command_ & 1) && (status_ & 1))); }
    void start(uint64_t now) {
        if (!(mode_ & 3)) throw std::runtime_error("Synchronous sound UART transmission is unsupported");
        const unsigned factor = (mode_ & 3) == 2 ? 16 : (mode_ & 3) == 3 ? 64 : 1;
        const unsigned stop_halves = (mode_ >> 6) == 1 ? 2 : (mode_ >> 6) == 2 ? 3 : (mode_ >> 6) == 3 ? 4 : 0;
        const unsigned halves = 2 * (1 + 5 + ((mode_ >> 2) & 3) + !!(mode_ & 0x10)) + stop_halves;
        shift_ = hold_; status_ = (status_ | 1) & ~4;
        due_ = now + 25 * factor * halves; // 500 kHz serial clock.
    }
};
}
