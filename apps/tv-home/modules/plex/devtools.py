# Minimal client for the TV's DevTools port (WAM, 127.0.0.1:9998): runs a
# JavaScript expression in a web app's page. Only developer apps are listed
# there (store apps are not inspectable). Standard library only.
import base64
import json
import os
import socket
import struct
import urllib.request

PORT = 9998


def page(match):
    """webSocketDebuggerUrl path of the first page whose url contains match, or None."""
    with urllib.request.urlopen('http://127.0.0.1:%d/json/list' % PORT, timeout=3) as r:
        for p in json.load(r):
            if match in p.get('url', '') and p.get('webSocketDebuggerUrl'):
                return p['webSocketDebuggerUrl'].split(':%d' % PORT, 1)[1]
    return None


class Socket:
    def __init__(self, path, timeout=30):
        self.s = socket.create_connection(('127.0.0.1', PORT), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall(('GET %s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                        'Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n' % (path, PORT, key)).encode())
        self.buf = b''
        while b'\r\n\r\n' not in self.buf:
            d = self.s.recv(4096)
            if not d:
                raise EOFError('no handshake')
            self.buf += d
        head, self.buf = self.buf.split(b'\r\n\r\n', 1)
        if b' 101 ' not in head.split(b'\r\n')[0]:
            raise RuntimeError('handshake refused')
        self.n = 0

    def close(self):
        self.s.close()

    def _read(self, n):
        while len(self.buf) < n:
            d = self.s.recv(65536)
            if not d:
                raise EOFError('closed')
            self.buf += d
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _send(self, obj):
        data = json.dumps(obj).encode()
        n = len(data)
        if n < 126:
            head = struct.pack('>BB', 0x81, 0x80 | n)
        elif n < 65536:
            head = struct.pack('>BBH', 0x81, 0x80 | 126, n)
        else:
            head = struct.pack('>BBQ', 0x81, 0x80 | 127, n)
        mask = os.urandom(4)
        self.s.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _recv(self):
        msg = b''
        while True:
            b1, b2 = self._read(2)
            n = b2 & 0x7f
            if n == 126:
                n = struct.unpack('>H', self._read(2))[0]
            elif n == 127:
                n = struct.unpack('>Q', self._read(8))[0]
            msg += self._read(n)
            if b1 & 0x80:
                return json.loads(msg.decode('utf-8'))

    def call(self, method, **params):
        self.n += 1
        self._send({'id': self.n, 'method': method, 'params': params})
        while True:
            r = self._recv()
            if r.get('id') == self.n:
                return r


def evaluate(match, js, timeout=30):
    """Value of js (promises awaited) in the page matching match. Raises when there's no page or js throws."""
    path = page(match)
    if not path:
        raise LookupError('no page')
    ws = Socket(path, timeout)
    try:
        r = ws.call('Runtime.evaluate', expression=js, awaitPromise=True, returnByValue=True)
    finally:
        ws.close()
    res = r.get('result', {})
    if 'exceptionDetails' in res:
        d = res['exceptionDetails']
        raise RuntimeError(d.get('exception', {}).get('description') or d.get('text'))
    return res.get('result', {}).get('value')
