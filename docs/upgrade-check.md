# Upgrade and downgrade check (#30)

Status: **not run yet.** Fill in date, build ids and results when the check is done. Use generated demo vaults only, never a real vault.

## Builds

| | Commit | `main.js` SHA-256 |
| --- | --- | --- |
| 1.0.0 (tag `1.0.0`) | | |
| 2.0 (`v2`) | | |

## 1. Upgrade from 1.0

1. Check out tag `1.0.0`, build, generate a demo vault with `node scripts/smoke/demo-vault.mjs <empty-folder>`, install the 1.0 build, start a timer, close Obsidian.
2. Hash every file: `find <vault> -type f -not -path '*/.obsidian/workspace*' -exec shasum -a 256 {} + | sort -k2 > before.txt`.
3. Install the 2.0 build, open the vault, visit every tab, close Obsidian without any action.
4. Hash again into `after.txt` and `diff before.txt after.txt`.

Expected: only `Questlog/Vision.md` is new (when the vision setting was set) and `data.json` gained new keys. No quest, day, review or `Other.md` note changed. The running timer continues.

Then one action of each kind (add a task, finish a task, log a session, answer a review) and check with `git diff --no-index` that only the expected lines changed.

| Check | Result |
| --- | --- |
| Only expected files changed on open | |
| Timer survived | |
| Add task: one line added | |
| Finish task: one line changed | |
| Log session: one line added | |
| Answer review: review file only | |

## 2. Downgrade to 1.0

Take the vault after a 2.0 session with stages, a started and closed day, a planned week, a month review and a check-in. Install the 1.0.0 build and open it.

Expected: all tasks and sessions listed, timers work, no console error, no file rewritten on open (hashes as above). Accepted: no vision on Home, stages not shown, month, quarter and year reviews ignored.

| Check | Result |
| --- | --- |
| Tasks and sessions visible | |
| No console errors | |
| No file rewritten on open | |

## 3. minAppVersion

Audit of the APIs used by 2.0 against the `@since` tags in `node_modules/obsidian/obsidian.d.ts` (done 2026-11-25):

- `PluginSettingTab.getSettingDefinitions` (1.13.0) is the only newer API. Older Obsidian never calls it and uses `display()`, which renders the same rows, so it is guarded by design.
- `SettingDefinition` and `SettingDefinitionItem` are type imports only.
- Everything else (`processFrontMatter` 1.4.4, `onExternalSettingsChange` 1.5.7, `setTooltip` 1.1.1, `Modal.setTitle`, `SuggestModal`, `Platform`, `el.win` / `el.doc`) is older than 1.7.2.
- CSS: 2.0 adds `:has()` and container queries (Chromium 105, iOS 16). 1.0 already used `color-mix()` (Chromium 111, iOS 16.2), so the requirement does not rise.

Decision: `minAppVersion` stays **1.7.2**; `manifest.json` and `versions.json` need no change beyond the version number.
