#!/usr/bin/env python3
"""Generate bounded, register-only i960 blocks from validated local ROM words.

No loads, stores, branches, floating point, faulting operations or changes to
interrupt priority are batched. The runtime must keep each block strictly before
the earliest device deadline. Other instructions retain the existing AOT path.
"""


def register_ticks(word):
    major, minor = word >> 24, (word >> 7) & 15
    # Reject literal destinations, including encodings that do not use dst.
    if word & 0x2000:
        return 0
    if 0x20 <= major <= 0x27:  # test condition -> register
        return 1
    if major == 0x58 and minor in (0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15):
        return 2 if minor in (0, 3, 12, 14, 15) else 1
    if major == 0x59 and minor in (0, 1, 2, 3, 8, 10, 11, 12, 13, 14):
        return 1
    if major == 0x5a and minor in (0, 1, 2, 3, 4, 5, 6, 7, 12, 14):
        return 1 if minor < 4 else 2
    if major == 0x5b and minor in (0, 2):
        return 2
    if major == 0x5c and minor == 12:
        return 2
    return 0


def generate_blocks(profiles, write):
    groups, regions = {}, {}
    for game, records in profiles.items():
        eligible = {pc: next(iter(words)) for pc, words in records.items()
                    if pc < 0x200000 and not (pc & 3) and len(words) == 1
                    and register_ticks(next(iter(words)))}
        entries = []
        # Every eligible entry gets its own suffix, so indirect entry into a run
        # needs no assumption about which branch targets discovery has seen.
        for pc in sorted(eligible):
            words = []
            for offset in range(8):
                if pc + offset * 4 not in eligible:
                    break
                words.append(eligible[pc + offset * 4])
            if len(words) < 2:
                continue
            identity = tuple(words)
            if identity not in groups:
                groups[identity] = len(groups)
            entries.append((pc, groups[identity]))
        regions[game] = entries
    declarations = ['#pragma once', '#include "i960.h"', 'namespace von {',
                    'extern const I960::Block compiled_blocks[];']
    chunks = []
    items = list(groups.items())
    for start in range(0, len(items), 256):
        name = f'blocks_{start // 256:03}.cpp'
        text = ['#include "i960_semantics.h"', 'namespace von {']
        for words, index in items[start:start + 256]:
            declarations.append(f'void block_{index}(I960 &);')
            text += [f'void block_{index}(I960 &c) {{', 'c.m_icount = 0;']
            text += [f'c.compiled_op<0x{word:08x}u>();' for word in words]
            text += [f'c.m_icount = -{register_ticks(words[-1])};', '}']
        text.append('}')
        write(name, '\n'.join(text) + '\n')
        chunks.append(name)
    declarations.append('}')
    write('block_handlers.h', '\n'.join(declarations) + '\n')
    tables = ['#include "block_handlers.h"', 'namespace von {',
              'const I960::Block compiled_blocks[] = {']
    for words, index in items:
        tables.append(f'{{block_{index}, {sum(map(register_ticks, words))}, {len(words)}}},')
    tables += ['};', '}']
    write('block_tables.cpp', '\n'.join(tables) + '\n')
    return ({'kind': 'register-only-before-device-deadline', 'maximumInstructions': 8,
            'uniqueBlocks': len(groups), 'entries': {g: len(e) for g, e in regions.items()},
            'sources': ['block_tables.cpp', *chunks]}, {g: dict(e) for g, e in regions.items()})
