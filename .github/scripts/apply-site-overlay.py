#!/usr/bin/env python3
"""Apply the intentionally local PuzzleVerse website overlay.

The mirror remains byte-identical to the source through the browser comparison.
Only after that audit passes do we:
1. append the existing PuzzleVerse Privacy Policy link to the footer; and
2. restore the already-published /puzzleverse-privacy/ page.

No source markup is reparsed or reserialized.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


PRIVACY_HREF = b"/puzzleverse-privacy/"
PRIVACY_LINK = b'<a href="/puzzleverse-privacy/">Privacy Policy</a>'
FOOTER_CLOSE = b"</footer>"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", required=True)
    parser.add_argument("--privacy-source", required=True)
    args = parser.parse_args()

    site = Path(args.site)
    index = site / "index.html"
    privacy_source = Path(args.privacy_source)

    if not index.is_file():
        raise SystemExit("Overlay aborted: mirrored index.html is missing.")
    if not privacy_source.is_file() or privacy_source.stat().st_size == 0:
        raise SystemExit("Overlay aborted: PuzzleVerse privacy policy source is missing.")

    body = index.read_bytes()

    if PRIVACY_HREF not in body:
        close_count = body.count(FOOTER_CLOSE)
        if close_count != 1:
            raise SystemExit(
                f"Overlay aborted: expected exactly one </footer>, found {close_count}."
            )
        body = body.replace(FOOTER_CLOSE, PRIVACY_LINK + FOOTER_CLOSE, 1)
        index.write_bytes(body)

    privacy_target = site / "puzzleverse-privacy" / "index.html"
    privacy_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(privacy_source, privacy_target)

    final = index.read_bytes()
    if final.count(PRIVACY_HREF) != 1:
        raise SystemExit("Overlay aborted: privacy footer link is missing or duplicated.")
    if privacy_target.read_bytes() != privacy_source.read_bytes():
        raise SystemExit("Overlay aborted: privacy policy was not copied byte-for-byte.")

    print("Privacy footer overlay applied.")
    print("Footer: /puzzleverse-privacy/")
    print("Policy page copied byte-for-byte from repository source.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
