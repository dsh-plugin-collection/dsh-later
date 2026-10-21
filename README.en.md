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
| Send preview | See the exact due-time form before confirming |
| Task list | All scheduled items, deletable one by one |
| Cancel all | Cancel action on the chip clears every reminder in this conversation |

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

### Images and files

`/later` carries attachments: paste an image or drop a file into the composer, then type `/later +10m take a look at this` and hit enter. When it fires, the content goes out **with the attachments**, under your identity — the message has exactly the same shape as a "text + image" message you send by hand.

- **Only `/later` carries them.** `/schedule`, the panel, and model-created tool schedules never do — a deliberate trust boundary: attachment blocks may only enter a sent-as-user message through the channel where you typed the command yourself, so an `attachments` field smuggled into tool arguments has no effect.
- Multi-shot syntax (`+1h*3`) attaches **the same** files to each expanded task; each row is still independently cancellable, editable and sendable.
- The dock row shows a **real thumbnail**. Before it fires, the Host's session-log-authorized image channel cannot read the attachment (it is not in the log yet — expected, not corruption), so the thumbnail comes from the Host's own local-file route `GET /api/file`; after it fires, both channels work. If this Host's attachment backend is not file-backed, the thumbnail degrades into a "Available after send + size" marker — that does **not** mean the attachment was lost; it still ships with the message.
- Each task renders at most 8 thumbnails in the dock, with `+N` for the rest; non-image attachments become a "file name + size" chip.

The model can also call user tools on your behalf to create/inspect/delete/edit reminders (`user_schedule_create` / `user_schedule_list` / `user_schedule_delete` / `user_schedule_edit`). **Endlessly recurring** reminders (every hour, forever) are only reachable this way: ask the model "每小时提醒我喝水" and it creates an `every_seconds` schedule — such a task has no end condition and must be deleted by hand.

### Pending dock

The countdown rows above the input box. Each row ends with three buttons: **Edit reminder** (change the text inline), **Delete reminder** (cancel that item), and **Send now** (push it to the agent immediately, skipping the countdown).

> ⚠️ "Send now" is not a confirm button — it **immediately** delivers the reminder text to the agent and wakes the model. To cancel, use Delete.

### Sidebar presence indicator

Conversations with active reminders show a pixel clock in their sidebar row (alongside the "active" orb):

| Icon | Meaning |
|---|---|
| <img src="assets/icons/icon-presence-scheduled.svg?v=18" width="28" alt="scheduled"/> | Purple · has scheduled reminders |
| <img src="assets/icons/icon-presence-urgent.svg?v=18" width="28" alt="urgent"/> | Amber · next fire within 5 minutes |
| <img src="assets/icons/icon-presence-overdue.svg?v=18" width="28" alt="overdue"/> | Red · overdue (waiting for the session to become idle) |

Hover shows "Next at 15:32 · 3 task(s)"; when overdue it shows "Due · 3 task(s) (sends when the session is idle)".

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

- **Input-bar timer button**: one click opens the schedule panel — smart time slots / custom time / send preview / pending list / countdown chip.
- **Pending dock**: a list above the input box; each item can be **cancelled** individually or **edited inline** via its edit icon.
- **`/later` delayed send**: deliver *the text you are typing right now* later, as yourself (see [the difference](#reminders-vs-delayed-sends-whats-the-difference)).
- **Sidebar presence indicator**: conversations with active reminders show a pixel clock in the sidebar (purple = scheduled · amber = fires within 5 min · red = overdue); hover shows count and next fire time.
- **Fires with the page closed**: reminders persist server-side and arrive on time across devices.
- **Never impersonates you**: when due, the message appears as a `Reminder` — it is never framed as your own words.
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

### Install into DSH

**From npm (recommended — prebuilt, no approval needed):**

```sh
dsh plugin --profile web add dsh-later
# restart dsh web to activate
```

Or build from source and add it to your DSH Web profile:

```sh
cd dsh-later
npm install
npm run build

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
| Max schedules per session | Max reminders allowed in one conversation | 100 |
| Allow long prompts | Lift the 1000-character default cap | Off |
| Custom cap | Character cap when `allowLongPrompts` is on | 1000 |
| Work hours / lunch / night quiet | Five HH:mm fields driving smart slots and auto-scheduling | See settings page |
| Interjection delivery | Which queue "Send interjection" uses: own turn (default, safe) / current turn (faster, can drop in an edge case) | Own turn |
| Delivery confirmation / on unconfirmed | Whether to verify a reminder really landed, and what to do when it isn't confirmed | On / keep |
| Clock icon style | `auto` (by kernel version) / `modern` / `classic` | auto |
| **Advanced syntax** (Beta) | Master switch for multi-shot forms: `+1h*3`, `+1h+1h+0.5h`, `15:32+16:32`, `9:00+1d`. When off, those forms are rejected with a pointer back to settings | **On** |

> Advanced syntax is marked Beta not because it is untested (43 new unit tests cover it) but because **the expanded result still needs real-world observation**: whether 10 tasks flood the dock, and whether the 60-second floor and 10-task cap are the right sizes.
> Turning it off does **not** restore the old silent mis-parse (`+1h*3 x` creating one task whose content is `*3 x`) — that was a bug, not a fallback. The residual-token guard is independent of this switch and always on.

> Advanced: defaults can also be overridden at startup via `cordis.patch.yml` (e.g. `maxSchedules`) — see `docs/` and the schema.

---

## For plugin developers: the schedule summary API (cross-plugin)

dsh-later exposes a workspace-wide schedule summary as a public data face
([issue #17](http://192.168.4.77:3000/dsh-plugins/dsh-later/issues/17)), so other client
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
[the facet protocol v1](http://192.168.4.77:3000/dsh-plugins/dsh-group-status/src/branch/main/docs/facet-protocol.md),
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
