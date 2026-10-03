"""Serve only FormProof static assets and mock ATS pages on loopback; no uploads."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
from urllib.parse import unquote, urlsplit

ROOT=Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(ROOT),**kwargs)

    def _serve_asset(self, head=False):
        path=unquote(urlsplit(self.path).path)
        if path=='/':
            self.send_response(302);self.send_header('Location','/demo/index.html');self.end_headers();return
        resolved=(ROOT/path.lstrip('/')).resolve()
        if not resolved.is_relative_to(ROOT) or not resolved.is_file():
            self.send_error(404);return
        relative=resolved.relative_to(ROOT)
        if relative.parts[0] not in {'extension','demo','fixtures'}:
            self.send_error(404);return
        if relative.as_posix()=='extension/popup.html':
            data=resolved.read_text(encoding='utf-8').replace('<script type="module" src="popup.js">',
                '<script type="module" src="../demo/bridge.js"></script><script type="module" src="popup.js">').encode()
            self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers()
            if not head:self.wfile.write(data)
        else:
            # Serve the validated canonical path, avoiding a second inconsistent URL decode.
            self.path='/'+relative.as_posix()
            if head:super().do_HEAD()
            else:super().do_GET()

    def do_GET(self):
        self._serve_asset()

    def do_HEAD(self):
        self._serve_asset(head=True)

    def do_POST(self):
        self.send_error(405,'The demo accepts no uploads or submissions')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--port',type=int,default=8765);args=parser.parse_args()
    print(f'Controlled demo: http://127.0.0.1:{args.port}/ (Ctrl+C to stop)',flush=True)
    with ThreadingHTTPServer(('127.0.0.1',args.port),Handler) as server:
        try:server.serve_forever()
        except KeyboardInterrupt:pass
