#!/usr/bin/env python3
# Plex rows for TV Home: Continue Watching (and optionally "New in your
# libraries") from the person's Plex server, with the pictures cached in this
# app's folder (the web runtime can't load files from elsewhere, and the token
# never reaches the web page or a picture URL).
#
#   plex.py get [sections]      print the cached rows, refresh in the background
#                               when they're older than MAX_AGE
#   plex.py refresh [sections]  fetch now, print the rows
#   plex.py libraries           print the movie and show libraries [{key, title, type}]
#   plex.py play <ratingKey>    open Plex and resume that item
#   plex.py open <ratingKey>    open Plex on that item's page
#                               (both return at once; the result goes to DATA/plex-play.log)
#   plex.py preload             start Plex hidden unless it's running, so the above and
#                               the Plex tile don't wait for its ~10 s start
#   plex.py account             print {user, server} or {error}
#   plex.py signin              start Plex's TV sign-in: print {code} to enter at plex.tv/link
#   plex.py signin-check        print {done, user} once the code was entered, else {waiting} / {expired}
#   plex.py signout             forget the token (it stays listed under the account's devices
#                               on plex.tv until removed there)
#
# Signing in gets a token for this TV only (it shows as a device of the Plex
# account), so anyone with access to a server (their own or shared with them)
# sees their own rows and watch state.
#
# sections: comma separated library section ids ("1,6,5,2"); empty = all
# movie and show libraries. Runs as root through Homebrew Channel's exec.
# Standard library only (the TV has Python 3.10).
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

DATA = os.environ.get('ATVHOME_DATA', '/var/lib/webosbrew/atvhome')
APP = os.environ.get('ATVHOME_APP', os.path.dirname(os.path.abspath(__file__)))
TOKEN_FILE = os.path.join(DATA, 'plex-token')
SERVER_FILE = os.path.join(DATA, 'plex-server.json')   # cached connection, root only
PIN_FILE = os.path.join(DATA, 'plex-pin.json')         # sign-in in progress
CLIENT_FILE = os.path.join(DATA, 'plex-client-id')     # this TV's id towards Plex, made once
CACHE = os.path.join(APP, 'cache', 'plex')
ROWS = os.path.join(CACHE, 'rows.json')
MAX_AGE = 15 * 60
SERVER_AGE = 6 * 3600
CONTINUE_MAX = 10
RECENT_MAX = 12
PLEX_TV = 'https://plex.tv/api/v2'
PLEX_LINK = 'com.iso.plexlink'      # apps/plex-link: the Plex web app as an inspectable developer app
PLEX_PAGE = 'app.plex.tv/tv-v5-webos'
PLAY_LOG = os.path.join(DATA, 'plex-play.log')
READY_WAIT = 60

# Plex (the store app) has no deep links, but its web app has an unused deep
# link handler, appController.processDeepLink. The script reaches it through
# the module that exports Plex's service container: found by its source, as the
# module ids change with every Plex build, and required only once Plex has
# drawn (its canvas exists). Requiring it earlier runs Plex's start-up out of
# order and hangs the app.
PLEX_JS = ("var q=self.webpackChunk_plexinc_client_webos,req;q.push([['tvhome'+Date.now()],{},function(r){req=r;}]);"
           "var id=Object.keys(req.m).filter(function(k){var s=String(req.m[k]);"
           "return s.indexOf('containerInitializer:')>=0&&s.indexOf('container:function(){return')>=0;})[0];"
           "if(!id)throw new Error('no container module');var L=req(id).container;")
READY_JS = ("(function(){if(!document.querySelector('canvas')||!self.webpackChunk_plexinc_client_webos)return false;"
            + PLEX_JS + "return !!(L.resolve('navigation').current&&L.resolve('userManager').current);})()")
OPEN_JS = "(function(){" + PLEX_JS + "L.resolve('appController').processDeepLink(%s);return true;})()"


