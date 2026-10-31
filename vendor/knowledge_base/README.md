# CDDA Knowledge Base

The knowledge base captures critical early-game information for Cataclysm: Dark Days Ahead to guide AI reasoning and player support. Files are organized for quick lookup, JSON parsing, and markdown reference.

## Directory Layout

- `mechanics/` — JSON dossiers for core survival systems (thirst, hunger, health, fatigue, morale)
- `keybindings/` — Comprehensive control reference including context-sensitive actions
- `items/` — Early-game catalogs grouped by utility:
  - `water_sources.json` — Clean and dirty hydration options with quench data
  - `food_items.json` — Portable calorie sources and morale notes
  - `tools_basic.json` — Foundational tools, primitive weapons, and storage gear
  - `materials_basic.json` — Scavenged inputs (sticks, cordage, fasteners, abrasives)
- `recipes/` — Crafting recipes for essential survival equipment
- `guides/` — Curated markdown guides covering survival priorities and tactics

Add `.gitkeep` files to empty directories so that structure remains in version control when new data has not yet been authored.

## File Formats

### Mechanics, Keybindings, Items, Recipes

JSON assets follow the schema in `docs/tech-spec-epic-2.md` Section 3.1:

- Top-level fields: `topic`, `tags`, `summary`, `details`
- `details` stores typed collections (lists or objects) that downstream tooling index directly
- Keys stay in `snake_case`; values prefer primitive types and small nested objects
- When a JSON file is regenerated programmatically, ensure code preserves ordering for diff clarity

Before committing JSON changes, validate with `python -m json.tool <file>` or an equivalent schema check.

### Guides

Markdown guides should follow GitHub-flavored markdown with clear headings, actionable bullet lists, and concise paragraphs (<120 words each). Focus on early-game decisions and reference relevant JSON entries when possible.

## Contribution Workflow

1. Create or update JSON/MD files within the appropriate directory.
2. Run project linters and tests (`pytest` by default) to confirm data quality checks pass.
3. Run `pytest tests/validation/test_knowledge_quality.py` to guarantee acceptance questions stay green.
4. Update `VALIDATION_REPORT.md` with the latest execution date and aggregated results.
5. Record file additions or schema changes in `CHANGELOG.md` to maintain historical traceability.
6. Ensure acceptance criteria in the active story are met before marking tasks complete.

## Query Example

```python
from pathlib import Path
import json

KB_ROOT = Path(__file__).resolve().parents[1] / \"data\" / \"knowledge_base\"
recipes = json.loads((KB_ROOT / \"recipes\" / \"early_game_crafting.json\").read_text())
stone_axe = next(r for r in recipes[\"details\"][\"recipes\"] if r[\"result\"] == \"primitive_axe\")
print(stone_axe[\"components\"])
```

## Maintenance Guidelines

- **Update cadence**: re-ingest CDDA JSON after upstream stable releases or when in-game recipes change materially.
- **Version bumps**: increment changelog entries whenever fields are added or removed to aid downstream consumers.
- **Backup raw sources**: note the Cataclysm build/date used when regenerating knowledge so discrepancies can be traced.
- **Validation discipline**: never merge changes unless the validation test suite passes locally and `VALIDATION_REPORT.md` reflects the run.
