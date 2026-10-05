#!/usr/bin/env python3
"""Local dev server that disables browser caching, so a normal reload always
loads the latest HTML/CSS/JS. Run it instead of `python3 -m http.server`:

    python3 serve.py

Then open http://localhost:8000/
"""
import http.server
import socketserver

PORT = 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', PORT), NoCacheHandler) as httpd:
    print(f'Serving with no-store cache headers on http://localhost:{PORT}/  (Ctrl+C to stop)')
    httpd.serve_forever()
