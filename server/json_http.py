"""Minimal JSON-over-HTTP plumbing for the §4.4 sibling processes.

The chain nodes (8201–8203) and the drone agents (8101–8102) are REAL OS processes that
must start fast and have no reason to pull in FastAPI/uvicorn: they answer two or three
endpoints each. This module is the whole transport layer — stdlib only.

Servers are `ThreadingHTTPServer` + a route table; clients are one-shot `urllib` calls
that raise `RemoteCallError` (never a bare `URLError`) so callers can map "the sibling is
gone" onto their own protocol response — for the API server that is a 503, not a 500.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

logger = logging.getLogger("bustaron.json_http")

Route = Callable[[dict[str, Any]], tuple[int, dict[str, Any]]]


class RemoteCallError(RuntimeError):
    """A sibling process did not answer, or answered nonsense."""

    def __init__(self, url: str, reason: str) -> None:
        super().__init__(f"{url}: {reason}")
        self.url = url
        self.reason = reason


def get_json(url: str, timeout_s: float = 5.0) -> Any:
    try:
        with urllib.request.urlopen(url, timeout=timeout_s) as response:  # noqa: S310 (operator-supplied, loopback)
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        raise RemoteCallError(url, f"{type(exc).__name__}: {exc}") from exc


def post_json(url: str, body: Mapping[str, Any], timeout_s: float = 5.0) -> Any:
    request = urllib.request.Request(
        url,
        data=json.dumps(dict(body)).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # An HTTP status is the sibling ANSWERING. Surface its body so a 4xx from a node
        # is never mistaken for "the node is down".
        try:
            return json.loads(exc.read().decode("utf-8"))
        except (ValueError, json.JSONDecodeError):
            raise RemoteCallError(url, f"HTTP {exc.code} with an unparseable body") from exc
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise RemoteCallError(url, f"{type(exc).__name__}: {exc}") from exc


class _Handler(BaseHTTPRequestHandler):
    """Dispatches POST bodies and GET paths through the route table given to `serve`."""

    routes: Mapping[str, Route]

    def _respond(self, status: int, body: dict[str, Any]) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _dispatch(self, method: str) -> None:
        path = self.path.split("?", 1)[0]
        route = self.routes.get(f"{method} {path}")
        if route is None:
            self._respond(404, {"error": f"no route for {method} {path}"})
            return
        try:
            if method == "POST":
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length).decode("utf-8") if length else "{}"
                body = json.loads(raw) if raw else {}
            else:
                body = {}
            status, payload = route(body)
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            self._respond(400, {"error": f"{type(exc).__name__}: {exc}"})
            return
        self._respond(status, payload)

    def do_GET(self) -> None:  # noqa: N802 (http.server's required name)
        self._dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802 (http.server's required name)
        self._dispatch("POST")

    def log_message(self, fmt: str, *args: Any) -> None:
        logger.debug("%s - %s", self.address_string(), fmt % args)


def serve(port: int, routes: Mapping[str, Route], name: str, host: str = "127.0.0.1") -> ThreadingHTTPServer:
    """BINDS the socket and returns the server — it does not serve.

    The caller owns the loop (`server.serve_forever()`), which keeps the start-up
    sequence honest and testable: bind first (so a port clash fails immediately), then
    decide. `serve_in_thread()` is the convenience wrapper for callers that want the
    server off the main thread.
    """
    handler = type("BoundHandler", (_Handler,), {"routes": routes})
    httpd = ThreadingHTTPServer((host, port), handler)
    logger.info("%s bound %s:%s (pid %s)", name, host, httpd.server_port, os.getpid())
    return httpd


def serve_in_thread(httpd: ThreadingHTTPServer, name: str) -> threading.Thread:
    """Serves `httpd` on a daemon thread (for in-process use)."""
    thread = threading.Thread(target=httpd.serve_forever, name=f"{name}-http", daemon=True)
    thread.start()
    return thread
