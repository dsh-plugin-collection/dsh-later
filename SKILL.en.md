---
name: later-reminders
description: "Use user_schedule_create for reminders the user must see; official schedule_create stays on the kernel's own scheduling surface. Create one unprompted when the user deferred something, a build, deploy or download is still running, some state will change later, or they want a fixed interval repeated every hour until deleted. Skip work you can finish now, reminders nobody asked for, and duplicates already pending. Then say what and when in one line; the panel or dock cancels it."
---

# Scheduled reminders: when to create one on your own initiative

`user_schedule_create` delivers a **scheduled reminder** at the due time. The user
sees it in the schedule panel and in the dock above the composer, and can edit or
cancel it there; the reminder also reaches the model. The official
`schedule_create` belongs to the kernel's own scheduling surface and never appears
in this plugin's panel or dock.

Check that this applies first: **if `user_schedule_create` is not in your tool list,
do not follow this skill**. A delegated subagent session does not have it (this plugin
mounts its tools on root sessions only) while the skill catalog is visible to every
agent. The right move there is to **schedule nothing** and leave "should there be a
reminder" to the session that delegated you.

How to fill the arguments is defined by the tool's own parameter descriptions.
This skill only covers **when to schedule and which tool to use**.

## Pick the right scheduler

| What the user asked for | Use |
|---|---|
| "Remind me at 3 to take the meeting": the **user** must be notified and manage it in this plugin's panel and dock | `user_schedule_create` |
| Only the model should come back and check at the due time | official `schedule_create` |
| Calendar repetition: every day at 9, every Monday | official `schedule_create` (this plugin only does fixed intervals) |

One test decides it: **is this due item meant for the user to see and manage in the
reminder list, or only for the model?** The two tools are usually both present in the
same session, so do not reach for the official one by default; in the other direction,
this plugin has no calendar repetition, so hand "every day at 9" back to the official
tool. This plugin's panel and dock only list the tasks `user_schedule_*` manages, so
the official tool's tasks are not in them.

## Create without being asked

1. **The user deferred something**: "I'll send the file after lunch", "let's pick
   this up tomorrow", "I'll be back in a bit".
2. **Something long is running**: a build, deploy, download, render, CI run,
   training job. Estimate how long it takes and schedule one check at that moment.
   Do not sleep in place, and do not ask the user to tell you when it is done.
3. **Something will change**: a price, a queue, a review, a reply, a page update.
4. **The user wants open ended repetition**: drink water every hour, stand up every
   30 minutes. Only this tool puts a recurring task into this plugin's panel, see
   "What only the model can do" below; calendar repetition such as "every day at 9"
   goes to the official tool.

When you are unsure whether the user wants it, ask one line first instead of
creating it and explaining afterwards.

## Do not create

- Anything you can finish right now in this turn.
- Checks the user never asked for, especially frequent ones that will interrupt them.
- **A second copy of something already pending**: call `user_schedule_list` first
  when the reminder might already exist.
- Checks denser than the work itself: a 20 minute build gets one check in 20
  minutes, not one per minute.

## After you create it

Say in one line **what** the reminder will do and **when** it fires, in the user's
local time, and that they can cancel it from the schedule panel or the dock. For
example: "Reminder set for 3:25 PM (in 20 min) to check the build. Cancel it in the
panel if you would rather not."

Do not create several copies to be safe, and do not decide when the user's recurring
reminder ends: a recurring task has no end condition and only the user can delete it.

## What happens at the due time

The reminder shows up in the conversation as a **scheduled reminder**, not as words the
user typed (only `/later` sends as the user), and it wakes the model to act on it. So
the `prompt` is read cold by your future self: state what to check, where, and what
"done" means.

## What only the model can do

- **Recurring reminders in this plugin's panel**: an `every_seconds` task stays in the
  panel and dock until the user deletes it. Recurring tasks from the official tool
  belong to the kernel's own scheduling surface, so they never enter this panel and
  this plugin cannot manage them.
- **Attachments and speaking-as-the-user are not reachable from here**: only a `/later`
  the user types themselves carries an attachment and sends as the user. An
  `attachments` or `delivery` field smuggled into tool arguments has no effect. Do
  not promise "I will send you that picture when it is due"; that is a `/later`.
- **Edit, pause, resume, send now** live in the panel and dock. This tool offers
  create, list and delete only: to change content or time, delete and recreate.
