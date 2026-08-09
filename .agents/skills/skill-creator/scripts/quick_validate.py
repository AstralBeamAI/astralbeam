#!/usr/bin/env python3
"""Validate the portable Agent Skills format and an optional OpenAI adapter."""

import re
import sys
from pathlib import Path

import yaml

MAX_SKILL_NAME_LENGTH = 64
MAX_DESCRIPTION_LENGTH = 1024
MAX_COMPATIBILITY_LENGTH = 500
ALLOWED_FRONTMATTER_KEYS = {
    "allowed-tools",
    "compatibility",
    "description",
    "license",
    "metadata",
    "name",
}
PLACEHOLDER_MARKER = "[" + "TODO"
TEXT_SUFFIXES = {
    ".js",
    ".json",
    ".md",
    ".py",
    ".rb",
    ".sh",
    ".toml",
    ".ts",
    ".txt",
    ".yaml",
    ".yml",
}


def validate_openai_yaml(skill_path: Path, skill_name: str) -> tuple[bool, str]:
    metadata_path = skill_path / "agents" / "openai.yaml"
    if not metadata_path.exists():
        return True, ""

    try:
        metadata = yaml.safe_load(metadata_path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as error:
        return False, f"Invalid agents/openai.yaml: {error}"

    if not isinstance(metadata, dict):
        return False, "agents/openai.yaml must be a YAML dictionary"

    interface = metadata.get("interface")
    if not isinstance(interface, dict):
        return False, "agents/openai.yaml must contain an interface dictionary"

    display_name = interface.get("display_name")
    if not isinstance(display_name, str) or not display_name.strip():
        return False, "interface.display_name must be a non-empty string"

    short_description = interface.get("short_description")
    if not isinstance(short_description, str) or not 25 <= len(short_description.strip()) <= 64:
        return False, "interface.short_description must contain 25 to 64 characters"

    default_prompt = interface.get("default_prompt")
    if default_prompt is not None:
        if not isinstance(default_prompt, str) or not default_prompt.strip():
            return False, "interface.default_prompt must be a non-empty string"
        if f"${skill_name}" not in default_prompt:
            return False, f"interface.default_prompt must mention ${skill_name}"

    brand_color = interface.get("brand_color")
    if brand_color is not None and (
        not isinstance(brand_color, str)
        or not re.fullmatch(r"#[0-9A-Fa-f]{6}", brand_color)
    ):
        return False, "interface.brand_color must be a six-digit hex color"

    for icon_key in ("icon_small", "icon_large"):
        icon_value = interface.get(icon_key)
        if icon_value is None:
            continue
        if not isinstance(icon_value, str) or not icon_value.strip():
            return False, f"interface.{icon_key} must be a non-empty relative path"
        icon_path = Path(icon_value)
        if icon_path.is_absolute() or ".." in icon_path.parts:
            return False, f"interface.{icon_key} must stay inside the skill directory"
        if not (skill_path / icon_path).is_file():
            return False, f"interface.{icon_key} does not exist: {icon_value}"

    return True, ""


def find_placeholder(skill_path: Path) -> Path | None:
    for path in sorted(skill_path.rglob("*")):
        if (
            not path.is_file()
            or path.is_symlink()
            or path.stat().st_size > 1_000_000
            or path.suffix.lower() not in TEXT_SUFFIXES
        ):
            continue
        try:
            if PLACEHOLDER_MARKER in path.read_text(encoding="utf-8"):
                return path
        except UnicodeDecodeError:
            continue
    return None


def validate_frontmatter(frontmatter: dict, skill_path: Path) -> tuple[bool, str]:
    unexpected_keys = sorted(set(frontmatter) - ALLOWED_FRONTMATTER_KEYS)
    if unexpected_keys:
        allowed = ", ".join(sorted(ALLOWED_FRONTMATTER_KEYS))
        return False, f"Unexpected frontmatter keys: {', '.join(unexpected_keys)}. Allowed: {allowed}"

    name = frontmatter.get("name")
    if not isinstance(name, str) or not name.strip():
        return False, "Frontmatter name must be a non-empty string"
    name = name.strip()
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name):
        return False, f"Name '{name}' must use lowercase ASCII letters, digits, and single hyphens"
    if len(name) > MAX_SKILL_NAME_LENGTH:
        return False, f"Name is too long ({len(name)} characters; maximum is 64)"
    if skill_path.name != name:
        return False, f"Skill folder '{skill_path.name}' must match frontmatter name '{name}'"

    description = frontmatter.get("description")
    if not isinstance(description, str) or not description.strip():
        return False, "Frontmatter description must be a non-empty string"
    if len(description.strip()) > MAX_DESCRIPTION_LENGTH:
        return False, f"Description is too long ({len(description.strip())} characters; maximum is 1024)"

    license_value = frontmatter.get("license")
    if license_value is not None and (
        not isinstance(license_value, str) or not license_value.strip()
    ):
        return False, "License must be a non-empty string"

    compatibility = frontmatter.get("compatibility")
    if compatibility is not None:
        if not isinstance(compatibility, str) or not compatibility.strip():
            return False, "Compatibility must be a non-empty string"
        if len(compatibility) > MAX_COMPATIBILITY_LENGTH:
            return False, "Compatibility cannot exceed 500 characters"

    metadata = frontmatter.get("metadata")
    if metadata is not None:
        if not isinstance(metadata, dict):
            return False, "Frontmatter metadata must be a dictionary"
        if not all(isinstance(key, str) and isinstance(value, str) for key, value in metadata.items()):
            return False, "Frontmatter metadata must map string keys to string values"

    allowed_tools = frontmatter.get("allowed-tools")
    if allowed_tools is not None and (
        not isinstance(allowed_tools, str) or not allowed_tools.strip()
    ):
        return False, "allowed-tools must be a non-empty, space-separated string"

    valid_adapter, adapter_error = validate_openai_yaml(skill_path, name)
    if not valid_adapter:
        return False, adapter_error

    return True, ""


def validate_skill(skill_path: str | Path) -> tuple[bool, str]:
    skill_path = Path(skill_path)
    skill_md = skill_path / "SKILL.md"
    if not skill_md.is_file():
        return False, "SKILL.md not found"

    try:
        content = skill_md.read_text(encoding="utf-8")
    except OSError as error:
        return False, f"Could not read SKILL.md: {error}"

    match = re.match(r"^---\n(.*?)\n---(?:\n|$)", content, re.DOTALL)
    if not match:
        return False, "SKILL.md must start with YAML frontmatter"

    try:
        frontmatter = yaml.safe_load(match.group(1))
    except yaml.YAMLError as error:
        return False, f"Invalid YAML frontmatter: {error}"
    if not isinstance(frontmatter, dict):
        return False, "Frontmatter must be a YAML dictionary"

    valid_frontmatter, frontmatter_error = validate_frontmatter(frontmatter, skill_path)
    if not valid_frontmatter:
        return False, frontmatter_error

    if not content[match.end() :].strip():
        return False, "SKILL.md must contain Markdown instructions after frontmatter"

    placeholder = find_placeholder(skill_path)
    if placeholder:
        return False, f"Unfinished placeholder in {placeholder.relative_to(skill_path)}"

    return True, "Skill is valid!"


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python quick_validate.py <skill-directory>", file=sys.stderr)
        return 1

    valid, message = validate_skill(sys.argv[1])
    print(message)
    return 0 if valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
