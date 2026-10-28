"""Preserve the operator's private environment before the backend directory rename.

Never print file contents, overwrite a different environment, remove the legacy
copy, or touch Docker/database state. The default command only inspects.
"""
import argparse
import json
import os
import stat
from pathlib import Path


class LayoutError(Exception):
    pass


def private_bytes(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise LayoutError("Environment must be an owner-only regular file owned by the deployment user.")
        return stream.read()


def prepare(root, *, apply=False):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise LayoutError("A regular deployment directory is required.")
    legacy_dir, current_dir = root / "ilbi", root / "backend"
    for directory in (legacy_dir, current_dir):
        if directory.is_symlink() or directory.exists() and not directory.is_dir():
            raise LayoutError("Environment directories must not be symbolic links.")
    legacy, current = legacy_dir / ".env.production", current_dir / ".env.production"
    old_data = private_bytes(legacy) if legacy.exists() or legacy.is_symlink() else None
    new_data = private_bytes(current) if current.exists() or current.is_symlink() else None
    if new_data is not None:
        if old_data is not None and old_data != new_data:
            raise LayoutError("Legacy and current environment files differ; neither file was changed.")
        return {"ready": True, "copied": False, "legacy_preserved": old_data is not None}
    if old_data is None:
        raise LayoutError("Neither layout has a private backend environment file.")
    if not apply:
        return {"ready": False, "copy_required": True, "legacy_preserved": True}
    current_dir.mkdir(mode=0o700, exist_ok=True)
    fd = os.open(current, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(old_data)
            stream.flush()
            os.fsync(stream.fileno())
        if private_bytes(current) != old_data:
            raise LayoutError("Environment copy verification failed; legacy file is preserved.")
    except BaseException:
        current.unlink(missing_ok=True)
        raise
    return {"ready": True, "copied": True, "legacy_preserved": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.root, apply=args.apply)))
    except (LayoutError, OSError) as error:
        if isinstance(error, LayoutError):
            parser.exit(1, str(error) + "\n")
        parser.exit(1, "Backend environment preparation failed; no environment contents were printed.\n")


if __name__ == "__main__":
    main()
