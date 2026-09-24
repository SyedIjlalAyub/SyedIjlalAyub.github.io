#!/usr/bin/env python3
"""
PuzzleVerse exact public-site mirror V2.

Goals:
- Keep fetched source response bodies byte-for-byte; never rewrite HTML/CSS/JS/SVG.
- Discover references recursively from HTML/CSS plus URLs observed in Chromium.
- Fail rather than publish when a referenced public same-origin static resource
  cannot be copied.
- Detect query variants that would require different bytes at one static path.

GitHub Pages cannot reproduce private/server-side implementation code. Dynamic
routes such as /api/* and /signin-with-chatgpt are therefore not represented as
fake local files.
"""

from __future__ import annotations

import argparse
import hashlib
import html.parser
import json
import re
import subprocess
import sys
import tempfile
from collections import deque
from pathlib import Path, PurePosixPath
from urllib.parse import urldefrag, urljoin, urlsplit, urlunsplit


DYNAMIC_PREFIXES = (
    "/api/",
    "/signin-with-chatgpt",
    "/cdn-cgi/",
)

# These pages/resources are known public parts of the source site and are checked
# even if a later source edit temporarily stops linking to one of them.
REQUIRED_SEEDS = (
    "/",
    "/style.css",
    "/walkthrough.css",
    "/script.js",
    "/walkthrough.js",
    "/signup.js",
    "/icon.svg",
    "/android.svg",
    "/subscribers.html",
    "/subscribers.css",
)

OPTIONAL_SEEDS = (
    "/robots.txt",
    "/sitemap.xml",
    "/favicon.ico",
)


