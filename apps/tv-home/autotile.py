# Saves a logo the page cut out of an app's splash screen (see cache.js and
# makeLogos in app.js). The page sends raw RGBA pixels, not a PNG: the TV
# browser's own PNG encoder sometimes writes broken rows. Called via
# hbchannel exec, as root:
#   autotile.py part <name> <base64>          append one part (an exec argument must stay < 128 KiB)
#   autotile.py save <app> <name> <w> <h>     write autotiles/<name> as PNG, drop older ones of <app>
#   autotile.py none <app> <name>             no logo in this splash: an empty marker, not tried again
import base64, glob, os, re, struct, sys, zlib

DIR = '/var/lib/webosbrew/atvhome/autotiles'
NAME = re.compile(r'^[A-Za-z0-9._-]+$')


def tmp(name):
    return '/tmp/autotile-' + name + '.b64'


def png(w, h, rgba):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    rows = b''.join(b'\0' + rgba[y * w * 4:(y + 1) * w * 4] for y in range(h))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))


def replace(app, name, data):
    for old in glob.glob(os.path.join(DIR, glob.escape(app) + '.[0-9]*')):
        os.remove(old)
    out = os.path.join(DIR, name)
    with open(out + '.tmp', 'wb') as f:
        f.write(data)
    os.rename(out + '.tmp', out)


def main(cmd, *args):
    names = args[:1] if cmd == 'part' else args[:2]   # (part's second argument is the data)
    if not names or not all(NAME.match(a) for a in names):
        sys.exit('bad name')
    os.makedirs(DIR, exist_ok=True)
    if cmd == 'part':
        with open(tmp(args[0]), 'a') as f:
            f.write(args[1])
    elif cmd == 'save':
        app, name, w, h = args[0], args[1], int(args[2]), int(args[3])
        try:
            with open(tmp(name)) as f:
                rgba = base64.b64decode(f.read())
        finally:
            if os.path.exists(tmp(name)):
                os.remove(tmp(name))
        if not (0 < w <= 2000 and 0 < h <= 2000) or len(rgba) != w * h * 4:
            sys.exit('wrong size')
        replace(app, name, png(w, h, rgba))
        print('saved')
    elif cmd == 'none':
        replace(args[0], args[1], b'')
    else:
        sys.exit('usage: autotile.py part|save|none ...')


main(*sys.argv[1:])
