#!/usr/bin/env python3
"""Generate a guarded i960 AOT prototype from local Virtual-On programs.

The original MAME instruction bodies remain the semantic source of truth.
Only their opcode operands are specialized. Fetches, cycle budgets, IRQ checks,
burst stalls, memory handlers and save-state layout retain their original paths.
Generated game-derived material belongs in ignored build/, never source control.
"""
import hashlib
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path
from prepare_model2 import ROOT, MAME_COMMIT

OUT = ROOT / 'build/v3-recompiler'
RECOMP_COMMIT = 'b33baeb28a1e1c94d90a4a80811f0b2c7f61106b'
PROFILES = {
    'vonu': ('epr-18828b.15', 'epr-18829b.16'),
    'vonj': ('epr-18664b.15', 'epr-18665b.16'),
}


def original(name):
    return subprocess.check_output(['git', '-C', str(ROOT / 'vendor/mame'),
                                   'show', f'{MAME_COMMIT}:{name}'], text=True)


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError(f'i960 patch anchor changed: {old[:80]}')
    return text.replace(old, new)


def prepare():
    OUT.mkdir(parents=True, exist_ok=True)
    recomp = ROOT / 'vendor/daytona-recompiler'
    actual = subprocess.check_output(['git', '-C', str(recomp), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != RECOMP_COMMIT:
        raise RuntimeError(f'Recompiler revision mismatch: {actual}')
    analyzer = OUT / 'i960-reach'
    subprocess.run(['clang++', '-std=c++20', '-O2', '-I' + str(recomp / 'src'),
        str(ROOT / 'scripts/i960_reach.cpp'),
        *[str(recomp / f'src/i960/{name}.cpp') for name in ('decode', 'reach', 'isa')],
        '-o', str(analyzer)], check=True)
    opcodes, metadata = set(), {}
    for name, pair in PROFILES.items():
        destination = OUT / name
        destination.mkdir(exist_ok=True)
        program = bytearray(0x200000)
        with zipfile.ZipFile(ROOT / f'roms/ready/{name}.zip') as archive:
            members = {Path(p).name.lower(): p for p in archive.namelist()}
            for i, chip in enumerate((*pair, 'epr-18666.13', 'epr-18667.14')):
                data = archive.read(members[chip])
                if len(data) != 0x80000:
                    raise RuntimeError(f'Unexpected chip length: {chip}')
                offset = (i // 2) * 0x100000 + (i % 2) * 2
                for byte in (0, 1):
                    program[offset+byte:offset+0x100000:4] = data[byte::2]
        binary = destination / 'program.bin'
        binary.write_bytes(program)
        args = [str(analyzer), str(binary)]
        seeds = destination / 'harvest-seeds.txt'
        if seeds.exists():
            args.append(str(seeds))
        result = subprocess.run(args, check=True, text=True, capture_output=True)
        (destination / 'reachable.txt').write_text(result.stdout)
        records = [tuple(int(value, 16) for value in line.split()) for line in result.stdout.splitlines()]
        opcodes.update(word for _, word in records)
        metadata[name] = {'programSha256': hashlib.sha256(program).hexdigest(),
                          'reachableInstructions': len(records), 'analysis': result.stderr.strip()}

    source_name = 'src/devices/cpu/i960/i960.cpp'
    source = original(source_name)
    body = source.split('void i960_cpu_device::execute_op(uint32_t opcode)\n{', 1)[1]
    body = body.split('\nvoid i960_cpu_device::execute_run()', 1)[0]
    cases = list(re.finditer(r'^\t\t(case (0x[0-9a-f]+):|default:)', body, re.M))
    selected = {word >> 24 for word in opcodes}
    generated = ['// Generated locally; do not commit. MAME BSD-3-Clause instruction semantics.',
        "// copyright-holders:Farfetch'd, R. Belmont", '#include <unordered_map>',
        'template<uint32_t opcode> void i960_cpu_device::aot_op() {',
        'uint32_t t1, t2; double t1f, t2f;']
    for case, following in zip(cases, cases[1:]):
        major = int(case.group(2), 16)
        if major not in selected:
            continue
        # Keep the complete major case (including nested switches and returns).
        code = body[case.end():following.start()]
        generated.append(f'if constexpr ((opcode >> 24) == {major}) {{ do {{\n{code}\n}} while (false); }}')
    generated.extend(['}', 'void i960_cpu_device::aot_init() {',
        'const std::unordered_map<uint32_t, aot_function> compiled = {'])
    for word in sorted(opcodes):
        generated.append(f'{{0x{word:08x}u, &aot_thunk<0x{word:08x}u>}},')
    generated.extend(['};', 'm_aot_rom.resize(0x80000);',
        'for (uint32_t index = 0; index < 0x80000; ++index) {',
        'const uint32_t word = m_cache.read_dword(index * 4);',
        'const auto found = compiled.find(word);',
        'if (found != compiled.end()) { m_aot_rom[index] = {word, found->second}; ++m_aot_entries; }',
        '}', '}'])
    generated_path = OUT / 'virtual_on_aot.ipp'
    generated_path.write_text('\n'.join(generated) + '\n')

    header_name = 'src/devices/cpu/i960/i960.h'
    header = original(header_name)
    header = replace_once(header, '\tvoid do_ret();', '''\tvoid do_ret();

    // Host-only AOT dispatch and diagnostics. Append to preserve existing ABI
    // member offsets, and deliberately exclude these caches from save states.
    using aot_function = void (*)(i960_cpu_device *);
    struct aot_entry { uint32_t word = 0; aot_function run = nullptr; };
    std::vector<aot_entry> m_aot_rom;
    bool m_aot_enabled = false;
    uint32_t m_aot_hits = 0, m_aot_fallback = 0, m_aot_guard_misses = 0, m_aot_entries = 0;
    template<uint32_t opcode> void aot_op();
    template<uint32_t opcode> static void aot_thunk(i960_cpu_device *cpu) { cpu->aot_op<opcode>(); }
    void aot_init();''')
    header = replace_once(header, '#pragma once', '#pragma once\n#include <vector>')
    source = replace_once(source, '#include "i960.h"', '#include "i960.h"\n#if defined(__EMSCRIPTEN__)\n#include <emscripten.h>\n#endif')
    source = replace_once(source, 'void i960_cpu_device::execute_run()',
                          '#include "virtual_on_aot.ipp"\n\nvoid i960_cpu_device::execute_run()')
    source = replace_once(source, '''\t\telse
\t\t\texecute_op(opcode);''', '''        else if (m_aot_enabled && m_PIP < 0x200000 && !(m_PIP & 3)) {
            const auto &entry = m_aot_rom[m_PIP >> 2];
            if (entry.run && entry.word == opcode) {
                ++m_aot_hits;
                entry.run(this);
            } else {
                ++m_aot_fallback;
                if (entry.run) ++m_aot_guard_misses;
                execute_op(opcode);
            }
        } else {
            ++m_aot_fallback;
            execute_op(opcode);
        }''')
    source = replace_once(source, '\tspace(AS_PROGRAM).specific(m_program);', '''\tspace(AS_PROGRAM).specific(m_program);
#if defined(__EMSCRIPTEN__)
    m_aot_enabled = EM_ASM_INT({ return Module['model2I960Aot'] === true; });
#endif
    m_aot_enabled = m_aot_enabled &&
        (!strcmp(machine().system().name, "vonu") || !strcmp(machine().system().name, "vonj"));
    if (m_aot_enabled) aot_init();
    state_add(1000, "AOTENABLED", m_aot_enabled).noshow();
    state_add(1001, "AOTHITS", m_aot_hits).noshow();
    state_add(1002, "AOTFALLBACK", m_aot_fallback).noshow();
    state_add(1003, "AOTGUARD", m_aot_guard_misses).noshow();
    state_add(1004, "AOTENTRIES", m_aot_entries).noshow();''')
    for name, content in [(header_name, header), (source_name, source)]:
        (ROOT / 'vendor/mame' / name).write_text(content)
    metadata.update({'mameCommit': MAME_COMMIT, 'recompilerCommit': RECOMP_COMMIT,
        'uniqueCompiledOpcodes': len(opcodes), 'defaultEnabled': False,
        'scope': 'Guarded main-i960 instruction specialization; interpreter fallback remains.'})
    (OUT / 'generation.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps(metadata, indent=2))


if __name__ == '__main__':
    if sys.argv[1:] == ['--restore']:
        for cpu in ('i960', 'm68000'):
            for suffix in ('cpp', 'h'):
                name = f'src/devices/cpu/{cpu}/{cpu}.{suffix}'
                (ROOT / 'vendor/mame' / name).write_text(original(name))
        print('Restored the pinned interpreter source for a standard build.')
    elif sys.argv[1:]:
        raise SystemExit('Usage: prepare_virtual_on_aot.py [--restore]')
    else:
        prepare()
