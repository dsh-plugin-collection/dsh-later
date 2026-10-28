<div align="center">

<img src="assets/icons/icon-presence-scheduled.svg?v=18" width="64" alt="scheduled"/>
<img src="assets/icons/icon-presence-urgent.svg?v=18" width="64" alt="urgent"/>
<img src="assets/icons/icon-presence-overdue.svg?v=18" width="64" alt="overdue"/>

# dsh-later — In-Session Scheduled Message Plugin

[中文](./README.md) | **English**

</div>

> Set reminders for yourself inside DSH: **set by you, delivered into the current conversation, driven server-side, available across devices** — on time, even with the browser closed.

**`/later` delayed send** — no panel needed: type one line in the input box and it is sent later as yourself (demo: typing `/later +5s`, `+3m`, `+1h20m` character by character, then Enter to start the countdowns; the `+5s` one really lands when due):

<p align="center">
<img src="docs/media/docs-later-full.gif" width="760" alt="/later demo: type /later +5s 检查部署结果 → Enter → dock countdown → delivered as yourself when due"/>
</p>

---

## How to use

### Schedule panel

Click the **"Schedule send"** button to the right of the input box. The panel uses the **input box content** as the reminder text; pick a time, then click **"Add · send at HH:MM"** (the button stays disabled until a time is chosen). A countdown row then appears above the input box.

| Capability | Description |
|---|---|
| Quick chips | One-tap `in 10 minutes` / `in 1 hour` / `work hours` (configurable in settings) |
| Custom time | "Custom…" opens date + time inputs |
| Task list | This conversation's scheduled items, deletable one by one |

