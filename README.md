# lifeadmin-daily-note

Obsidian plugin + daily note template using **Templater**, **Tasks**, and **Dataview**.

## Goal

Replace slow live Dataview dashboard widgets (weather, workouts, weight, habits) with **static HTML baked in at note creation**, refreshable on button click via the plugin post-processor.

## How it works

1. **At note creation** — Templater user scripts call the plugin API to fetch live data once and write static HTML between markers:
   - `<!-- dashboard:weather:start/end -->`
   - `<!-- dashboard:hevy:start/end -->`
   - `<!-- dashboard:weight:start/end -->`
   - `<!-- dashboard:habits:start/end -->`

2. **On note open** — No vault scans for dashboard data. The plugin post-processor attaches click handlers to `.dashboard-widget` and `[data-action]` elements in the preview.

3. **On ↻ click** — Handler re-queries sources, replaces the marker block in the note file, and refreshes Dataview.

4. **On action click** — Hevy create dialog, weigh-in/sync shortcuts, habit log modal (same behaviour as the legacy handlers template).

## Plugins required

- [Templater](https://github.com/SilentVoid13/Templater)
- [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks)
- [Dataview](https://github.com/blacksmithgu/obsidian-dataview)

## Install in Obsidian

1. Clone this repo into your vault plugins folder:
   ```bash
   git clone <repo-url> .obsidian/plugins/lifeadmin-daily-note
   ```
2. Build the plugin:
   ```bash
   cd .obsidian/plugins/lifeadmin-daily-note
   npm install
   npm run build
   ```
3. Enable **LifeAdmin Daily Note** in Obsidian → Settings → Community plugins.
4. Configure API keys and vault paths in the plugin settings tab.
5. **Templater user scripts** (required on every device, including iPhone):
   - In Templater settings, set **User script functions folder** to `Templates/Templater User Scripts` (or another folder that syncs to mobile — avoid `Attachments/` if that folder is excluded from sync).
   - Run the plugin command **Install Templater user scripts** once on each device, or use **Install scripts now** in the plugin settings. This copies `bake_*.js`, `bake_gcal.js`, `bake_project_header.js`, and `note_date.js` from the plugin bundle into that folder.
   - In Templater → **Folder templates**, map `Diaries` to `Templates/Formatting/TEM_Daily Note.md` (not the weekly template). Keep `Diaries/Weekly` on the weekly layout template.
   - The plugin also auto-installs missing scripts on startup when it can.
6. Point your daily note template at the vault copy of `templates/TEM_Daily Note.md` (copy `templates/` into your vault `Templates/` folder, preserving paths).

## Templater usage

The daily note template calls:

```javascript
<% tp.user.bake_weather(tp) %>
<% tp.user.bake_hevy(tp) %>
<% tp.user.bake_weight(tp) %>
<% tp.user.bake_habits(tp) %>
```

These require the four `bake_*.js` files in your Templater user scripts folder and the plugin enabled.

## Mobile (iPhone)

If the daily note template works on desktop but not on iPhone:

1. Confirm **LifeAdmin Daily Note** and **Templater** are enabled under Community plugins on the phone.
2. In Templater settings on the phone, check **User script functions folder** matches desktop (recommended: `Templates/Templater User Scripts`).
3. In Files, verify the four `bake_*.js` files exist in that folder on the phone. If not, run **Install Templater user scripts** from the command palette on the phone.
4. Avoid storing scripts only under `Attachments/` — many sync setups skip large attachment folders on mobile.

## Plugin commands

- **Refresh all dashboard widgets** — Re-bakes all four widgets on the active daily note.
- **Install Templater user scripts** — Copies bundled `bake_*.js` files into your Templater scripts folder.
- **Copy recommended Templater scripts folder** — Copies `Templates/Templater User Scripts` for Templater settings.

## Vault paths (defaults)

Configurable in plugin settings:

- `Z_Personal admin/Exercise/Workouts/Hevy Log.md`
- `Z_Personal admin/Domestic God/🩺 Health/Weight_Data.md`
- `Z_Personal admin/Habits/` (habit notes)
- `Z_Personal admin/Habits/Habits.md` (habits index)

## Development

```bash
npm install
npm run dev    # watch build
npm run build  # production build → main.js
```

`fixtures/` contains sample vault data for local testing.

## Legacy templates

`templates/Formatting/TEM_Dashboard_Bake_*.md` and `TEM_Dashboard_Handlers.md` are superseded by the plugin but kept for reference.
