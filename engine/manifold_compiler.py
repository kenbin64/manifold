"""
engine/manifold_compiler.py — The Manifold Compiler

Reads manifold.portal.json + each game's manifold.game.json, validates all
manifolds, then emits:

    dist/manifold.registry.json  — compiled game registry for the portal
    dist/deploy.manifest.json    — deployment plan read by the VPS AI

Axioms enforced:
    Manifold = Expression + Attributes + Substrate
    z = x * y  (universal access rule)
    Every game must declare x, y, z and satisfy z == x * y

Usage
-----
    python engine/manifold_compiler.py                        # compile portal
    python engine/manifold_compiler.py --validate-only        # validate, no emit
    python engine/manifold_compiler.py --game starfighter     # single game
    python engine/manifold_compiler.py --dry-run              # print plan only
    python engine/manifold_compiler.py --push                 # compile + register with tetracubedb.com
    python engine/manifold_compiler.py --push-only            # skip compile; push dist/tetracube.ingest.json
"""

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ROOT        = Path(__file__).parent.parent          # project root
PORTAL_CFG  = ROOT / "manifold.portal.json"
DIST_DIR    = ROOT / "dist"
REGISTRY    = DIST_DIR / "manifold.registry.json"
DEPLOY_MAN  = DIST_DIR / "deploy.manifest.json"
TETRA_INGEST = DIST_DIR / "tetracube.ingest.json"

# tetracubedb repo lives alongside kensgames-portal at /home/butterfly/apps/
TETRA_ENTITIES_DIR = (ROOT / ".." / ".." / "tetracubedb" / "public" / "entities").resolve()
TETRA_APP_MANIFEST = (ROOT / ".." / ".." / "tetracubedb" / "public" / "manifold.app.json").resolve()

SCHEMA_VERSION = "1.0"

# ---------------------------------------------------------------------------
# Colours (no external deps)
# ---------------------------------------------------------------------------

