#!/usr/bin/env python3
"""Generate the catalog and apply the small browser-host build patch to pinned MAME."""
import argparse
import csv
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAME_COMMIT = 'f9b2a9da4e937468fdd9099e8316e6ad40659f86'
BOARDS = {'model2o': 'Model 2', 'model2a': 'Model 2A',
          'model2b': 'Model 2B', 'model2c': 'Model 2C'}
MPEG_DECODE = '_ZN10mpeg_audio13decode_bufferERiiPsS0_S0_S0_i'


def enable_mpeg_exceptions(text):
    # The decoder deliberately throws/catches limit_hit at an incomplete MPEG
    # frame. Removing its catches turns a normal audio boundary into a crash.
    lines = text.splitlines(keepends=True)
    indices = [i for i, line in enumerate(lines) if 'EXCEPTION_CATCHING_ALLOWED=' in line]
    if len(indices) != 2:
        raise ValueError('MAME compile/link exception allowlists changed; review the MPEG patch')
    for i in indices:
        if MPEG_DECODE not in lines[i]:
            if lines[i].count("['_ZN15running_machine17start_all_devicesEv'") != 1:
                raise ValueError('Unrecognized MAME exception allowlist')
            lines[i] = lines[i].replace("['_ZN15running_machine17start_all_devicesEv'",
                                        f"['{MPEG_DECODE}','_ZN15running_machine17start_all_devicesEv'", 1)
    return ''.join(lines)


def catalog(source):
    games = []
    for line in source.splitlines():
        match = re.match(r'^GAMEL?\(\s*(.*?)\)\s*(?://.*)?$', line)
        if not match:
            continue
        fields = next(csv.reader([match[1]], skipinitialspace=True))
        fields = [value.strip() for value in fields]
        year, name, parent, machine, controls, state, init, rotation, maker, title, flags = fields[:11]
        board = next((value for prefix, value in BOARDS.items() if state.startswith(prefix)), None)
        if not board or not re.fullmatch(r'[a-z0-9_]+', name):
            raise ValueError(f'Unrecognized Model 2 driver: {line}')
        games.append(dict(id=name, title=title, year=year, parent=None if parent == '0' else parent,
                          board=board, manufacturer=maker, inputs=controls,
                          upstreamWorking='MACHINE_NOT_WORKING' not in flags,
                          upstreamFlags=flags))
    if len(games) < 80 or len({g['id'] for g in games}) != len(games):
        raise ValueError('Incomplete or duplicate Model 2 driver catalog')
    return sorted(games, key=lambda game: (game['title'], game['id']))


