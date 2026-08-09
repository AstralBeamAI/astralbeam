#!/usr/bin/env python3
"""Create a validated, distributable .skill archive."""

import fnmatch
import sys
import tempfile
import zipfile
from pathlib import Path

from quick_validate import validate_skill

EXCLUDED_DIRS = {".git", "__pycache__", "node_modules"}
EXCLUDED_FILES = {".DS_Store"}
EXCLUDED_GLOBS = {"*.pyc"}
ROOT_EXCLUDED_DIRS = {"evals"}


def should_exclude(relative_path: Path) -> bool:
    parts = relative_path.parts
    if any(part in EXCLUDED_DIRS for part in parts):
        return True
    if len(parts) > 1 and parts[1] in ROOT_EXCLUDED_DIRS:
        return True
    if relative_path.name in EXCLUDED_FILES:
        return True
    return any(fnmatch.fnmatch(relative_path.name, pattern) for pattern in EXCLUDED_GLOBS)


def package_skill(skill_path: Path, output_directory: Path) -> Path:
    skill_path = skill_path.resolve()
    output_directory = output_directory.resolve()

    if not skill_path.is_dir():
        raise ValueError(f"Skill directory not found: {skill_path}")

    valid, message = validate_skill(skill_path)
    if not valid:
        raise ValueError(f"Skill validation failed: {message}")

    archive_path = output_directory / f"{skill_path.name}.skill"
    if skill_path == output_directory or skill_path in archive_path.parents:
        raise ValueError("Output directory must be outside the skill directory")

    files_to_archive = []
    for file_path in sorted(skill_path.rglob("*")):
        if file_path.is_symlink():
            raise ValueError(f"Skill archives cannot contain symlinks: {file_path}")
        if not file_path.is_file():
            continue
        relative_path = file_path.relative_to(skill_path.parent)
        if not should_exclude(relative_path):
            files_to_archive.append((file_path, relative_path))

    output_directory.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=output_directory,
        prefix=f".{skill_path.name}.",
        suffix=".skill.tmp",
        delete=False,
    ) as temporary_file:
        temporary_path = Path(temporary_file.name)

    try:
        with zipfile.ZipFile(temporary_path, "w", zipfile.ZIP_DEFLATED) as archive:
            for file_path, relative_path in files_to_archive:
                archive.write(file_path, relative_path)
        temporary_path.replace(archive_path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise

    return archive_path


def main() -> int:
    if len(sys.argv) not in (2, 3):
        print("Usage: python package_skill.py <skill-directory> [output-directory]", file=sys.stderr)
        return 1

    skill_path = Path(sys.argv[1])
    output_directory = Path(sys.argv[2]) if len(sys.argv) == 3 else Path.cwd()

    try:
        archive_path = package_skill(skill_path, output_directory)
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    print(f"Packaged skill: {archive_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