def secret_write(path, text):
    fd = os.open(path + '.tmp', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write(text)
    os.replace(path + '.tmp', path)


def hardware_id():
    """This TV's network card address (eth0, else wlan0): unique per TV, never sent as is."""
    for nic in ('eth0', 'wlan0'):
        try:
            mac = open('/sys/class/net/%s/address' % nic).read().strip()
        except OSError:
            continue
        if mac and mac != '00:00:00:00:00:00':
            return mac
    return ''


def client_id():
    """This TV's id towards Plex. Made from the TV's network card, so two TVs never
    share one, even when the data folder was copied from another TV (Plex treats
    TVs with the same id as one device, and their sign-ins replace each other).
    The file remembers which TV it belongs to; a copied one is replaced, and the
    sign-in that came with it is dropped (it belongs to the other TV)."""
    hw = hardware_id()
    try:
        cid, owner = (open(CLIENT_FILE).read().split() + [''])[:2]
        if not hw or owner == hw:
            return cid
    except (OSError, ValueError):
        pass
    if os.path.exists(CLIENT_FILE):
        for f in (TOKEN_FILE, SERVER_FILE, PIN_FILE):
            try:
                os.remove(f)
            except OSError:
                pass
    seed = hw.encode() if hw else os.urandom(16)
    cid = 'tvhome-' + hashlib.sha256(b'tvhome-plex:' + seed).hexdigest()[:24]
    secret_write(CLIENT_FILE, cid + (' ' + hw if hw else ''))
    return cid


def key_ok(k):
    """Plex ids (ratingKey, library key) are numbers. Anything else from a server is
    refused: these go into file names and into TV Home's root shell commands."""
    return isinstance(k, (int, str)) and str(k).isdigit()


def headers(token=None):
    h = {'Accept': 'application/json', 'X-Plex-Product': 'TV Home', 'X-Plex-Version': '1',
         'X-Plex-Client-Identifier': client_id(), 'X-Plex-Platform': 'webOS', 'X-Plex-Device-Name': 'TV Home ' + client_id()[-4:]}
    if token:
        h['X-Plex-Token'] = token
    return h


def http(url, token, timeout=15, raw=False, method='GET'):
    req = urllib.request.Request(url, headers=headers(token), method=method, data=None if method == 'GET' else b'')
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    return body if raw else json.loads(body.decode('utf-8'))


def server(token, force=False):
    """(base uri, server token, machine id): cached, else found through plex.tv.
    The account's own server first, else one shared with it; direct connections before relays."""
    try:
        s = json.load(open(SERVER_FILE))
        if not force and time.time() - s['at'] < SERVER_AGE and s.get('id'):
            return s['uri'], s['token'], s['id']
    except Exception:
        pass
    servers = [r for r in http(PLEX_TV + '/resources?includeHttps=1&includeRelay=1', token)
               if 'server' in r.get('provides', '')]
    servers.sort(key=lambda r: not r.get('owned'))
    for r in servers:
        st = r.get('accessToken') or token
        for c in sorted(r.get('connections', []), key=lambda c: (c.get('relay', False), c['local'])):
            try:
                http(c['uri'] + '/identity', st, timeout=6)
            except Exception:
                continue
            secret_write(SERVER_FILE, json.dumps({'uri': c['uri'], 'token': st, 'id': r['clientIdentifier'],
                                                  'name': r.get('name', ''), 'at': time.time()}))
            return c['uri'], st, r['clientIdentifier']
    raise RuntimeError('no reachable Plex server')


def server_get(token, path):
    """(answer, base uri, server token, machine id) for GET path on the server; looks the server up
    again once when the cached address fails (its address changed)."""
    try:
        base, st, sid = server(token)
        return http(base + path, st), base, st, sid
    except Exception:
        base, st, sid = server(token, force=True)
        return http(base + path, st), base, st, sid


def picture(base, st, path, name, w, h):
    """A picture scaled by the server, saved as cache/plex/<name>.jpg; '' when there's none."""
    if not path:
        return ''
    out = os.path.join(CACHE, name + '.jpg')
    if not os.path.exists(out):
        q = urllib.parse.urlencode({'url': path, 'width': w, 'height': h, 'minSize': 1, 'upscale': 1})
        try:
            data = http(base + '/photo/:/transcode?' + q, st, raw=True)
        except Exception:
            return ''
        with open(out + '.tmp', 'wb') as f:
            f.write(data)
        os.replace(out + '.tmp', out)
    return 'cache/plex/' + name + '.jpg'


def minutes_left(m):
    d, v = m.get('duration') or 0, m.get('viewOffset') or 0
    return max(1, round((d - v) / 60000)) if d and v else 0


def card(base, st, m):
    """One Continue Watching card: wide picture, labels, progress.
    The app builds the text (its own language), so numbers stay numbers here."""
    rk = m['ratingKey']
    ep = m.get('type') == 'episode'
    art = m.get('art') or m.get('grandparentArt') or m.get('thumb')
    d = m.get('duration') or 0
    return {
        'key': rk, 'type': m.get('type'),
        'title': m.get('grandparentTitle') if ep else m.get('title'),
        'episode': m.get('title') if ep else '',
        'season': m.get('parentIndex') if ep else None,
        'number': m.get('index') if ep else None,
        'left': minutes_left(m),
        'progress': round(min(1.0, (m.get('viewOffset') or 0) / d), 3) if d else 0,
        'wide': picture(base, st, art, rk + '-wide', 960, 540),
    }


def poster(base, st, m):
    rk = m['ratingKey']
    return {'key': rk, 'type': m.get('type'), 'title': m.get('title'),
            'poster': picture(base, st, m.get('thumb'), rk + '-poster', 400, 600)}


def fetch(sections, recent):
    answer, base, st, _ = server_get(open(TOKEN_FILE).read().strip(), '/hubs/continueWatching?count=30')
    mc = answer['MediaContainer']
    items = mc.get('Metadata') or [m for h in mc.get('Hub', []) for m in h.get('Metadata', [])]
    if not sections:
        secs = http(base + '/library/sections', st)['MediaContainer'].get('Directory', [])
        sections = [d['key'] for d in secs if d.get('type') in ('movie', 'show')]
    sections = [str(s) for s in sections if key_ok(s)]
    items = [m for m in items if key_ok(m.get('ratingKey'))]
    os.makedirs(CACHE, exist_ok=True)
    rows = {'at': int(time.time()), 'continue': [], 'recent': []}
    for m in items:
        if str(m.get('librarySectionID')) in sections and len(rows['continue']) < CONTINUE_MAX:
            rows['continue'].append(card(base, st, m))
    if recent:
        for s in sections:
            q = base + '/library/sections/%s/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=%d' % (s, RECENT_MAX)
            for m in http(q, st)['MediaContainer'].get('Metadata', []):
                if key_ok(m.get('ratingKey')) and m.get('type') in ('movie', 'show', 'season') and not m.get('viewCount'):
                    rows['recent'].append((m.get('addedAt') or 0, m))
        rows['recent'].sort(key=lambda x: -x[0])
        rows['recent'] = [poster(base, st, m) for _, m in rows['recent'][:RECENT_MAX]]
    # Drop pictures no row uses any more.
    used = set(os.path.basename(v) for r in rows['continue'] + rows['recent'] for v in r.values() if isinstance(v, str) and v.startswith('cache/'))
    for f in os.listdir(CACHE):
        if f.endswith('.jpg') and f not in used:
            os.remove(os.path.join(CACHE, f))
    with open(ROWS + '.tmp', 'w') as f:
        json.dump(rows, f)
    os.replace(ROWS + '.tmp', ROWS)
    return rows


def luna_send(uri, params):
    r = subprocess.run(['luna-send', '-n', '1', uri, json.dumps(params)], stdin=subprocess.DEVNULL,
                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15)
    try:
        return json.loads(r.stdout.decode('utf-8'))
    except ValueError:
        return {}


def preload():
    """Starts PLEX_LINK hidden (the app manager's preload mode) unless it's running or nobody
    is signed in; True when it was started."""
    if not os.path.exists(TOKEN_FILE):
        return False
    running = luna_send('luna://com.webos.applicationManager/running', {}).get('running')
    if running is None or any(a.get('id') == PLEX_LINK for a in running):
        return False
    return bool(luna_send('luna://com.webos.applicationManager/launch', {'id': PLEX_LINK, 'preload': 'full'}).get('returnValue'))


def show(key, resume):
    """Opens Plex (as PLEX_LINK) on key: playing from where it was left (resume) or its page; returns what happened."""
    import devtools
    luna_send('luna://com.webos.applicationManager/launch', {'id': PLEX_LINK})
    # Ask the server while Plex starts (that takes ~10 s from cold).
    try:
        token = open(TOKEN_FILE).read().strip()
        if resume:
            answer, _, _, sid = server_get(token, '/library/metadata/' + key)
            target = {'autoplay': True, 'offset': answer['MediaContainer']['Metadata'][0].get('viewOffset') or 0}
        else:
            sid = server(token)[2]
            target = {}
        # Plex finds the server by its id in its own (signed-in) account.
        target['metadataSourceUri'] = 'server://%s/com.plexapp.plugins.library/library/metadata/%s' % (sid, key)
    except Exception as e:
        return 'server: %s' % type(e).__name__
    start = time.time()
    while True:
        try:
            if devtools.evaluate(PLEX_PAGE, READY_JS, timeout=10):
                break
        except Exception:
            pass
        if time.time() - start > READY_WAIT:
            return 'Plex not ready after %d s' % READY_WAIT
        time.sleep(0.5)
    try:
        devtools.evaluate(PLEX_PAGE, OPEN_JS % json.dumps(target))
    except Exception as e:
        return 'deep link: %s' % e
    what = 'playing %s from %d s' % (key, target['offset'] // 1000) if resume else 'showing %s' % key
    return '%s (Plex ready after %.1f s)' % (what, time.time() - start)


# ---- account: Plex's TV sign-in (a short code entered at plex.tv/link)

def forget_rows():
    """Drops the cached server and rows (they belong to the account that was signed in)."""
    for f in (SERVER_FILE, ROWS):
        if os.path.exists(f):
            os.remove(f)
    if os.path.isdir(CACHE):
        for f in os.listdir(CACHE):
            if f.endswith('.jpg'):
                os.remove(os.path.join(CACHE, f))


def account():
    token = open(TOKEN_FILE).read().strip()
    u = http(PLEX_TV + '/user', token)
    try:
        name = json.load(open(SERVER_FILE)).get('name', '')
    except Exception:
        name = ''
    return {'user': u.get('title') or u.get('username') or '', 'server': name}


def signin():
    pin = http(PLEX_TV + '/pins', None, method='POST')
    secret_write(PIN_FILE, json.dumps({'id': pin['id'], 'code': pin['code']}))
    return {'code': pin['code']}


def signin_check():
    try:
        p = json.load(open(PIN_FILE))
    except Exception:
        return {'error': 'no sign-in'}
    try:
        r = http(PLEX_TV + '/pins/%d' % p['id'], None)
    except urllib.error.HTTPError as e:
        if e.code == 404:           # the code ran out (after 15 minutes)
            os.remove(PIN_FILE)
            return {'expired': True}
        raise
    if not r.get('authToken'):
        return {'waiting': True, 'code': p['code']}
    secret_write(TOKEN_FILE, r['authToken'])
    os.remove(PIN_FILE)
    forget_rows()
    return dict(account(), done=True)


def signout():
    for f in (TOKEN_FILE, PIN_FILE):
        if os.path.exists(f):
            os.remove(f)
    forget_rows()


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'get'
    if cmd in ('account', 'signin', 'signin-check', 'signout'):
        if cmd == 'account' and not os.path.exists(TOKEN_FILE):
            print(json.dumps({'error': 'no token'}))
            return
        try:
            res = {'account': account, 'signin': signin, 'signin-check': signin_check,
                   'signout': lambda: signout() or {'ok': True}}[cmd]()
        except Exception as e:
            res = {'error': type(e).__name__}
        print(json.dumps(res))
        return
    if cmd == 'preload':
        print(json.dumps({'started': preload()}))
        return
    if cmd in ('play', 'open'):
        key = sys.argv[2] if len(sys.argv) > 2 else ''
        if not key.isdigit():
            print(json.dumps({'error': 'bad key'}))
            return
        subprocess.Popen([sys.executable, os.path.abspath(__file__), cmd + '-now', key], stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        print(json.dumps({'ok': True}))
        return
    if cmd in ('play-now', 'open-now'):
        try:
            res = show(sys.argv[2], cmd == 'play-now')
        except Exception as e:
            res = 'failed: %s' % type(e).__name__
        with open(PLAY_LOG, 'w') as f:
            f.write('%s %s\n' % (time.strftime('%Y-%m-%d %H:%M:%S'), res))
        return
    sections = [s for s in (sys.argv[2] if len(sys.argv) > 2 else '').split(',') if key_ok(s)]
    recent = len(sys.argv) > 3 and sys.argv[3] == 'recent'
    if not os.path.exists(TOKEN_FILE):
        print(json.dumps({'error': 'no token'}))
        return
    if cmd == 'refresh':
        try:
            print(json.dumps(fetch(sections, recent)))
        except Exception as e:
            print(json.dumps({'error': type(e).__name__}))
        return
    if cmd == 'libraries':
        try:
            secs = server_get(open(TOKEN_FILE).read().strip(), '/library/sections')[0]['MediaContainer'].get('Directory', [])
            print(json.dumps({'libraries': [{'key': d['key'], 'title': d['title'], 'type': d['type']}
                                            for d in secs if d.get('type') in ('movie', 'show') and key_ok(d.get('key'))]}))
        except Exception as e:
            print(json.dumps({'error': type(e).__name__}))
        return
    try:
        rows = json.load(open(ROWS))
    except Exception:
        rows = None
    if rows is None or time.time() - rows.get('at', 0) > MAX_AGE:
        args = [sys.executable, os.path.abspath(__file__), 'refresh', ','.join(sections)] + (['recent'] if recent else [])
        subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
    print(json.dumps(rows or {'loading': True}))


if __name__ == '__main__':
    main()
