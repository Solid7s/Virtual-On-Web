#!/usr/bin/env python3
"""Optimize inert SHARC interpreter work in the pinned browser core."""
import subprocess
from prepare_model2 import ROOT, MAME_COMMIT


def prepare_cpu(repo):
    def original(name):
        return subprocess.check_output(['git', '-C', str(repo), 'show', f'{MAME_COMMIT}:{name}'], text=True)

    def write(name, text):
        path = repo / name
        if not path.exists() or path.read_text() != text:
            path.write_text(text)

    def replace(old, new):
        nonlocal text
        if text.count(old) != 1:
            raise SystemExit(f'SHARC patch anchor changed: {old[:80]}')
        text = text.replace(old, new)

    name = 'src/devices/cpu/sharc/sharc.h'
    text = original(name)
    replace('\tvoid sharcop_direct_jump();', '''    // Host options and counters are diagnostics, not emulated state.
    bool m_web_fast = false;
    uint32_t m_web_wait_slices = 0, m_web_wait_pc = 0;
\tvoid sharcop_direct_jump();''')
    write(name, text)

    name = 'src/devices/cpu/sharc/sharc.cpp'
    text = original(name)
    replace('#include "sharc.h"', '''#include "sharc.h"
#include "sharc_wait_loop.h"
#if defined(__EMSCRIPTEN__)
#include <emscripten.h>
#endif''')
    replace('void adsp21062_device::device_start()\n{', '''void adsp21062_device::device_start()
{
#if defined(__EMSCRIPTEN__)
    m_web_fast = EM_ASM_INT({ return !Module['model2LegacySharc']; });
#endif''')
    replace('\tstate_add(SHARC_PC,', '''    state_add(1000, "WEBFAST", m_web_fast).noshow();
    state_add(1001, "WEBWAIT", m_web_wait_slices).noshow();
    state_add(1002, "WEBWAITPC", m_web_wait_pc).noshow();
\tstate_add(SHARC_PC,''')
    # This anchor is the arithmetic DO UNTIL case, before the counter loops.
    # A NOP body at both loop start and end is inert until an external FLAG
    # changes. Nested outer loops stay intact; no loop stack is popped here.
    replace('''\t\t\t\t\telse
\t\t\t\t\t{
\t\t\t\t\t\tCHANGE_PC(TOP_PC());
\t\t\t\t\t}

\t\t\t\t\tm_core->astat = m_core->astat_old;''', '''\t\t\t\t\telse
\t\t\t\t\t{
                        if (m_web_fast) {
                            const int skipped = model2_sharc_wait_cycles(*m_core, TOP_PC(), debugger_enabled());
                            if (skipped) {
                                m_core->icount -= skipped;
                                ++m_web_wait_slices;
                                m_web_wait_pc = m_core->pc;
                            }
                        }
\t\t\t\t\t\tCHANGE_PC(TOP_PC());
\t\t\t\t\t}

\t\t\t\t\tm_core->astat = m_core->astat_old;''')
    replace('''\t\t\tif (!m_core->write_stalled)
\t\t\t{
\t\t\t\tdma_run_cycle(6);''', '''            // The inactive handlers have no side effects. Keep the original
            // call order and cycle accounting whenever either DMA is active.
\t\t\tif (!m_core->write_stalled && (!m_web_fast || (m_core->dma_status & 0xc0)))
\t\t\t{
\t\t\t\tdma_run_cycle(6);''')
    write(name, text)

    name = 'src/devices/cpu/sharc/sharcops.hxx'
    write(name, original(name))
    write('src/devices/cpu/sharc/sharc_wait_loop.h', (ROOT / 'scripts/sharc_wait_loop.h').read_text())
    print('Prepared SHARC flag-wait batching and inactive DMA fast path.')


if __name__ == '__main__':
    prepare_cpu(ROOT / 'vendor/mame')
