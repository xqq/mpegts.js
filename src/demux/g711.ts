/*
 * Licensed under the Apache License, Version 2.0.
 * See the repository LICENSE for the full license text.
 */

/* G.711 companding, using the ITU-T A-law and mu-law reconstruction rules. */

export type G711Codec = 7 | 8;

export function decodeG711Sample(value: number, codec: G711Codec): number {
    if (codec === 7) {
        const a = value ^ 0x55;
        const segment = (a & 0x70) >>> 4;
        const magnitude = segment === 0
            ? ((a & 0x0F) * 2 + 1) << 3
            : ((a & 0x0F) * 2 + 33) << (segment + 2);
        return a & 0x80 ? magnitude : -magnitude;
    }

    const u = (~value) & 0xFF;
    const magnitude = (((u & 0x0F) << 3) + 0x84) << ((u & 0x70) >>> 4);
    return u & 0x80 ? 0x84 - magnitude : magnitude - 0x84;
}
