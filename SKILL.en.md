---
name: later-reminders
description: "Use user_schedule_create for reminders the user must see; official schedule_create only wakes the model. Create one unprompted when the user deferred something, a build, deploy or download is still running, some state will change later, or they want it repeated every hour or day until deleted. Skip work you can finish now, reminders nobody asked for, and duplicates already pending. Then say what and when in one line; the panel or dock cancels it."
---

# Scheduled reminders: when to create one on your own initiative

`user_schedule_create` delivers a **scheduled reminder** at the due time. The user
sees it in the schedule panel and in the dock above the composer, and can edit or
cancel it there. It means "remember this for the user". The official
`schedule_create` wakes **the model** at the due time and does not appear in that
panel.

How to fill the arguments is defined by the tool's own parameter descriptions.
This skill only covers **when to schedule and which tool to use**.

## Pick the right scheduler

| What the user asked for | Use |
|---|---|
| "Remind me at 3 to take the meeting", the **user** must be notified | `user_schedule_create` |
| "I'll be back after lunch", the model should come back and check | official `schedule_create` |
| Notify the user and keep the work going | `user_schedule_create`; the reminder wakes the model when it lands |

One test decides it: **is this due item meant for the user to see, or only for the
model?** Both tools exist in the same session, so do not reach for the official one
by default.

## Create without being asked

1. **The user deferred something**: "I'll send the file after lunch", "let's pick
   this up tomorrow", "I'll be back in a bit".
2. **Something long is running**: a build, deploy, download, render, CI run,
   training job. Estimate how long it takes and schedule one check at that moment.
   Do not sleep in place, and do not ask the user to tell you when it is done.
3. **Something will change**: a price, a queue, a review, a reply, a page update.
4. **The user wants repetition**: drink water every hour, standup reminder every
   day. Recurring reminders can only be created through this tool, see "What only
   the model can do" below.

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

The reminder renders as a **scheduled reminder** line in the conversation
(`Scheduled · HH:MM · content`) and wakes the model to act on it. So the `prompt` is
read cold by your future self: state what to check, where, and what "done" means.

## What only the model can do

- **Open ended recurring reminders**: an `every_seconds` task stays in the panel and
  dock until the user deletes it. Recurring tasks made with the official tool do not
  enter that panel, so the user can neither see nor cancel them there.
- **Attachments and speaking-as-the-user are not reachable from here**: only a `/later`
  the user types themselves carries an attachment and sends as the user. An
  `attachments` or `delivery` field smuggled into tool arguments has no effect. Do
  not promise "I will send you that picture when it is due"; that is a `/later`.
- **Edit, pause, resume, send now** live in the panel and dock. This tool offers
  create, list and delete only: to change content or time, delete and recreate.
