#!/usr/bin/env python3
"""Extract the watch fonts MonthGrid draws with into monthgrid-fonts.js.

Reads the firmware's compiled PBF v3 fonts (the format is documented at the
top of PebbleOS/tools/font/fontgen.py), keeps only the glyphs the face can
draw, and writes them as a classic-script / CommonJS file that
monthgrid-face.js picks up.

Sources:
  - PebbleOS/resources/{common,normal}/base/pbf/*.pbf (emery uses base/; the
    obelix and qemu_emery maps add no fonts of their own)
  - ROBOTO_BOLD_SUBSET_49 is built from a TTF, so it is read out of the
    firmware build's pickled .reso (needs the PebbleOS venv on sys.path)
  - Silkscreen (MonthGrid's own resource) out of build/emery/app_resources.pbpack

Run from anywhere:
  /Users/roger/Repos/pebble/PebbleOS/.venv/bin/python tools/extract_fonts.py
"""

import base64
import json
import os
import pickle
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PREVIEW = os.path.dirname(HERE)
APP = os.path.abspath(os.path.join(PREVIEW, '..', '..'))
PEBBLEOS = os.path.abspath(os.path.join(APP, '..', '..', 'PebbleOS'))
OUT = os.path.join(PREVIEW, '..', '..', 'src', 'settings', 'monthgrid-fonts.js')

WILDCARD = 0x25AF
ELLIPSIS = 0x2026

ASCII = [c for c in range(0x20, 0x7F)]
LATIN1 = [c for c in range(0xA0, 0x100)]
PUNCT = [0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, ELLIPSIS]
TEXT = ASCII + LATIN1 + PUNCT + [WILDCARD]
DIGITS = [ord(c) for c in '0123456789:'] + [WILDCARD]


def pbf_path(name):
    for sub in ('normal/base/pbf', 'common/base/pbf'):
        p = os.path.join(PEBBLEOS, 'resources', sub, name + '.pbf')
        if os.path.exists(p):
            return p
    raise FileNotFoundError(name)


def read_reso(path):
    sys.path.insert(0, os.path.join(PEBBLEOS, 'tools'))
    with open(path, 'rb') as f:
        return pickle.load(f).data


def read_pbpack(path, resource_id):
    with open(path, 'rb') as f:
        b = f.read()
    count = struct.unpack_from('<I', b, 0)[0]
    for i in range(count):
        rid, off, length, _crc = struct.unpack_from('<IIII', b, 12 + 16 * i)
        if rid == resource_id:
            return b[0x100C + off:0x100C + off + length]
    raise KeyError(resource_id)


def parse_pbf(data):
    """-> (max_height, {codepoint: (w, h, left, top, advance, bitmap bytes)})"""
    version, max_height, n_glyphs, wildcard, hash_size, cp_bytes = struct.unpack_from(
        '<BBHHBB', data, 0)
    if version != 3:
        raise ValueError('only PBF v3 is handled, got v%d' % version)
    header_size, features = struct.unpack_from('<BB', data, 8)
    if features & 0x02:
        raise ValueError('RLE4 glyphs are not handled')
    off_bytes = 2 if features & 0x01 else 4
    entry = cp_bytes + off_bytes
    tables = header_size + 4 * hash_size
    glyph_table = tables + entry * n_glyphs
    glyphs = {}
    for i in range(n_glyphs):
        p = tables + i * entry
        cp = struct.unpack_from('<H' if cp_bytes == 2 else '<I', data, p)[0]
        off = struct.unpack_from('<H' if off_bytes == 2 else '<I', data, p + cp_bytes)[0]
        g = glyph_table + off
        w, h, left, top, adv = struct.unpack_from('<BBbbb', data, g)
        nbytes = (w * h + 7) // 8
        glyphs[cp] = (w, h, left, top, adv, data[g + 5:g + 5 + nbytes])
    return max_height, glyphs


# key -> (loader, charset). Keys are the names monthgrid-face.js uses.
def system(name):
    return lambda: open(pbf_path(name), 'rb').read()