Pause, resume, text editing and send-now are not in the panel: they are per-row actions in the [pending dock](#pending-dock).

### Time formats

All of these are accepted (`/schedule`, `/later`, and the panel's custom time share the same parser; the rows marked *commands only* are rejected by the panel):

| Kind | Examples |
|---|---|
| Relative duration | `+30m` · `+1h30m` · `+90s` · `+1w` · `30分钟后` · `半小时后` |
| Time today | `15:32` · `9点` · `9点半` · `1532` |
| Relative day + time | `明天9点` · `后天 10:00` |
| Date + time | `8月21日 15:32` · `2026-08-21 15:32` · `0821-1532` |
| Repeat, fixed interval (*commands only*) | `+1h*3 drink water` · `+30m×2 check build` |
| Repeat, chained sequence (*commands only*) | `+1h+1h+0.5h watch the rollout` · `+1h +30m submit report` |
| Anchor sequence (*commands only*) | `15:32+16:32+17:32 three meetings` · `9:00+1d+1d standup` · `明天9点+1h` |

The three bolded rows above are **[Advanced syntax (Beta)](#configuration)** and can be switched off together in settings; every other form is unaffected.

A bare time (like `1532`) rolls over to tomorrow if it has already passed today (up to 7 days). Writing `明天`/`后天` is taken literally — if that time has passed you are told to use a concrete date instead. A month/day only (like `8月21日`) rolls over to next year when this year's has passed.

Multi-shot rules — **the first occurrence lands after the first interval**:

| Input | Expands to |
|---|---|
| `+1h*3` | t+1h, t+2h, t+3h |
| `+1h+1h+0.5h` | t+1h, t+2h, t+2.5h (chained — good for "2 h → 1 h → 30 min before the deadline" nagging) |
| `15:32+16:32+17:32` | those three clock times today |
| `23:00+01:00` | 23:00 today, **tomorrow** 01:00 (an earlier time in the chain rolls over, same rule as a single shot) |
| `9:00+1d+1d` | 09:00 on three consecutive days |

At most **10 tasks** per command, and multi-shot intervals must be **≥ 60 seconds** (single shots are unrestricted — `/later +5s` still works). `*`, `×` and `x` all work, an optional Chinese counter suffix is accepted (`*3次`), and the count must be followed by a space. Every occurrence is an **independent task**: cancel it, edit it or send it early on its own, and `/later` attachments are carried by each one. Absolute times (`15:32`, `明天9点`) do **not** accept `*count` — you get an explicit error instead of a silently wrong single task.

Chains allow exactly **one direction: an absolute anchor, then forward accumulation.** `+1h+15:32` (a clock time after a duration) is rejected rather than guessed.

One difference between anchor and relative chains (deliberate, not a bug):

| Form | Stored as | Pausable | Across DST |
|---|---|---|---|
| `+1h*3` / `+1h+30m` (relative) | `after` | ✅ | —— |
| `15:32+16:32` / `9:00+1d` (anchor) | `at` | ❌ (button disabled with a reason) | ✅ wall clock holds: on a fall-back day `9:00+1d` is **25 h** later and still 09:00, whereas adding 86400 s would drift to 08:00 |

`+1d` advances by **calendar day**, not 86400 seconds — which is why `+1d*3` and `9:00+1d+1d` differ in zones with DST (the former counts real seconds, the latter counts wall clock). A wall clock that does not exist (the hour skipped by the spring-forward) is an error, never a silently shifted time.

### Commands

| Command | Effect |
|---|---|
| `/schedule <time> <content>` | Create a reminder (shows up in the conversation when due) |
| `/later <time> <content>` | Delayed send: deliver the content later as yourself |
| `/later <time>*<count> <content>` | Same, expanded into N delayed sends (`+1h*3`) |
| `/schedule <time>+<time> <content>` | Same, a chained sequence expanded into N reminders (`+1h+30m`) |
| `/later <clock>+<clock> <content>` | Anchor sequence: expand by wall-clock instants (`15:32+16:32`, `9:00+1d+1d`) |

```
/schedule 明天9点 提交周报
/later 1532 提醒团队同步进度
/later +1h*3 起来喝水
/later +2h+1h+30m 催我交周报
```

The dock buttons are not a private channel: they run `/user-schedule-create`, `-list`, `-delete`, `-edit`, `-pause`, `-resume`, `-steer-now` (arguments are a JSON object). You can type them too, but they are designed to be clicked, not typed.

### Images and files

`/later` carries attachments: paste an image or drop a file into the composer, then type `/later +10m take a look at this` and hit enter. When it fires, the content goes out **with the attachments**, under your identity — the message has exactly the same shape as a "text + image" message you send by hand.

- **Only `/later` carries them.** `/schedule`, the panel, and model-created tool schedules never do — a deliberate trust boundary: attachment blocks may only enter a sent-as-user message through the channel where you typed the command yourself, so an `attachments` field smuggled into tool arguments has no effect.
- Multi-shot syntax (`+1h*3`) attaches **the same** files to each expanded task; each row is still independently cancellable, editable and sendable.
- The dock row shows a **real thumbnail**. Before it fires, the Host's session-log-authorized image channel cannot read the attachment (it is not in the log yet — expected, not corruption), so the thumbnail comes from the Host's own local-file route `GET /api/file`; after it fires, both channels work. If this Host's attachment backend is not file-backed, the thumbnail degrades into a "Available after send + size" marker — that does **not** mean the attachment was lost; it still ships with the message.
- Each task renders at most 8 thumbnails in the dock, with `+N` for the rest; non-image attachments become a "file name + size" chip.
- On kernel `0.1.2` the host `ContentBlock` union has no `file` variant, so a non-image attachment ships as a `[附件] <file name>` text block instead. Image blocks pass through unchanged on every supported kernel. See [Supported DSH kernels](#supported-dsh-kernels).

The model can call three user tools on your behalf: create, inspect and delete (`user_schedule_create` / `user_schedule_list` / `user_schedule_delete`). Editing the text, pausing, resuming and send-now are **not** exposed to the model; they are dock buttons over the `/user-schedule-*` commands, meant to be clicked by you. **Endlessly recurring** reminders (every hour, forever) are only reachable through the model: ask it to remind you every hour and it creates an `every_seconds` schedule. Such a task has no end condition and must be deleted by hand.

The model also ships with a `SKILL.md` (skill name `later-reminders`). It stays in the model's skill catalog and covers **when to offer a reminder** and **how it differs from the kernel's official `schedule_create`**; argument rules deliberately stay out of it, so they cannot drift from the tool schema. This entry is optional: a host assembly without the skills service simply never shows it, and everything else keeps working.

### Pending dock

The countdown rows above the input box. Each row ends with four buttons: **Edit reminder** (change the text inline), **Pause / resume reminder**, **Delete reminder** (cancel that item), and **Send now** (push it to the agent immediately, skipping the countdown; periodic `every` rows have no Send now button).

Pause is only open to "wait N more minutes" (`after`) reminders that have not fired yet: clock-time `at` rows and recurring `every` rows grey the button out and say why on hover, and a row that already fired can only be deleted or sent. While paused the countdown and the progress bar freeze and the attachments stay on the item; resuming re-arms the **remaining** time from the moment you resume, so the fire time moves later by however long it was paused.

> ⚠️ "Send now" is not a confirm button — it **immediately** delivers the reminder text to the agent and wakes the model. To cancel, use Delete.

### Sidebar presence indicator

Conversations with active reminders show a pixel clock in their sidebar row (alongside the "active" orb):

| Icon | Meaning |
|---|---|
| <img src="assets/icons/icon-presence-scheduled.svg?v=18" width="28" alt="scheduled"/> | Purple · has scheduled reminders |
| <img src="assets/icons/icon-presence-urgent.svg?v=18" width="28" alt="urgent"/> | Amber · next fire within 5 minutes |
| <img src="assets/icons/icon-presence-overdue.svg?v=18" width="28" alt="overdue"/> | Red · overdue (waiting for the session to become idle) |

Hover shows "Next at 15:32 · 3 task(s)"; when overdue it shows "Due · 3 task(s) (sends when the session is idle)". When every reminder in the conversation is paused the icon stays purple and hover reads "Paused · 3 task(s)", because a paused item has no scheduled time to report.

The sidebar hover card gains one status line ("3 scheduled reminder(s), next 15:32"), shaped like the host's own status rows and **appended** to them: the existing rows and their ordering are untouched, and overdue and paused each have their own wording.

---

## Screenshots

**Schedule panel** — quick slots / custom time / pending list:

<img src="docs/media/screenshot-panel.png" width="340" alt="Schedule panel"/>

**Pending dock** — countdown rows above the input box (inline edit / cancel):

<img src="docs/media/screenshot-dock.png" width="700" alt="Pending dock and input box"/>

**A real due-time firing** — when the time comes, a `⏰ Scheduled reminder` message appears in the conversation (fires even with the page closed):

<img src="docs/media/screenshot-fired.png" width="560" alt="Due-time reminder message"/>

**Animated demos**:

| Creating a reminder (type → panel → add → dock) | Firing when due (countdown → message arrives) |
|---|---|
| <img src="docs/media/docs-scheduler-create.gif" width="380" alt="Create reminder demo"/> | <img src="docs/media/docs-scheduler-fired.gif" width="380" alt="Due firing demo"/> |

**`/later` shortcut** — skip the panel and type one line in the composer to send as yourself later:

<img src="docs/media/docs-later.gif" width="760" alt="/later command demo: type /later +60m text, press Enter, dock shows the countdown"/>

---

## Feature overview

- **Input-bar timer button**: one click opens the schedule panel: smart time slots / custom time / this conversation's pending list / countdown.
- **Pending dock**: a list above the input box; each item can be **cancelled**, **edited inline**, **paused and resumed** (`after` items), or sent to the agent right away.
- **`/later` delayed send**: deliver *the text you are typing right now* later, as yourself (see [the difference](#reminders-vs-delayed-sends-whats-the-difference)).
- **Sidebar presence indicator**: conversations with active reminders show a pixel clock in the sidebar (purple = scheduled · amber = fires within 5 min · red = overdue); hover shows count and next fire time, and shows "Paused" when everything is paused.
- **Works across six kernel generations**: verified from `0.1.2-rc.1` to `0.2.1-rc.2`, per-generation real GUI screenshots included, see [Supported DSH kernels](#supported-dsh-kernels).
- **Fires with the page closed**: reminders persist server-side and arrive on time across devices.
- **Never impersonates you**: when due, the message appears as a `Reminder` — it is never framed as your own words.
- **The model schedules on its own initiative**: the bundled `SKILL.md` (skill name `later-reminders`) sits in the model's skill catalog, so it offers a reminder even when nobody says "remind me", and it separates this plugin from the kernel's official `schedule_create`. A host assembly without the skills service simply never shows this entry, and everything else keeps working.
- **Multilingual**: follows the DSH UI language (Chinese / English), live without reload.
- **Reminders don't carry across sessions**: sessions forked from this one never inherit the parent's reminders.

---

## Reminders vs. delayed sends: what's the difference?

| Action | When it takes effect | Who sends it | What you see |
|---|---|---|---|
| Enter in the input box | Immediately | You | Normal user bubble |
| Schedule panel / `/schedule <time> <content>` | When due | The reminder | `Reminder · HH:MM · content` row |
| `/later <time> <content>` | When due | As yourself | Normal user bubble |

> **`/schedule` is not "delayed send"**: pressing Enter on `/schedule …` sends it *immediately* (as a user message); only the **reminder itself** is deferred. If you want "send the text I'm typing now, later, as if I said it", use **`/later`**.

---

## Quick start

### Supported DSH kernels

| Kernel generation | Status |
|---|---|
| `0.1.2-rc.1` | Supported |
| `0.1.5-rc.3` | Supported |
| `0.1.7-rc.1` / `0.1.7-rc.2` | Supported |
| `0.2.0-rc.2` / `0.2.1-rc.2` | Supported |

The declaration lives in `package.json` under `engines.dsh`: `>=0.1.2-rc.1 <0.1.3-0 || >=0.1.5-rc.3 <0.1.6-0 || >=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.2 <0.2.1-0 || >=0.2.1-rc.2 <0.2.2-0`. Node `^22.19 || >=24`.

That line is now derived from the generation table (`node scripts/sync-peer-matrix.mjs`) and is shaped as **per-segment bounded ranges**, not a whitelist: later rcs within the same segment, and that segment's final release, are admitted together (range syntax cannot express "only these verified versions"). It used to be a hand-written string, and `>=0.1.2-rc.1 <0.2.0-0` pulled in prereleases from other segments — measured as supported without ever being run: `0.1.3-alpha.2`, `0.1.6-alpha.1`, `0.1.7-alpha.1`, `0.2.2-alpha.2`. Those are now rejected.

One beneficiary of that rule: `0.2.1-rc.3` and `0.2.1-rc.4` are not in the table above (only assembly and real delivery were verified; cross-generation tsc and the gate face were not), yet the `0.2.1` clause admits them — both measured GREEN, each in its own process, passing the same-source guard. They join the table only once both faces are run, at which point the generation pinned for local compilation moves up with them.

Two boundaries are worth stating, otherwise they look like oversights:

- **`0.1.1-rc.2` is not supported.** Not because the code fails there, but because its dependency line cannot be installed at all (`@deepseek-ai/dsh-util-workspace-path@0.1.1-rc.2` was never published), so no tool can produce a verdict. Support is moot until upstream publishes it.
- **`0.1.5` is verified as `rc.3`, not `rc.1`.** `dsh@0.1.5-rc.1` depends on `^0.1.5-rc.1`, so a default install resolves the whole plugin line to `rc.3` (measured: 237 of 238 `@deepseek-ai/dsh*` entries were not `rc.1`). **What you actually get is a uniform `rc.3`**, so that is the only shape we verify.
  This section used to claim that an "rc.1 launcher + rc.3 components" mix "does not start at all" — **that was a misjudgement and has been withdrawn**: the same mixed tree mounts and delivers once peers are backfilled. The failures came from two assembly quirks of our own verification script (a hard-coded launcher location, and skipping peer installation), not from a kernel limitation. `rc.1` stays outside the support range for one reason only: that shape has not been verified — not because it cannot work.

Each generation is verified on four faces (baseline `main@28ca1dc`, i.e. 1.8.0, measured 2026-10-26): mount (a cold start on a real kernel loads the plugin), function (a due reminder really delivers, judged on event shapes, not on log text), type (the entire `@deepseek-ai/dsh*` line swapped to that generation, both tsconfig projects compile with zero errors), UI (a real GUI renders the timer button, the dock and the panel, screenshotted per generation). Rerun the first three with `npm run verify:kernels:all`, and the UI face with `npm run verify:ui`. The measurements, per-generation verdicts and method belong to [docs/verification.md](./docs/verification.md) and [docs/notes/ui-matrix.md](./docs/notes/ui-matrix.md); this table reports conclusions only.

The bundled `SKILL.md` exposure point is not covered by that baseline. It depends on the **assembly**, not the generation (it silently disappears when the host assembly has no skills service, see above), and its cross-generation evidence lives in `tests/skill-provider.test.mjs`: the real `SkillRegistry` cases run `0.2.1-rc.2` by default, and other generations need `DSH_LATER_SKILL_PKG` pointed at that generation's `dsh-skill/lib/index.js`.

Which side enforces the version gate also depends on the generation: kernels up to `0.2.0` do **not** read `engines.dsh` (they check only the per-generation `@deepseek-ai/dsh-*` peer list), and from `0.2.1` on `engines.dsh` decides on its own. So "it got installed on this old kernel" does not mean "this kernel honours the range I declared".

Old kernels come with four visible degradations. Nothing is lost, but the looks and the wording change.

| Kernel | What you see |
|---|---|
| `0.1.2` | Non-image attachments arrive as a `[附件] <file name>` text block (that generation's `ContentBlock` has no `file` variant); image blocks are unaffected |
| `0.1.2` | Attachment icons are always a paperclip, and the size text is computed locally (base 1024, one decimal), not guaranteed to match the host's wording character for character |
| `0.1.5` and older | `Tooltip` has no `portal`, so a long tooltip can be clipped by a scrollable ancestor |
| `0.1.5` line | Settings are persisted into the profile (that schemastery has no `Schema.volatile()`); the affected fields are boolean switches, so writing them is harmless |

### Install into DSH

**From npm (recommended — prebuilt, no approval needed):**

```sh
dsh plugin --profile web add dsh-later
# restart dsh web to activate
```

Or build from source and add it to your DSH Web profile:

```sh
cd dsh-later
pnpm install                # the repo is a pnpm workspace (pnpm-lock.yaml + pnpm-workspace.yaml)
pnpm run build

dsh plugin --profile web add "file:/path/to/dsh-later"
# restart dsh web to activate
```

> Dev tip: `npm run watch` rebuilds on `src/` changes and runs shape regression tests.
>
> It no longer patches the copy the GUI is running (issue #46: the old behaviour
> silently deployed unmerged code into every profile, and concurrent worktrees
> overwrote each other through shared inodes). To see a change in the UI, either:
>
> ```sh
> npm run deploy                     # sync once, explicitly
> DSH_LATER_RELINK=1 npm run watch   # restore the old deploy-on-every-change
> ```

### Your first reminder

1. Open any conversation — a "Schedule" button appears right of the input box;
2. Click it → pick a smart slot, or enter a custom time and content;
3. Confirm → a countdown chip appears next to the button and the dock shows the pending item;
4. When due, a `Reminder` message lands in the conversation — it fires even if you close the page.

---

## Long-text reminders

Reminder content is limited to **1000 characters** by default. For longer content, enable `allowLongPrompts` in **DSH Settings → Plugins → Session Scheduler** and set `maxPromptChars`.

- **Good for**: code snippets, meeting notes, long quotes, cross-device notes/todos.
- **Not recommended**: text that could read as instructions (the longer it is, the bigger the risk); a shared public profile (anyone could raise the limit).

---

## Configuration

Works out of the box. Adjust in **DSH Settings → Plugins → Session Scheduler** (applies live, no restart):

| Field | Description | Default |
|---|---|---|
| Show schedule button | Whether the timer button shows on the input bar (hiding it never affects existing reminders or the dock) | Shown |
| Show scheduled in group badge | Whether the "Scheduled" cell appears on the folded-group badge of dsh-group-status; off = **we do not register the facet**, reminders still fire | Shown |
| Max schedules per session | Max reminders allowed in one conversation | 100 |
| Allow long prompts | Lift the 1000-character default cap | Off |
| Custom cap | Character cap when `allowLongPrompts` is on | 1000 |
| Work hours / lunch / night quiet | Five HH:mm fields driving smart slots and auto-scheduling | See settings page |
| Interjection delivery | Which queue "Send interjection" uses: own turn (default, safe) / current turn (faster, can drop in an edge case) | Own turn |
| Delivery confirmation / on unconfirmed | Whether to verify a reminder really landed, and what to do when it isn't confirmed | On / keep |
| Clock icon style | `auto` (by kernel version) / `modern` / `classic` | auto |
| **Advanced syntax** (Beta) | Master switch for multi-shot forms: `+1h*3`, `+1h+1h+0.5h`, `15:32+16:32`, `9:00+1d`. When off, those forms are rejected with a pointer back to settings | **On** |

> Advanced syntax is marked Beta not because it is untested (the grammar and the expansion are covered case by case in `tests/occurrences.test.mjs`, with per-generation measurements in [docs/verification.md](./docs/verification.md)) but because **the expanded result still needs real-world observation**: whether 10 tasks flood the dock, and whether the 60-second floor and 10-task cap are the right sizes.
> Turning it off does **not** restore the old silent mis-parse (`+1h*3 x` creating one task whose content is `*3 x`) — that was a bug, not a fallback. The residual-token guard is independent of this switch and always on.

> Advanced: defaults can also be overridden at startup via `cordis.patch.yml` (e.g. `maxSchedules`) — see `docs/` and the schema.

---

## For plugin developers: the schedule summary API (cross-plugin)

dsh-later exposes a workspace-wide schedule summary as a public data face
(issue #17), so other client
plugins (e.g. dsh-group-status) can aggregate schedule state on folders/sidebar rows
**without** parsing the `userSchedules` projection themselves — and without drifting
from the inline row badge.

Declare the external module in `package.json` first:

```json
{ "dsh": { "client": { "platform": "web", "external": ["dsh-later"] } } }
```

Then `require('dsh-later/client')` inside the client factory:

```js
const { getScheduleSummaryStore, summarizeScheduleGroup, useScheduleSummary } = require('dsh-later/client')

// 1) Read the store directly: session id → { count, pausedCount, nextAt, state }
const store = getScheduleSummaryStore() // undefined when dsh-later is not loaded
const summary = store?.getSnapshot() ?? new Map()

// 2) Aggregate per group (used by the folded-folder badge)
const group = summarizeScheduleGroup(summary, groupSessionIds)
// → { sessions, count, pausedCount, nextAt?, state? }

// 3) Subscribe inside a React component (re-renders if the store arrives late)
const live = useScheduleSummary()
```

| Field | Meaning |
|---|---|
| `count` | Number of schedules (**including** paused ones) |
| `pausedCount` | Paused schedules (they count toward `count` but **not** toward `nextAt`) |
| `nextAt` | Earliest fire time (epoch ms); `undefined` when everything is paused |
| `state` | `scheduled` / `urgent` (≤5 min) / `overdue` (due but not dispatched), judged at snapshot time |

Contract notes:

- The summary contains **only sessions with schedules**; consumers look up their own `sessionIds`.
- The store is the **single source of truth**: dsh-later's own sidebar badge reads it too, so the
  two can never disagree. It owns the `sessions.list` subscription, the 30s state tick and the
  60s `session.list` read RPC (visible-page only).
- Consumers must tolerate `undefined` (dsh-later not installed/enabled) and degrade silently.

### The folded-group badge: we register the facet ourselves (issue #36)

"How many sessions in this group have scheduled reminders" is now owned end to end: dsh-later
registers `dsh-later.schedule` inside its own client `apply`, following
[the facet protocol v1](https://github.com/dsh-plugin-collection/dsh-group-status/blob/main/docs/facet-protocol.md),
and hands over fold / merge / label / renderIcon. The counting basis (sessions **with** schedules),
the tone (purple scheduled / orange urgent / red overdue), the pulse (only urgent and overdue
blink), the wording (`N 定时任务` / `N Scheduled`) and the glyph (the official outline clock at
14px) are all decided here — the consumer only honours the protocol shape.

- **dsh-group-status is an optional partner.** When it is not installed or not enabled,
  `require('dsh-group-status/client')` throws; we catch it and skip registration. That is why it is
  in **neither** `dsh.client.external` **nor** the module-level `inject` — the top-level `inject`
  is an activation gate, and a hard dependency there would leave this plugin permanently pending
  whenever the partner is absent (the issue #34 P0).
- A protocol-version mismatch is skipped **visibly** (one `console.warn`): "I registered it, why is
  nothing showing" has to be diagnosable.
- **The visibility switch lives here** (issue #83): `showInGroupBadge`, on by default. Partner PR #37
  deprecated `settingKey` in the protocol (v1 still accepts it but no longer reads it), leaving exactly
  one rule: **registered means shown, unregistered means hidden**. So "turn scheduled reminders off"
  can only be executed by us — off means we do not register. Saving in settings applies immediately (the
  registration follows the subscription), no page refresh; with dsh-group-status absent the row has no
  visible effect.
- Every field matches the consumer's former stopgap adapter, and
  `tests/group-status-facet.test.mjs` keeps a copy of that adapter's algorithm as the oracle.
  Changing the display semantics now has to clear that baseline instead of drifting silently.

The summary API above stays available for consumers that read numbers directly (session rows,
hover cards); both paths read the same store.

## Technical documentation

Developer- and maintainer-oriented content has moved out of this README:

- [Architecture & data flow](./docs/architecture.md) — host/client layering, event flow, layout, scheduler rationale
- [Key design decisions](./docs/design-decisions.md) — `source` field, slash channel, fork isolation, anti-spoofing tradeoffs
- [Verification & acceptance criteria](./docs/verification.md) — tests, live E2E, cross-kernel compatibility, AC table
- [Cross-kernel UI screenshot matrix](./docs/notes/ui-matrix.md) (how each generation boots a real GUI, what is judged, and the running verdicts)

## References

- PRD & design docs: `prd.md` and `docs/` in the project root (workspace-level, outside this package)
- dsh-schedule source analysis: `../references/dsh-schedule-analysis.md`
- dsh-sleep-send source analysis: `../references/dsh-sleep-send-analysis.md`

## License

MIT

---

<div align="center">

<img src="assets/icons/icon-presence-scheduled.svg?v=18" width="48" alt="scheduled"/>
<img src="assets/icons/icon-presence-urgent.svg?v=18" width="48" alt="urgent"/>
<img src="assets/icons/icon-presence-overdue.svg?v=18" width="48" alt="overdue"/>

</div>
