# lifeadmin-daily-note

Obsidian Daily Note template using **Templater**, **Tasks**, and **DataviewJS**.

## Goal

Replace slow live Dataview dashboard widgets (weather, workouts, weight, habits) with **static HTML baked in at note creation**, refreshable on button click.

## How it works

1. **At note creation** — Templater includes fetch live data once and write static HTML between markers:
   - `<!-- dashboard:weather:start/end -->`
   - `<!-- dashboard:hevy:start/end -->`
   - `<!-- dashboard:weight:start/end -->`
   - `<!-- dashboard:habits:start/end -->`

2. **On note open** — No vault scans for dashboard data. One lightweight `dataviewjs` block only attaches click handlers to the preview.

3. **On ↻ click** — Handler re-queries sources, replaces the marker block in the note file, and refreshes Dataview.

4. **On action click** — Existing behaviour preserved (Hevy create dialog, weigh-in shortcut, habit log modal).

## Plugins required

- [Templater](https://github.com/SilentVoid13/Templater)
- [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks)
- [Dataview](https://github.com/blacksmithgu/obsidian-dataview)

## Template files

| File | Purpose |
|---|---|
| `templates/TEM_Daily Note.md` | Main daily note template |
| `templates/Formatting/TEM_Dashboard_Bake_*.md` | Bake static widget HTML at creation |
| `templates/Formatting/TEM_Dashboard_Handlers.md` | Click-only DataviewJS handler |
| `templates/Formatting/TEM_Weather.md` | Legacy weather FM updater (superseded by bake) |
| `fixtures/` | Sample data files for development |

## Vault paths expected

- `Z_Personal admin/Exercise/Workouts/Hevy Log.md`
- `Z_Personal admin/Domestic God/🩺 Health/Weight_Data.md`
- `Z_Personal admin/Habits/` (habit notes)

## Install in Obsidian

Copy `templates/` contents into your vault's `Templates/` folder, preserving paths under `Templates/Formatting/`.
