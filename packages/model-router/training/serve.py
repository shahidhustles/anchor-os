"""Loopback-only model service. Load once, serialize inference, never call a cloud API."""
import argparse
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from common import validate_request

MAX_BODY = 256 * 1024


def make_server(router, port=8787):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(30)

        def log_message(self, *_):
            pass

        def respond(self, status, payload):
            body = json.dumps(payload, allow_nan=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def allowed(self):
            # This is a server-to-server API. Refuse browser-originated requests.
            return (not self.headers.get('Origin') and
                    self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}',
                                               f'localhost:{self.server.server_port}'))

        def do_GET(self):
            if not self.allowed():
                return self.respond(403, {'error': 'Loopback server clients only'})
            self.respond(200 if self.path == '/health' else 404,
                         {'status': 'ready', 'engine': 'qwen3-0.6b'} if self.path == '/health'
                         else {'error': 'Not found'})

        def do_POST(self):
            if not self.allowed():
                return self.respond(403, {'error': 'Loopback server clients only'})
            if self.path != '/route':
                return self.respond(404, {'error': 'Not found'})
            started = time.perf_counter()
            try:
                if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    return self.respond(415, {'error': 'Expected application/json'})
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= MAX_BODY:
                    return self.respond(413, {'error': 'Request body exceeds limit or is empty'})
                request = json.loads(self.rfile.read(size))
                validate_request(request)
            except (ValueError, KeyError, TypeError, TimeoutError):
                return self.respond(400, {'error': 'Invalid routing request'})
            try:
                result = router.route(request)
                self.respond(200, result)
                print(json.dumps({'kind': 'route_selected', **result,
                                  'routing_time_ms': round((time.perf_counter()-started)*1000)}),
                      file=sys.stderr, flush=True)
            except (ValueError, KeyError, TypeError):
                self.respond(422, {'error': 'Router output rejected'})
            except RuntimeError:
                self.respond(503, {'error': 'Local inference unavailable'})

    return HTTPServer(('127.0.0.1', port), Handler)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--port', type=int, default=8787)
    args = parser.parse_args()
    from infer import Router
    server = make_server(Router(args.model), args.port)
    print(json.dumps({'kind': 'ready', 'port': server.server_port}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
