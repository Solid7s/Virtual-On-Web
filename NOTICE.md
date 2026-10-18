# Virtual-On-Web: copyright and distribution notice

Virtual-On-Web is an independent, unofficial community project. It is not
affiliated with, sponsored by, or endorsed by SEGA. No endorsement by the
authors of reused software is implied.

## Original game

© SEGA. Characters © SEGA/AUTOMUSS. Character design: Hajime Katoki.

Credits follow [SEGA's original arcade game page](https://www.sega.jp/history/arcade/product/9046/).
SEGA and Virtual-On names, trademarks, logos, game programs, artwork, music,
and ROM data remain the property of their respective rights holders.

The header logo was supplied by the project owner. No separate permission to
redistribute that artwork is documented in this repository. Attribution and
this notice do not grant permission or provide legal clearance.

## What this release contains

The repository and website include the frontend, software notices, build
metadata, and a precompiled JavaScript/WebAssembly player. The repository also
includes runtime sources, offline translation tools, tests, and address-only
discovery seeds.

The WebAssembly player contains ahead-of-time translated instructions derived
from Virtual-On's game programs. It is not an asset-free or game-code-free
binary. The player still requires the user to select supported ROM archives
locally to supply the game's data. ROM archives, extracted graphics/audio ROM
files, full execution traces, profiling captures, and local machine paths are
not included in the release.

Requiring a ROM at launch does not establish permission to distribute translated
game code or the logo. This notice does not assert that this distribution is
authorized by SEGA or covered by a legal exception.

## Software licenses

The BSD-3-Clause notice in [LICENSE](LICENSE) preserves the upstream copyright:
Copyright (c) 2026, Ben Templeman and contributors. It applies to software under
that license, not to all material in the distribution.

Adapted MAME sources and other third-party code retain their own notices and
terms. See [THIRD_PARTY.md](THIRD_PARTY.md), the
[runtime attribution](runtime/virtual_on/THIRD_PARTY.md), and `licenses/`.
Keep applicable copyright notices, conditions, and disclaimers with source and
binary redistributions. These software licenses do not relicense SEGA material.