ROBOTO_RESO = os.path.join(PEBBLEOS, 'build/resources/normal/base/ttf/'
                           'Roboto-Bold.ttf.ROBOTO_BOLD_SUBSET_49.reso')
PBPACK = os.path.join(APP, 'build/emery/app_resources.pbpack')

FONTS = {
    # Small text (status, grid digits), its bold, the weekday header and banner.
    'GOTHIC_18': (system('GOTHIC_18'), TEXT),
    'GOTHIC_18_BOLD': (system('GOTHIC_18_BOLD'), TEXT),
    'GOTHIC_14': (system('GOTHIC_14'), TEXT),
    'GOTHIC_14_BOLD': (system('GOTHIC_14_BOLD'), TEXT),
    # Time faces (emery ladder in layout.c).
    'ROBOTO_BOLD_SUBSET_49': (lambda: read_reso(ROBOTO_RESO), DIGITS),
    'GOTHIC_28_BOLD': (system('GOTHIC_28_BOLD'), DIGITS),
    'GOTHIC_24_BOLD': (system('GOTHIC_24_BOLD'), DIGITS),
    'LECO_60_BOLD_NUMBERS_AM_PM': (system('LECO_60_BOLD_NUMBERS_AM_PM'), DIGITS),
    'LECO_42_NUMBERS': (system('LECO_42_NUMBERS'), DIGITS),
    'LECO_36_BOLD_NUMBERS': (system('LECO_36_BOLD_NUMBERS'), DIGITS),
    'BITHAM_42_BOLD': (system('BITHAM_42_BOLD'), DIGITS),
    'BITHAM_42_LIGHT': (system('BITHAM_42_LIGHT'), DIGITS),
    'BITHAM_34_MEDIUM_NUMBERS': (system('BITHAM_34_MEDIUM_NUMBERS'), DIGITS),
    # MonthGrid's Silkscreen resources: ids follow package.json media order.
    'SILKTIME_24': (lambda: read_pbpack(PBPACK, 2), DIGITS),
    'SILKTIME_32': (lambda: read_pbpack(PBPACK, 3), DIGITS),
    'SILKTIME_48': (lambda: read_pbpack(PBPACK, 4), DIGITS),
}


def main():
    out = {}
    report = []
    for key, (load, charset) in FONTS.items():
        max_height, glyphs = parse_pbf(load())
        cps, blob = [], bytearray()
        for cp in charset:
            if cp not in glyphs:
                continue
            w, h, left, top, adv, bits = glyphs[cp]
            cps.append(cp)
            blob += struct.pack('<BBbbb', w, h, left, top, adv) + bits
        out[key] = {
            'h': max_height,
            'cp': ''.join(chr(c) for c in cps),
            'g': base64.b64encode(bytes(blob)).decode('ascii'),
        }
        missing = [c for c in charset if c not in glyphs]
        report.append('%-28s h=%-3d glyphs=%-4d bytes=%-5d missing=%s' % (
            key, max_height, len(cps), len(blob),
            ''.join(chr(c) for c in missing) if missing else '-'))

    body = json.dumps(out, ensure_ascii=True, separators=(',', ':'))
    js = ('// Generated by tools/extract_fonts.py from the firmware fonts; do not edit.\n'
          '// Per font: h = line height (max_height), cp = codepoints in order,\n'
          '// g = base64 of per-glyph [w, h, left, top, advance] + 1-bit rows\n'
          '// (LSB first, rows run on without padding).\n'
          '(function (root) {\n'
          '  var FONTS = ' + body + ';\n'
          "  if (typeof module === 'object' && module.exports) { module.exports = FONTS; }\n"
          '  else { root.MonthGridFonts = FONTS; }\n'
          "})(typeof self !== 'undefined' ? self : this);\n")
    with open(OUT, 'w') as f:
        f.write(js)
    print('\n'.join(report))
    print('wrote %s (%d bytes)' % (OUT, len(js)))


if __name__ == '__main__':
    main()