def prepare(repo):
    actual = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != MAME_COMMIT:
        raise SystemExit(f'Expected MAME {MAME_COMMIT}; found {actual}. Review a new pin before building.')
    source = (repo / 'src/mame/sega/model2.cpp').read_text()
    games = catalog(source)
    out = ROOT / 'web/model2/catalog.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(dict(source=f'https://github.com/mamedev/mame/blob/{actual}/src/mame/sega/model2.cpp',
                                   commit=actual, games=games), indent=2) + '\n')
    build = repo / 'scripts/genie.lua'
    text = build.read_text()
    old = '"-s EXPORTED_RUNTIME_METHODS=\\"[\'cwrap\']\\"",'
    new = ('"-s EXPORTED_RUNTIME_METHODS=\\"[\'cwrap\',\'FS\',\'IDBFS\',\'callMain\']\\"",\n'
           '\t\t"-lidbfs.js", -- MODEL2_WEB_HOST')
    text = text.replace('// MODEL2_WEB_HOST', '-- MODEL2_WEB_HOST')
    if '-- MODEL2_WEB_TAGS' not in text:
        old_tags = '\t\t"-std=c++20",\n\t\t"-s EXCEPTION_CATCHING_ALLOWED='
        new_tags = '\t\t"-std=c++20",\n\t\t"-Wno-mismatched-tags", -- MODEL2_WEB_TAGS\n\t\t"-s EXCEPTION_CATCHING_ALLOWED='
        if text.count(old_tags) != 1:
            raise SystemExit('MAME browser compiler flags changed; patch needs review')
        text = text.replace(old_tags, new_tags)
    if '-- MODEL2_WEB_HOST' not in text:
        if text.count(old) != 1:
            raise SystemExit('MAME runtime exports changed; patch needs review')
        text = text.replace(old, new)
    if '-- MODEL2_WEB_MEMORY' not in text:
        text = text.replace('\t\t"-lidbfs.js", -- MODEL2_WEB_HOST',
                            '\t\t"-lidbfs.js", -- MODEL2_WEB_HOST\n'
                            '\t\t"-s GROWABLE_ARRAYBUFFERS=0", -- MODEL2_WEB_MEMORY')
    text = enable_mpeg_exceptions(text)
    build.write_text(text)
    # Upstream cancels its browser loop without running native shutdown code.
    # Explicitly flush emulated NVRAM/config before the host syncs IndexedDB.
    machine = repo / 'src/emu/machine.cpp'
    text = machine.read_text()
    old = '\t\temscripten_cancel_main_loop();'
    new = '''\t\temscripten_cancel_main_loop();
        // MODEL2_WEB_STOP: persist hardware state before discarding the iframe.
        if (machine->options().nvram_save()) machine->nvram_save();
        machine->m_configuration->save_settings();
        EM_ASM({ if (Module['model2OnStopped']) Module['model2OnStopped'](); });'''
    if '// MODEL2_WEB_STOP' not in text:
        if text.count(old) != 1:
            raise SystemExit('MAME browser exit hook changed; patch needs review')
        text = text.replace(old, new)
    if '// MODEL2_WEB_STATS' not in text:
        old = '\t// cancel the emscripten loop if the system has been told to exit'
        new = '''    // MODEL2_WEB_STATS: emulated time and real speed, not display refresh rate.
    EM_ASM({ Module['model2Stats'] = ({seconds: $0, speed: $1}); },
        machine->time().as_double(), machine->video().speed_percent());
''' + old
        if text.count(old) != 1:
            raise SystemExit('MAME browser frame hook changed; patch needs review')
        text = text.replace(old, new)
    if '// MODEL2_WEB_INPUT_POLL' not in text:
        old = '\trunning_machine *machine = emscripten_running_machine;\n'
        new = old + '''    // MODEL2_WEB_INPUT_POLL: sample controls before emulating each frame.
    EM_ASM({ if (Module['model2PollInput']) Module['model2PollInput'](); });
'''
        if text.count(old) != 1:
            raise SystemExit('MAME browser input hook changed; patch needs review')
        text = text.replace(old, new)
    marker = '// MODEL2_WEB_INPUT_BRIDGE:'
    if marker in text:
        text = text[:text.index(marker)]
    text = text.rstrip() + '\n\n' + (ROOT / 'scripts/model2_input_bridge.cpp').read_text()
    machine.write_text(text)
    # Keep browser pointer input absolute (lightguns/menu) and leave pointer
    # ownership to the page; auto-capture requests from the emulation loop are
    # not trusted user gestures and can reject after an iframe is detached.
    window = repo / 'src/osd/sdl3/window.cpp'
    text = window.read_text()
    if '// MODEL2_WEB_POINTER' not in text:
        old = 'void sdl_window_info::capture_pointer()\n{'
        new = old + '''
#if defined(__EMSCRIPTEN__) // MODEL2_WEB_POINTER
    return;
#endif'''
        if text.count(old) != 1:
            raise SystemExit('MAME SDL3 pointer hook changed; patch needs review')
        window.write_text(text.replace(old, new))
    # WebAssembly has no host floating-point rounding environment. MAME's
    # portable DRC backend must not request a Clang pragma unsupported by Wasm.
    drc = repo / 'src/devices/cpu/drcbec.cpp'
    text = drc.read_text()
    if '// MODEL2_WEB_FENV' not in text:
        old = '#pragma STDC FENV_ACCESS ON'
        if text.count(old) != 1:
            raise SystemExit('MAME FENV pragma changed; patch needs review')
        text = text.replace(old, '#ifndef __EMSCRIPTEN__ // MODEL2_WEB_FENV\n' + old + '\n#endif')
        drc.write_text(text)
    # Virtual-On polls the communication board heartbeat before it reaches
    # the NOLINK cabinet setting. Native MAME opens loopback TCP sockets even
    # with no peer; Emscripten's file layer cannot open these socket paths.
    # Provide the same board-alive signal, retaining "no established link"
    # shared status. Do not invent peers or claim multiplayer connectivity.
    comm = repo / 'src/mame/sega/m2comm.cpp'
    text = subprocess.check_output(['git', '-C', str(repo), 'show',
                                    f'{MAME_COMMIT}:src/mame/sega/m2comm.cpp'], text=True)
    text = text.replace('#include "emu.h"', '#include "emu.h"\n#if defined(__EMSCRIPTEN__)\n#include <emscripten.h>\n#endif')
    old = 'void m2comm_device::comm_tick()\n{'
    new = old + '''
#if defined(__EMSCRIPTEN__) // MODEL2_WEB_STANDALONE_COMM
    if (EM_ASM_INT({ return !!Module['model2StandaloneComm']; }))
    {
        if (m_linkenable == 0x01 && m_linkalive == 0x00)
        {
            m_shared[0] = 0x00;
            m_shared[2] = 0xff;
            m_shared[3] = 0xff;
            m_zfg ^= 0x01;
        }
        return;
    }
#endif'''
    if text.count(old) != 1:
        raise SystemExit('MAME communication-board hook changed; patch needs review')
    updated = text.replace(old, new)
    if comm.read_text() != updated:
        comm.write_text(updated)
    print(f'Prepared {len(games)} Model 2 sets from MAME {actual}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mame', nargs='?', type=Path, default=ROOT / 'vendor/mame')
    prepare(parser.parse_args().mame.resolve())
