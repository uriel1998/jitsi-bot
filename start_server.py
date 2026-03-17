#!/usr/bin/env python3

import http.server
import json
from datetime import datetime, timezone
from http.server import HTTPServer
from pathlib import Path

## Using this script as alternative to  -- python3 -m http.server 5500
## Running the server with this code disables the cache, for more convinient reloading after updates, else the JS will be cached by the browser.

LOG_DIR = Path("server_logs")
CLIENT_LOG_FILE = LOG_DIR / "client-events.log"


class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_my_headers()
        http.server.SimpleHTTPRequestHandler.end_headers(self)

    def send_my_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")

    def do_POST(self):
        if self.path != "/__client_log":
            self.send_error(404, "Unknown endpoint")
            return

        content_length = int(self.headers.get("Content-Length", "0") or "0")
        raw_body = self.rfile.read(content_length)

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            self.send_error(400, f"Invalid JSON payload: {error}")
            return

        LOG_DIR.mkdir(parents=True, exist_ok=True)
        entry = {
            "server_ts": datetime.now(timezone.utc).isoformat(),
            "client": self.client_address[0],
            "payload": payload,
        }
        with CLIENT_LOG_FILE.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=True) + "\n")

        self.send_response(204)
        self.end_headers()


def run(server_class=HTTPServer, handler_class=MyHTTPRequestHandler):
    server_address = ("", 5500)
    print(
        f"Launching HTTP Server for current directory at {server_address[0]}:{server_address[1]}"
    )
    print(f"Client event log file: {CLIENT_LOG_FILE.resolve()}")
    httpd = server_class(server_address, handler_class)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    run()
