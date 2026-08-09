#!/usr/bin/env python3
"""Create a concise, portable Agent Skill scaffold."""

import argparse
import re
import sys
from pathlib import Path

from generate_openai_yaml import write_openai_yaml

MAX_SKILL_NAME_LENGTH = 64
ALLOWED_RESOURCES = {"scripts", "references", "assets"}
PLACEHOLDER_MARKER = "[" + "TODO"

SKILL_TEMPLATE = """---
name: {skill_name}
description: "{todo}: State what this skill enables and the user intents or situations that should trigger it.]"
---

# {skill_title}

## Outcome

{todo}: State the reusable outcome in one sentence.]

## Workflow

1. {todo}: Start with the first decision or action.]
2. {todo}: Add only steps an agent would not reliably infer.]
3. {todo}: End with verification or recovery.]

## Guardrails

- {todo}: Keep only non-obvious safety, permission, or edge-case constraints; delete this section if none apply.]
"""

EXAMPLE_SCRIPT = '''#!/usr/bin/env python3
"""{todo}: Replace or remove this non-interactive helper.]"""

import sys


def main() -> int:
    print("Replace scripts/example.py with a real helper.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
'''

EXAMPLE_REFERENCE = """# {skill_title} reference

{todo}: Replace this file with conditional detail and link it directly from SKILL.md, or remove it.]
"""

EXAMPLE_ASSET = """{todo}: Replace this placeholder with an asset used in the skill's output, or remove it.]
"""


def normalize_skill_name(skill_name: str) -> str:
    """Normalize a skill name to lowercase hyphen-case."""
    normalized = re.sub(r"[^a-z0-9]+", "-", skill_name.strip().lower())
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-")
    return normalized


def title_case_skill_name(skill_name: str) -> str:
    """Convert a hyphenated name to a display title."""
    return " ".join(word.capitalize() for word in skill_name.split("-"))


def parse_resources(raw_resources: str) -> list[str]:
    if not raw_resources:
        return []

    resources = [item.strip() for item in raw_resources.split(",") if item.strip()]
    invalid = sorted({item for item in resources if item not in ALLOWED_RESOURCES})
    if invalid:
        allowed = ", ".join(sorted(ALLOWED_RESOURCES))
        raise ValueError(f"Unknown resource type(s): {', '.join(invalid)}. Allowed: {allowed}")

    return list(dict.fromkeys(resources))


def create_resource_dirs(
    skill_dir: Path,
    skill_name: str,
    resources: list[str],
    include_examples: bool,
) -> None:
    skill_title = title_case_skill_name(skill_name)
    for resource in resources:
        resource_dir = skill_dir / resource
        resource_dir.mkdir()
        if not include_examples:
            print(f"[OK] Created {resource}/")
            continue

        if resource == "scripts":
            example_path = resource_dir / "example.py"
            example_path.write_text(
                EXAMPLE_SCRIPT.format(todo=PLACEHOLDER_MARKER),
                encoding="utf-8",
            )
            example_path.chmod(0o755)
        elif resource == "references":
            example_path = resource_dir / "reference.md"
            example_path.write_text(
                EXAMPLE_REFERENCE.format(
                    skill_title=skill_title,
                    todo=PLACEHOLDER_MARKER,
                ),
                encoding="utf-8",
            )
        else:
            example_path = resource_dir / "example_asset.txt"
            example_path.write_text(
                EXAMPLE_ASSET.format(todo=PLACEHOLDER_MARKER),
                encoding="utf-8",
            )
        print(f"[OK] Created {example_path.relative_to(skill_dir)}")


def init_skill(
    skill_name: str,
    output_root: Path,
    resources: list[str],
    include_examples: bool,
    openai_interface: list[str],
) -> Path:
    """Initialize a portable skill, with optional OpenAI presentation metadata."""
    skill_dir = output_root.resolve() / skill_name
    if skill_dir.exists():
        raise FileExistsError(f"Skill directory already exists: {skill_dir}")

    skill_dir.mkdir(parents=True)
    skill_title = title_case_skill_name(skill_name)
    (skill_dir / "SKILL.md").write_text(
        SKILL_TEMPLATE.format(
            skill_name=skill_name,
            skill_title=skill_title,
            todo=PLACEHOLDER_MARKER,
        ),
        encoding="utf-8",
    )
    print(f"[OK] Created {skill_dir}")
    print("[OK] Created SKILL.md")

    if openai_interface:
        if not write_openai_yaml(skill_dir, skill_name, openai_interface):
            raise ValueError("Could not create the optional OpenAI adapter")
    else:
        print("[OK] No client adapter created")

    create_resource_dirs(skill_dir, skill_name, resources, include_examples)
    return skill_dir


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Create a portable Agent Skill scaffold.",
    )
    parser.add_argument("skill_name", help="Skill name, normalized to hyphen-case")
    parser.add_argument("--path", required=True, type=Path, help="Parent output directory")
    parser.add_argument(
        "--resources",
        default="",
        help="Comma-separated list chosen from scripts,references,assets",
    )
    parser.add_argument(
        "--examples",
        action="store_true",
        help="Add removable placeholders inside selected resource directories",
    )
    parser.add_argument(
        "--openai-interface",
        "--interface",
        dest="openai_interface",
        action="append",
        default=[],
        metavar="KEY=VALUE",
        help="Create optional agents/openai.yaml metadata; repeat for each interface field",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    skill_name = normalize_skill_name(args.skill_name)
    if not skill_name:
        print("[ERROR] Skill name must include at least one ASCII letter or digit.", file=sys.stderr)
        return 1
    if len(skill_name) > MAX_SKILL_NAME_LENGTH:
        print(
            f"[ERROR] Normalized name is {len(skill_name)} characters; maximum is 64.",
            file=sys.stderr,
        )
        return 1
    if skill_name != args.skill_name:
        print(f"[INFO] Normalized '{args.skill_name}' to '{skill_name}'.")

    try:
        resources = parse_resources(args.resources)
        if args.examples and not resources:
            raise ValueError("--examples requires --resources")
        skill_dir = init_skill(
            skill_name,
            args.path,
            resources,
            args.examples,
            args.openai_interface,
        )
    except (FileExistsError, OSError, ValueError) as error:
        print(f"[ERROR] {error}", file=sys.stderr)
        return 1

    print(f"\n[OK] Initialized portable skill at {skill_dir}")
    print("Next: replace every TODO, add only necessary resources, validate, and run a realistic smoke test.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