def _c(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if sys.stdout.isatty() else text

OK   = lambda t: _c("32", t)
WARN = lambda t: _c("33", t)
ERR  = lambda t: _c("31", t)
DIM  = lambda t: _c("2",  t)
HEAD = lambda t: _c("1;36", t)


# ---------------------------------------------------------------------------
# Loader helpers
# ---------------------------------------------------------------------------

def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(OK(f"  ✓ wrote {path.relative_to(ROOT)}"))


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

class CompilerError(Exception):
    pass


def validate_dimension(game_id: str, dim: dict) -> list[str]:
    """
    Validate that z == x * y  (universal access rule).
    Returns list of error strings (empty → valid).
    """
    errors: list[str] = []
    for key in ("x", "y", "z"):
        if key not in dim:
            errors.append(f"[{game_id}] dimension.{key} is missing")
    if errors:
        return errors
    try:
        x, y, z = int(dim["x"]), int(dim["y"]), int(dim["z"])
    except (TypeError, ValueError) as exc:
        errors.append(f"[{game_id}] dimension values must be integers: {exc}")
        return errors
    if x * y != z:
        errors.append(
            f"[{game_id}] z ≠ x*y: {z} ≠ {x}*{y} = {x*y}  (violates z = xy axiom)"
        )
    return errors


def validate_substrates(game_id: str, substrates: dict, game_path: Path) -> list[str]:
    """Warn about substrate files that are referenced but not found on disk."""
    warnings: list[str] = []
    for key, ref in substrates.items():
        if ref.startswith("shared:") or ref.startswith("inline:"):
            continue        # shared/inline substrates — skip path check
        candidate = game_path / ref
        if not candidate.exists():
            warnings.append(f"[{game_id}] substrate '{key}' → {ref} not found at {candidate}")
    return warnings


def validate_bridge(game_id: str, bridge: dict) -> list[str]:
    errors: list[str] = []
    if "entry_var" not in bridge:
        errors.append(f"[{game_id}] manifold_bridge.entry_var missing")
    if not bridge.get("exposes"):
        errors.append(f"[{game_id}] manifold_bridge.exposes is empty")
    return errors


def validate_game(game_cfg: dict, game_spec: dict) -> tuple[list[str], list[str]]:
    """
    Returns (errors, warnings).
    """
    gid    = game_spec.get("manifold", game_spec.get("id", "unknown"))
    gpath  = ROOT / game_cfg.get("path", "")
    errors: list[str] = []
    warnings: list[str] = []

    # Dimension axiom
    dim = game_spec.get("dimension", {})
    errors.extend(validate_dimension(gid, dim))

    # Substrates
    substrates = game_spec.get("substrates", {})
    warnings.extend(validate_substrates(gid, substrates, gpath))

    # Bridge
    bridge = game_spec.get("manifold_bridge", {})
    errors.extend(validate_bridge(gid, bridge))

    # Entry file exists
    entry = game_spec.get("entry", "index.html")
    if not (gpath / Path(entry).name).exists():
        warnings.append(f"[{gid}] entry file not found: {gpath / entry}")

    return errors, warnings


# ---------------------------------------------------------------------------
# Registry builder
# ---------------------------------------------------------------------------

def build_registry(portal: dict, game_specs: list[dict]) -> dict:
    """
    Emit the manifold.registry.json that the portal's arcade.js reads
    to populate the game grid and discovery algorithm.
    """
    games_out = []
    for spec in game_specs:
        dim = spec.get("dimension", {})
        games_out.append({
            "id":      spec["manifold"],
            "name":    spec["name"],
            "version": spec.get("version", "1.0.0"),
            "path":    spec.get("_portal_path", spec.get("manifold", "unknown") + "/"),
            "entry":   spec.get("entry", "index.html"),
            "lobby":   spec.get("lobby"),
            "status":  spec.get("status", "production"),
            "dimension": {
                "x": dim.get("x"),
                "y": dim.get("y"),
                "z": dim.get("z"),
            },
            "substrates": list(spec.get("substrates", {}).keys()),
            "bridge":  spec.get("manifold_bridge", {}).get("entry_var"),
            "deploy":  spec.get("deploy", {}),
        })

    return {
        "_schema":    SCHEMA_VERSION,
        "_compiled":  datetime.now(timezone.utc).isoformat(),
        "portal":     portal["name"],
        "domain":     portal["domain"],
        "dimensions": portal["dimensions"],
        "games":      games_out,
    }


# ---------------------------------------------------------------------------
# Deployment manifest builder
# ---------------------------------------------------------------------------

def build_deploy_manifest(portal: dict, game_specs: list[dict]) -> dict:
    """
    Emit deploy.manifest.json.  The VPS AI (helix) reads this file
    after a GitHub Actions push to know exactly what to deploy and how.
    """
    steps = []

    # 1. Portal static pages
    steps.append({
        "step": "deploy_portal_pages",
        "files": [p["file"] for p in portal.get("portal_pages", [])],
        "destination": portal["vps"]["deploy_path"],
        "type": "rsync"
    })

    # 2. Shared JS substrates
    steps.append({
        "step": "deploy_shared_js",
        "source": "js/",
        "destination": f"{portal['vps']['deploy_path']}/js/",
        "type": "rsync"
    })

    # 3. Auth/login pages
    steps.append({
        "step": "deploy_auth_pages",
        "source_dirs": ["login/", "register/", "forgot-password/",
                        "reset-password/", "verify-email/"],
        "destination": portal["vps"]["deploy_path"],
        "type": "rsync"
    })

    # 4. Each game
    for spec in game_specs:
        gid   = spec["manifold"]
        gdep  = spec.get("deploy", {})
        steps.append({
            "step":        f"deploy_game_{gid}",
            "source":      f"{gid}/",
            "destination": gdep.get("target", f"{portal['vps']['deploy_path']}/{gid}/"),
            "type":        "rsync",
            "excludes":    ["*.test.js", "*.sh", "manifold.game.json"]
        })

    # 5. Node server
    steps.append({
        "step":        "deploy_server",
        "source":      "server/",
        "destination": f"{portal['vps']['deploy_path']}/server/",
        "type":        "rsync"
    })

    # 6. Post-deploy commands
    steps.append({
        "step":     "post_deploy",
        "commands": portal["deploy"]["post_deploy"],
        "type":     "shell"
    })

    # 7. Compiled registry
    steps.append({
        "step":        "deploy_registry",
        "source":      "dist/manifold.registry.json",
        "destination": f"{portal['vps']['deploy_path']}/js/manifold.registry.json",
        "type":        "rsync"
    })

    return {
        "_schema":    SCHEMA_VERSION,
        "_compiled":  datetime.now(timezone.utc).isoformat(),
        "portal":     portal["name"],
        "vps":        portal["vps"],
        "steps":      steps,
        "server": portal["server"],
        "excludes":   portal["deploy"]["excludes"],
    }


# ---------------------------------------------------------------------------
# TetracubeDB ingest builder + pusher
# ---------------------------------------------------------------------------

TETRA_NAMESPACE = os.environ.get("TETRACUBE_NS", "kensgames")
TETRA_TABLE     = os.environ.get("TETRACUBE_TABLE", "games.registry")


def build_tetracube_ingest(portal: dict, game_specs: list[dict]) -> dict:
    """
    Build the tetracubedb ingest plan.  For each game registered in the portal
    we locate its authoritative entity manifest in the tetracubedb substrate
    (tetracubedb/public/entities/<id>/manifold.entity.json) and stage it as a
    cell at <ns>/<table>/<id>/manifest.  The deploy script POSTs these cells
    to the live tetracubedb API so the games.registry reflects the compile.
    """
    cells: list[dict] = []
    missing: list[str] = []

    for spec in game_specs:
        gid = spec["manifold"]
        entity_path = TETRA_ENTITIES_DIR / gid / "manifold.entity.json"
        if not entity_path.exists():
            missing.append(f"{gid} → {entity_path}")
            continue
        entity = load_json(entity_path)
        cells.append({
            "row":   gid,
            "col":   "manifest",
            "value": entity,
        })

    # App-level manifest (optional — tetracubedb root config)
    app_cells = []
    if TETRA_APP_MANIFEST.exists():
        app_cells.append({
            "row":   "tetracubedb",
            "col":   "manifold",
            "value": load_json(TETRA_APP_MANIFEST),
        })

    if missing:
        for m in missing:
            print(WARN(f"  ⚠  tetracubedb entity manifest missing: {m}"))

    return {
        "_schema":   SCHEMA_VERSION,
        "_compiled": datetime.now(timezone.utc).isoformat(),
        "namespace": TETRA_NAMESPACE,
        "table":     TETRA_TABLE,
        "cells":     cells,
        "app_table": "app.registry",
        "app_cells": app_cells,
    }


def push_tetracube_ingest(ingest: dict | None = None) -> bool:
    """
    POST each cell in dist/tetracube.ingest.json to the tetracubedb /v1/cell API.
    Reads creds from environment:
        TETRACUBE_URL         (default: https://tetracubedb.com)
        TETRACUBE_CLIENT_ID   (required)
        TETRACUBE_API_KEY     (required)
        TETRACUBE_NS          (default: kensgames)
    Graceful no-op when creds are absent so deploys don't fail when the
    registration channel isn't configured.
    """
    if ingest is None:
        if not TETRA_INGEST.exists():
            print(WARN(f"  ⚠  tetracube.ingest.json not found; run compile first"))
            return False
        ingest = load_json(TETRA_INGEST)

    client_id = os.environ.get("TETRACUBE_CLIENT_ID", "").strip()
    api_key   = os.environ.get("TETRACUBE_API_KEY", "").strip()
    base_url  = os.environ.get("TETRACUBE_URL", "https://tetracubedb.com").rstrip("/")
    ns        = os.environ.get("TETRACUBE_NS", ingest.get("namespace", TETRA_NAMESPACE))

    if not client_id or not api_key:
        print(WARN("  ⚠  TETRACUBE_CLIENT_ID / TETRACUBE_API_KEY not set — skipping registration"))
        print(DIM( "     (games were compiled but not pushed to tetracubedb.com)"))
        return True

    headers = {
        "Authorization": f"Bearer {client_id}:{api_key}",
        "Content-Type":  "application/json",
    }

    def post_cell(table: str, row: str, col: str, value: dict) -> bool:
        url = f"{base_url}/v1/cell/{ns}/{table}/{row}/{col}"
        body = json.dumps({"value": value}).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                resp.read()
                return 200 <= resp.status < 300
        except urllib.error.HTTPError as e:
            print(ERR(f"    ✗ {row}/{col} → HTTP {e.code}: {e.reason}"))
        except urllib.error.URLError as e:
            print(ERR(f"    ✗ {row}/{col} → {e.reason}"))
        except Exception as e:
            print(ERR(f"    ✗ {row}/{col} → {e}"))
        return False

    print(HEAD(f"\n  Ingesting into tetracubedb @ {base_url}  (ns={ns})"))
    ok_count = 0
    fail_count = 0
    for cell in ingest.get("cells", []):
        if post_cell(ingest.get("table", TETRA_TABLE), cell["row"], cell["col"], cell["value"]):
            print(OK(f"    ✓ {ingest.get('table')}/{cell['row']}/{cell['col']}"))
            ok_count += 1
        else:
            fail_count += 1

    for cell in ingest.get("app_cells", []):
        if post_cell(ingest.get("app_table", "app.registry"), cell["row"], cell["col"], cell["value"]):
            print(OK(f"    ✓ {ingest.get('app_table')}/{cell['row']}/{cell['col']}"))
            ok_count += 1
        else:
            fail_count += 1

    print(OK(f"  {ok_count} registered") + (ERR(f" · {fail_count} failed") if fail_count else ""))
    return fail_count == 0


# ---------------------------------------------------------------------------
# Main compiler entry point
# ---------------------------------------------------------------------------

def compile_portal(
    validate_only: bool = False,
    game_filter:   str | None = None,
    dry_run:       bool = False,
) -> bool:
    """
    Run the full compiler pass.  Returns True on success.
    """
    print(HEAD("\n🜂 Manifold Compiler — kensgames.com\n" + "=" * 44))

    # Load portal config
    if not PORTAL_CFG.exists():
        print(ERR(f"✗ manifold.portal.json not found at {PORTAL_CFG}"))
        return False
    portal = load_json(PORTAL_CFG)
    print(OK(f"  ✓ portal config: {portal['name']} v{portal['version']}"))

    # Load game manifests
    game_cfgs = [g for g in portal.get("games", [])
                 if game_filter is None or g["id"] == game_filter]

    all_errors:   list[str] = []
    all_warnings: list[str] = []
    game_specs:   list[dict] = []

    for gcfg in game_cfgs:
        manifold_path = ROOT / gcfg["manifold"]
        if not manifold_path.exists():
            all_errors.append(f"[{gcfg['id']}] manifold.game.json not found: {manifold_path}")
            continue
        spec = load_json(manifold_path)
        spec['_portal_path'] = gcfg.get('path', spec.get('manifold', gcfg['id']) + '/')
        game_specs.append(spec)

        errors, warnings = validate_game(gcfg, spec)
        all_errors.extend(errors)
        all_warnings.extend(warnings)

        status = OK("✓") if not errors else ERR("✗")
        print(f"  {status} {spec['name']} ({spec.get('version', '?')})  "
              f"z={spec['dimension'].get('z', '?')}")

    # Report
    print()
    if all_warnings:
        for w in all_warnings:
            print(WARN(f"  ⚠  {w}"))
    if all_errors:
        for e in all_errors:
            print(ERR(f"  ✗  {e}"))
        print(ERR(f"\n  {len(all_errors)} error(s). Compilation failed.\n"))
        return False

    print(OK(f"  All {len(game_specs)} game manifolds valid."))

    if validate_only or dry_run:
        if dry_run:
            print(DIM("\n  [dry-run] would emit:"))
            print(DIM(f"    {REGISTRY.relative_to(ROOT)}"))
            print(DIM(f"    {DEPLOY_MAN.relative_to(ROOT)}"))
        print()
        return True

    # Emit artifacts
    print(HEAD("\n  Emitting artifacts…"))
    registry = build_registry(portal, game_specs)
    save_json(REGISTRY, registry)

    manifest = build_deploy_manifest(portal, game_specs)
    save_json(DEPLOY_MAN, manifest)

    ingest = build_tetracube_ingest(portal, game_specs)
    save_json(TETRA_INGEST, ingest)

    print(OK(f"\n  Compilation complete — {len(game_specs)} games registered.\n"))
    return True


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Manifold Compiler — kensgames.com")
    parser.add_argument("--validate-only", action="store_true",
                        help="Validate manifolds without emitting artifacts")
    parser.add_argument("--game", metavar="ID",
                        help="Compile / validate a single game by id")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would be emitted without writing files")
    parser.add_argument("--push", action="store_true",
                        help="Compile, then push ingest to tetracubedb.com")
    parser.add_argument("--push-only", action="store_true",
                        help="Skip compile; push existing dist/tetracube.ingest.json")
    args = parser.parse_args()

    if args.push_only:
        sys.exit(0 if push_tetracube_ingest() else 1)

    success = compile_portal(
        validate_only=args.validate_only,
        game_filter=args.game,
        dry_run=args.dry_run,
    )
    if success and args.push and not (args.validate_only or args.dry_run):
        success = push_tetracube_ingest()
    sys.exit(0 if success else 1)
