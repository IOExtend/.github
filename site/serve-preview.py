import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class ViewerFiles(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
    }

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Serve an isolated local IOExtend release.")
    parser.add_argument("wwwroot", type=Path)
    parser.add_argument("--port", type=int, default=8976)
    args = parser.parse_args()
    if not (args.wwwroot / "index.html").is_file():
        parser.error("wwwroot must contain the published index.html")
    with ThreadingHTTPServer(("127.0.0.1", args.port), partial(ViewerFiles, directory=args.wwwroot.resolve())) as server:
        print(f"http://127.0.0.1:{server.server_port}/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("Stopped local preview.")