class HtmlRefs(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.refs: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        self._collect(tag.lower(), attrs)

    def handle_startendtag(self, tag: str, attrs) -> None:
        self._collect(tag.lower(), attrs)

    def _collect(self, tag: str, attrs) -> None:
        data = {str(k).lower(): v for k, v in attrs if k}
        for key in ("src", "href", "poster"):
            value = data.get(key)
            if value:
                self.refs.append(value)

        srcset = data.get("srcset")
        if srcset:
            for candidate in srcset.split(","):
                value = candidate.strip().split(" ", 1)[0]
                if value:
                    self.refs.append(value)

        # OpenGraph/Twitter image resources are browser-visible public assets too.
        if tag == "meta":
            prop = (data.get("property") or data.get("name") or "").lower()
            if prop in {"og:image", "og:image:url", "twitter:image", "twitter:image:src"}:
                content = data.get("content")
                if content:
                    self.refs.append(content)


CSS_URL_RE = re.compile(
    r"""url\(\s*(?P<q>['"]?)(?P<url>[^'")]+)(?P=q)\s*\)""",
    re.IGNORECASE,
)
CSS_IMPORT_RE = re.compile(
    r"""@import\s+(?:url\(\s*)?(?P<q>['"])(?P<url>[^'"]+)(?P=q)""",
    re.IGNORECASE,
)
STATIC_JS_PATH_RE = re.compile(
    r"""(?P<q>['"])(?P<url>/(?!/)[^'"]+\.(?:css|js|mjs|json|xml|txt|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|otf|map)(?:\?[^'"]*)?)(?P=q)""",
    re.IGNORECASE,
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(url: str) -> tuple[bytes, str, str]:
    """Return exact response body plus final URL and MIME type."""
    with tempfile.TemporaryDirectory() as td:
        body = Path(td) / "body"
        headers = Path(td) / "headers"
        meta = Path(td) / "meta"

        command = [
            "curl",
            "--fail",
            "--location",
            "--silent",
            "--show-error",
            "--retry", "3",
            "--retry-delay", "1",
            "--user-agent",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
            "--dump-header", str(headers),
            "--output", str(body),
            "--write-out", "%{url_effective}\n%{content_type}\n",
            url,
        ]
        with meta.open("wb") as meta_handle:
            subprocess.run(command, check=True, stdout=meta_handle)

        lines = meta.read_text(encoding="utf-8", errors="replace").splitlines()
        final_url = lines[0].strip() if lines else url
        content_type = lines[1].strip().split(";", 1)[0].lower() if len(lines) > 1 else ""
        return body.read_bytes(), final_url, content_type


def same_origin(origin: str, candidate: str, base: str) -> str | None:
    value = candidate.strip()
    if not value or value.startswith(("#", "data:", "mailto:", "tel:", "javascript:", "blob:")):
        return None

    absolute = urljoin(base, value)
    absolute, _fragment = urldefrag(absolute)
    parsed = urlsplit(absolute)
    source = urlsplit(origin)

    if parsed.scheme not in {"http", "https"} or parsed.netloc != source.netloc:
        return None
    path = parsed.path or "/"
    if any(path.startswith(prefix) for prefix in DYNAMIC_PREFIXES):
        return None

    # The source uses / and /index.html as navigation aliases. Mirror the root
    # response once so edge-injected transient markup cannot create a false
    # "different bytes for the same GitHub file" collision.
    if path == "/index.html":
        path = "/"

    return urlunsplit((source.scheme, source.netloc, path, parsed.query, ""))


def destination_for(url: str, content_type: str) -> Path:
    parsed = urlsplit(url)
    path = parsed.path or "/"

    if path == "/":
        return Path("index.html")

    pure = PurePosixPath(path.lstrip("/"))

    if path.endswith("/"):
        return Path(str(pure)) / "index.html"

    if pure.suffix:
        return Path(str(pure))

    if content_type == "text/html":
        return Path(str(pure)) / "index.html"

    return Path(str(pure))


def refs_from_body(body: bytes, content_type: str, base_url: str) -> list[str]:
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError:
        return []

    refs: list[str] = []
    looks_html = content_type == "text/html" or "<html" in text[:1000].lower()

    if looks_html:
        parser = HtmlRefs()
        parser.feed(text)
        refs.extend(parser.refs)

        # Inline style blocks/attributes can carry URL references.
        refs.extend(match.group("url") for match in CSS_URL_RE.finditer(text))

    if content_type == "text/css" or urlsplit(base_url).path.lower().endswith(".css"):
        refs.extend(match.group("url") for match in CSS_URL_RE.finditer(text))
        refs.extend(match.group("url") for match in CSS_IMPORT_RE.finditer(text))

    if (
        content_type in {"application/javascript", "text/javascript"}
        or urlsplit(base_url).path.lower().endswith((".js", ".mjs"))
    ):
        refs.extend(match.group("url") for match in STATIC_JS_PATH_RE.finditer(text))

    return refs


def load_network_urls(path: Path, origin: str) -> list[str]:
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    found: list[str] = []
    for item in payload.get("responses", []):
        url = item.get("url")
        if not isinstance(url, str):
            continue
        normalized = same_origin(origin, url, origin + "/")
        if normalized:
            found.append(normalized)
    return found


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--origin", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--network-manifest", required=True)
    parser.add_argument("--manifest", required=True)
    args = parser.parse_args()

    origin = args.origin.rstrip("/")
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    required = {
        same_origin(origin, seed, origin + "/")
        for seed in REQUIRED_SEEDS
    }
    required.discard(None)

    optional = {
        same_origin(origin, seed, origin + "/")
        for seed in OPTIONAL_SEEDS
    }
    optional.discard(None)

    queue: deque[str] = deque()
    for url in sorted(required):
        queue.append(url)
    for url in sorted(optional):
        queue.append(url)
    for url in load_network_urls(Path(args.network_manifest), origin):
        queue.append(url)

    seen_requests: set[str] = set()
    saved_by_path: dict[str, dict[str, object]] = {}
    failures: list[dict[str, str]] = []
    manifest: list[dict[str, object]] = []

    while queue:
        requested = queue.popleft()
        if requested in seen_requests:
            continue
        seen_requests.add(requested)

        try:
            body, final_url, content_type = fetch(requested)
        except subprocess.CalledProcessError as exc:
            if requested in optional:
                print(f"Optional source resource absent: {requested}")
                continue
            failures.append({"url": requested, "reason": f"curl exit {exc.returncode}"})
            continue

        normalized_final = same_origin(origin, final_url, origin + "/")
        if normalized_final is None:
            failures.append({
                "url": requested,
                "reason": f"redirected outside source origin to {final_url}",
            })
            continue

        target_rel = destination_for(normalized_final, content_type).as_posix()
        digest = sha256(body)

        prior = saved_by_path.get(target_rel)
        if prior is not None and prior["sha256"] != digest:
            failures.append({
                "url": requested,
                "reason": (
                    f"static-path collision: {target_rel} has different bytes for "
                    f"{prior['url']} and {requested}; GitHub Pages cannot reproduce "
                    "query-dependent source variants exactly"
                ),
            })
            continue

        target = output / target_rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)

        if target.read_bytes() != body:
            raise RuntimeError(f"Local byte verification failed for {target_rel}")

        record = {
            "requested_url": requested,
            "url": normalized_final,
            "path": target_rel,
            "bytes": len(body),
            "sha256": digest,
            "content_type": content_type,
        }

        if prior is None:
            saved_by_path[target_rel] = record
            manifest.append(record)
            print(f"{digest}  {target_rel}  {len(body)} bytes")

        for ref in refs_from_body(body, content_type, normalized_final):
            child = same_origin(origin, ref, normalized_final)
            if child and child not in seen_requests:
                queue.append(child)

    # Every same-origin browser request that is not explicitly dynamic must have
    # a corresponding mirrored path.
    network_urls = load_network_urls(Path(args.network_manifest), origin)
    for network_url in network_urls:
        parsed = urlsplit(network_url)
        # Content type is not known here, but browser-requested URLs with an
        # extension map directly. Extensionless HTML pages should have been
        # discovered by HTML crawling and are checked via seen_requests.
        if network_url not in seen_requests:
            failures.append({
                "url": network_url,
                "reason": "observed by Chromium but never processed by mirror",
            })

    if failures:
        print("\nExact V2 mirror aborted:", file=sys.stderr)
        for failure in failures:
            print(f"  {failure['url']}: {failure['reason']}", file=sys.stderr)
        return 1

    index = output / "index.html"
    if not index.is_file() or b"PuzzleVerse" not in index.read_bytes():
        print("Exact V2 mirror aborted: root response is not a usable PuzzleVerse page", file=sys.stderr)
        return 1

    # Known V1 defect: subscriber stylesheet must exist locally in V2.
    subscriber_css = output / "subscribers.css"
    if not subscriber_css.is_file() or subscriber_css.stat().st_size == 0:
        print("Exact V2 mirror aborted: subscribers.css was not imported", file=sys.stderr)
        return 1

    Path(args.manifest).write_text(
        json.dumps(
            {
                "origin": origin,
                "count": len(manifest),
                "files": sorted(manifest, key=lambda item: str(item["path"])),
            },
            indent=2,
        ) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    print(f"\nExact V2 mirror captured {len(manifest)} public same-origin resources.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
