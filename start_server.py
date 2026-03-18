#!/usr/bin/env python3

import argparse
import http.server
import json
import urllib.parse
from datetime import datetime, timezone
from http.server import HTTPServer
from pathlib import Path

## Using this script as alternative to  -- python3 -m http.server 5500
## Running the server with this code disables the cache, for more convinient reloading after updates, else the JS will be cached by the browser.

LOG_DIR = Path("server_logs")
CLIENT_LOG_FILE = LOG_DIR / "client-events.log"
RECORDING_DIR = Path("recording_tests")
REQUEST_LOGGING_ENABLED = False


class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        if REQUEST_LOGGING_ENABLED:
            super().log_message(format, *args)

    def end_headers(self):
        self.send_my_headers()
        http.server.SimpleHTTPRequestHandler.end_headers(self)

    def send_my_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")

    def do_POST(self):
        if self.path == "/__client_log":
            self.handle_client_log()
            return

        if self.path == "/__recording_chunk":
            self.handle_recording_chunk()
            return

        self.send_error(404, "Unknown endpoint")

    def handle_client_log(self):
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

    def handle_recording_chunk(self):
        encoded_filename = self.headers.get("X-Filename", "")
        if not encoded_filename:
            self.send_error(400, "Missing X-Filename header")
            return
        chunk_index = int(self.headers.get("X-Chunk-Index", "0") or "0")
        append_requested = self.headers.get("X-Append", "false").lower() == "true"

        content_length = int(self.headers.get("Content-Length", "0") or "0")
        raw_body = self.rfile.read(content_length)
        if not raw_body:
            self.send_error(400, "Empty recording chunk")
            return

        try:
            filename = urllib.parse.unquote(encoded_filename)
        except Exception:
            filename = encoded_filename

        safe_name = Path(filename).name
        if not safe_name:
            self.send_error(400, "Invalid filename")
            return

        RECORDING_DIR.mkdir(parents=True, exist_ok=True)
        output_path = RECORDING_DIR / safe_name
        if append_requested and chunk_index > 1 and output_path.exists():
            with output_path.open("ab") as handle:
                handle.write(raw_body)
        else:
            output_path.write_bytes(raw_body)

        response_body = json.dumps(
            {
                "savedAs": safe_name,
                "path": str(output_path.resolve()),
                "size": len(raw_body),
                "chunkIndex": chunk_index,
                "appendRequested": append_requested,
            }
        ).encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response_body)))
        self.end_headers()
        self.wfile.write(response_body)


def run(server_class=HTTPServer, handler_class=MyHTTPRequestHandler, enable_request_logging=False):
    global REQUEST_LOGGING_ENABLED
    REQUEST_LOGGING_ENABLED = enable_request_logging
    server_address = ("", 5500)
    print(
        f"Launching HTTP Server for current directory at {server_address[0]}:{server_address[1]}"
    )
    print(f"Client event log file: {CLIENT_LOG_FILE.resolve()}")
    print(f"Recording chunk output dir: {RECORDING_DIR.resolve()}")
    print(f"Request logging: {'enabled' if REQUEST_LOGGING_ENABLED else 'disabled'}")
    httpd = server_class(server_address, handler_class)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--log-requests",
        action="store_true",
        help="Enable HTTP request logging to stderr.",
    )
    args = parser.parse_args()
    run(enable_request_logging=args.log_requests)
