// SPDX-License-Identifier: BSD-3-Clause
// System 24 tile rules from Daytona's pinned runtime/video.cpp and MAME
// segaic24.cpp (Olivier Galibert, R. Belmont, ElSemi, Angelo Salese).
// Decode the original character RAM and compose native-resolution layers.
// The existing presentation passes handle scaling and widescreen afterwards.
@group(0) @binding(0) var<storage, read> tiles: array<u32>;
@group(0) @binding(1) var<storage, read> characters: array<u32>;
@group(0) @binding(2) var<storage, read> pens: array<u32>;
@group(0) @binding(3) var background: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(4) var foreground: texture_storage_2d<rgba8unorm, write>;

fn tile(index: u32) -> u32 {
    return (tiles[index >> 1u] >> ((index & 1u) * 16u)) & 65535u;
}

fn layer_pixel(layer: u32, category: u32, at: vec2u) -> u32 {
    var hscroll = tile(0x5000u + layer);
    let vscroll = tile(0x5004u + layer);
    if ((vscroll & 0x8000u) != 0u) { return 0u; }
    let mode = (tile(0x5004u + (layer & 2u)) >> 13u) & 3u;
    var source_layer = layer;
    let opaque = category == 0u && layer >= 2u;
    if ((hscroll & 0x8000u) != 0u) {
        hscroll = tile(0x4000u + 0x200u * layer + at.y);
    }
    if (mode != 0u) {
        if ((layer & 1u) != 0u) { return 0u; }
        if (mode == 1u) {
            let split = 0u - vscroll;
            source_layer ^= select(0u, 1u, (split & 0x200u) == 0u);
            source_layer ^= select(0u, 1u, at.y >= (split & 511u));
        } else {
            source_layer ^= select(0u, 1u, (hscroll & 0x200u) == 0u);
            source_layer ^= select(0u, 1u, at.x >= (hscroll & 511u));
        }
    } else {
        let mask_base = select(0x6000u, 0x6800u, layer >= 2u);
        var mask = tile(mask_base + at.y * 4u + (at.x >> 7u));
        if ((layer & 1u) != 0u) { mask = ~mask; }
        if ((mask & (0x8000u >> ((at.x & 127u) >> 3u))) != 0u) { return 0u; }
    }
    let source = vec2u(at.x - (hscroll & 511u), at.y + vscroll) & vec2u(511u);
    let value = tile(source_layer * 4096u + (source.y >> 3u) * 64u + (source.x >> 3u));
    let address = ((value & 0x3fffu) * 32u + (source.y & 7u) * 4u + ((source.x & 7u) >> 1u)) ^ 1u;
    let byte = (characters[address >> 2u] >> ((address & 3u) * 8u)) & 255u;
    let pixel = (byte >> select(4u, 0u, (source.x & 1u) != 0u)) & 15u;
    // Normal opaque passes ignore category; split-window opaque passes
    // still select category zero, exactly like tilemap_draw in the CPU path.
    if ((!opaque || mode != 0u) && (value >> 15u) != category) { return 0u; }
    if (!opaque && pixel == 0u) { return 0u; }
    return pens[((value >> 7u) & 255u) * 16u + pixel];
}

@compute @workgroup_size(8, 8)
fn compose(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= 496u || id.y >= 384u) { return; }
    var back = pens[0];
    var front = 0u;
    for (var layer = 3; layer >= 0; layer--) {
        let b = layer_pixel(u32(layer), 0u, id.xy);
        let f = layer_pixel(u32(layer), 1u, id.xy);
        if (b != 0u) { back = b; }
        if (f != 0u) { front = f; }
    }
    // Preserve the CPU layer byte layout (BGRA) used by layerShader.
    textureStore(background, vec2i(id.xy), unpack4x8unorm(back));
    textureStore(foreground, vec2i(id.xy), unpack4x8unorm(front));
}
