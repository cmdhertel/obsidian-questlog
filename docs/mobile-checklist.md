# Mobile checklist (#29)

The smoke run (`npm run smoke`, step `phone-fit`) checks the measurable part in Obsidian's phone emulation at 420 and 320 px, on every tab, in English and German:

- no horizontal page scroll;
- every visible button, `[role=button]`, select and checkbox is at least 44 × 44 px (a checkbox counts with its label);
- every text input, text area and select uses at least 16 px text.

Everything below is manual, on real devices. Tick per device and note the date and the build (`git rev-parse --short HEAD`).

## Setup

Build with `npm run build`. Copy `main.js`, `manifest.json` and `styles.css` into `.obsidian/plugins/questlog/` of a **copy of a demo vault** (`node scripts/smoke/demo-vault.mjs <empty-folder>`), sync it to the phone, and reload the plugin. Never test writing actions in a real vault.

| | Small iPhone (≈375 px, notch) | Large phone (≈430 px) |
| --- | --- | --- |
| Device, OS, Obsidian version | | |
| Light theme | [ ] | [ ] |
| Dark theme | [ ] | [ ] |
| English | [ ] | [ ] |
| German | [ ] | [ ] |
| Portrait | [ ] | [ ] |
| Landscape | [ ] | [ ] |
| Font size default | [ ] | [ ] |
| Font size one step larger | [ ] | [ ] |

## Every tab

- [ ] No horizontal page scroll at 320 px; no text cut off; long task names and German compound words wrap.
- [ ] Every control is easy to hit (44 × 44 px); nothing needs hover or a long press.
- [ ] The task menu offers **Move to**, since drag and drop does not work on touch.
- [ ] Tapping a text field does not zoom the page (16 px text).
- [ ] Focus rings stay visible in the dark theme.

## Modals

- [ ] Session, quest, Start box, vision and ritual dialogs are fully visible with the keyboard open and can be closed.
- [ ] In landscape on the small phone, a long dialog scrolls inside itself.
- [ ] Start box: the quest button sits right above the keyboard; the keyboard's return key says *Go*; the first letter is capitalised.

## Home

- [ ] Quest cards unfold on tap; the play button starts the timer without unfolding the card.
- [ ] The ritual line fits on two lines.
- [ ] The task checkbox is easy to hit and does not open the task.

## Quest page

- [ ] The stage path scrolls or wraps; the week dots keep their size and labels.
- [ ] The story pages load more on tap.

## Plan

- [ ] Days are stacked; the backlog folds when it is long.
- [ ] Backlog search keeps the keyboard open while typing; the quest chips filter; the clear button empties the field.

## Calendar

- [ ] The Day view is the default on the phone; the seven-day strip is tappable (it scrolls sideways on very narrow screens).
- [ ] Blocks and list rows open the session; gaps (#10) are tappable.
- [ ] Switching to Week and back is remembered.

## Review

- [ ] Long text areas scroll inside the page; month, quarter and year switch.
- [ ] The year table scrolls sideways inside its card, not the page.

## Focus

- [ ] The clock is readable; zen mode has a visible exit (no Escape needed).
- [ ] A running timer survives Obsidian reloading the plugin on resume.

## Capture bar (#28)

- [ ] Start, Continue and Add sit above the home indicator and Obsidian's navigation bar.
- [ ] The bar hides while the keyboard is open, while a timer runs, and on Focus.
- [ ] Add, type a task, choose a quest with the button: the task lands on today in that quest, with a short notice.

## Gestures

- [ ] Horizontal scrollers (week strip, year table, plan board on mid widths) do not trigger Obsidian's swipe to open a sidebar.
- [ ] Pull to refresh does not trigger by accident.

## Screen reader

- [ ] VoiceOver or TalkBack on Home and one quest page: every button has a name, the week dots read their labels, the ritual line comes first.

## Deliberately not fixed

- **Drag and drop on touch.** The Plan board uses HTML drag and drop, which mobile browsers do not support; **Move to** in the task menu is the touch path.
- **Plan board on a phone.** The days stack instead of forming a board; there is no swipe between days.
- **Calendar week view on a phone.** It stays available but is cramped; the day view is the default there.
- **Tablet layouts.** Tablets use the mid layout (560 to 880 px); there is no tablet-specific design.
- **Phone emulation is a precheck.** The smoke run uses Obsidian's internal emulation on a desktop Chromium; safe areas, the real keyboard and gestures only show on a device.
