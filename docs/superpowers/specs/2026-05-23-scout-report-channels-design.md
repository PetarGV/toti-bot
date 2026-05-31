# Scout Report Channels - Design

**Status:** Spec
**Date:** 2026-05-23
**Scope:** Improve scouting requests by creating a temporary Discord channel per scout call, accepting one deliberate screenshot report, archiving it permanently to `#scout-reports`, and deleting the temporary channel 24 hours after the official report is submitted.

---

## 1. Goal

Make scouting usable without slash commands. Members should be able to create a scout request from the existing scout panel, coordinate in a dedicated channel, upload screenshots or notes freely while discussing the target, and deliberately archive one final screenshot report through the existing button-style GUI.

The permanent archive is `#scout-reports`. Temporary scout channels are working rooms only; they are deleted after the official report has been submitted and archived.

## 2. User-facing Surface

### 2.1 Setup

`/setup scout` remains the setup entry point. When run, it should:

1. Find or create a `Scouting` category.
2. Find or create the permanent `scout-reports` text channel.
3. Post and pin the existing scout panel.

Temporary scout channels inherit the `Scouting` category permissions. The implementation should not add per-channel permission overwrites unless later requested.

### 2.2 Scout Request

The existing scout request GUI stays familiar. Creating a scout request still starts from the scout panel or `/scout`, but the main user path is the panel.

The scout request form gains one optional field:

| Field | Required | Notes |
|-------|----------|-------|
| Coordinates | Yes | Existing coordinate parser. |
| Notes | No | Existing free-text notes. |
| Minimum scouts needed | No | Free text or numeric text such as `50`, `200`, `500+`. |

When the request is created, the bot creates a temporary text channel under `Scouting`, posts the scout embed there, and posts a compact notification in the original channel with a jump link to the temporary channel.

### 2.3 Temporary Channel Name

Channel names use this format:

```text
scout-<code>-x<X>-y<Y>-<player>
```

Examples:

```text
scout-a3f9-x-50-y72-enemyname
scout-k8q2-x35-y-88-unknown
```

Rules:

- `<code>` is a random 4-character lowercase alphanumeric code.
- Coordinates are encoded as `x<X>-y<Y>` so negative values are unambiguous.
- `<player>` comes from `x_world.player` when available.
- If the map cache has no player for the coordinates, use `unknown`.
- Player names are lowercased, stripped to a Discord-safe slug, and truncated so the channel name stays within Discord limits.
- The embed and channel topic show the exact Travian coordinates, for example `(-50|72)`.

### 2.4 Temporary Channel Embed

The temporary channel keeps the current scout layout:

- `On it`
- `Submit Report`
- `Close`
- `Map`

The embed should also show:

- requester
- coordinates with Travian map link
- player/alliance from map cache when available
- notes
- minimum scouts needed when provided
- committed scout count when responders provide amounts
- report status

Members can chat normally in the temporary channel. They can paste screenshots, scout attempts, notes, or corrections. None of that is archived automatically.

## 3. Report Flow

### 3.1 On It

`On it` remains the commitment button. To support the optional minimum scout target, clicking it should open a modal asking how many scouts the user is sending.

The field is optional:

- Empty value records the user as `On it`.
- Numeric-looking text contributes to the committed scout count.
- Non-numeric text is allowed as a note but does not count toward the total.

The embed shows the responder list and, when a minimum was provided, the committed and remaining amounts.

### 3.2 Submit Report

Archiving is deliberate.

Clicking `Submit Report` does not immediately archive anything and does not inspect old images in the channel. Instead:

1. The bot opens a modal for an optional report note.
2. After the modal is submitted, the bot posts an ephemeral instruction telling that user to upload the final screenshot now.
3. The bot starts a 10-minute pending upload window for that user and that scout call.
4. The next valid image attachment from that same user in the temporary scout channel becomes the official report.
5. If no valid image arrives before the window expires, no report is archived and the user can click `Submit Report` again.

Only one official screenshot report is allowed per scout call in this version. If a report already exists, later submit attempts should reply that the scout already has an archived report.

### 3.3 Valid Screenshot

A valid official screenshot is an attachment with an image content type or image-like extension. Supported extensions should include at least:

- `png`
- `jpg`
- `jpeg`
- `webp`

The implementation should reject messages with no valid image, multiple images for the pending submit, or uploads from a different user than the pending submit owner.

### 3.4 Archive Entry

The bot posts the official report to the permanent `#scout-reports` channel.

The archive entry includes:

- call ID
- scout code
- coordinates
- target player/alliance from map cache when available
- requester
- reporter
- submitted time
- optional report note
- screenshot
- jump link back to the temporary channel while it exists

After the archive message is created, the bot updates the temporary scout embed with:

- reported by
- report time
- archive link
- deletion time, expressed as a Discord relative timestamp

## 4. Cleanup

The temporary scout channel is deleted 24 hours after the official report is submitted, not 24 hours after request creation.

Unreported scout channels are not deleted by this report-based cleanup rule. The `Close` button marks the call closed, but it should not delete an unreported channel unless a later admin cleanup feature is designed.

The cleanup job:

1. Runs periodically.
2. Finds reported scout calls whose `delete_after` timestamp has passed.
3. Deletes the temporary channel if it still exists.
4. Marks the temporary channel as deleted in the database.
5. Leaves `#scout-reports` and its archive messages untouched.

## 5. Data Model

The current `calls` and `pledges` tables are not enough for archived screenshots and channel lifecycle metadata. Add a dedicated table for scout report state.

Suggested table:

```sql
CREATE TABLE IF NOT EXISTS scout_reports (
  call_id             INTEGER PRIMARY KEY REFERENCES calls(id) ON DELETE CASCADE,
  scout_code          TEXT NOT NULL,
  temp_channel_id     TEXT NOT NULL,
  archive_channel_id  TEXT,
  archive_message_id  TEXT,
  reporter_id         TEXT,
  report_note         TEXT,
  screenshot_url      TEXT,
  reported_at         INTEGER,
  delete_after        INTEGER,
  temp_deleted_at     INTEGER,
  created_at          INTEGER DEFAULT (unixepoch())
);
```

Store request-level fields that affect rendering in `calls.payload`, including:

- `notes`
- `minScouts`
- `targetPlayer`
- `targetAlliance`
- `tempChannelId`
- `scoutCode`

Pending submit state can start in memory because it only needs to survive a 10-minute upload window. If restart resilience becomes important later, it can move into a small DB table.

## 6. Components and Data Flow

### 6.1 Setup

`src/commands/admin.js` or the existing setup path should gain scout setup helpers:

- find or create `Scouting`
- find or create `scout-reports`
- then deploy the scout panel with existing panel machinery

### 6.2 Scout Creation

`src/handlers/scoutCall.js` should:

1. Parse coordinates, notes, and optional minimum scouts needed.
2. Enrich target player/alliance from `x_world`.
3. Generate the 4-character scout code.
4. Create the temporary channel under `Scouting`.
5. Insert the `calls` row and `scout_reports` row.
6. Post the full scout embed and buttons in the temporary channel.
7. Store the scout message ID on the call.
8. Reply in the original channel with a compact jump-link message.

### 6.3 Message Attachment Handling

`src/index.js` currently routes interactions. It should also route message create events for scout report uploads, likely through a new handler module.

The upload handler should:

- ignore bot messages
- ignore channels not tied to a pending scout report submit
- ignore uploads when there is no pending submit for that user
- validate exactly one official image
- archive the report
- clear pending submit state
- update the scout embed

### 6.4 Archive Search Later

Search is intentionally not part of the first implementation, but the archive table should be designed so a later Scout Reports panel can support GUI filters:

- search by coordinates
- search by player
- search by alliance
- recent reports
- my reports

## 7. Error Handling

1. **Missing `Scouting` category during scout creation** - try to create it; if creation fails, reply privately with a setup error.
2. **Missing `scout-reports` during archive** - try to create it; if creation fails, keep the pending report unarchived and tell the user/admin.
3. **No permission to create channels** - reply with a clear error naming the missing capability.
4. **No permission to delete temp channel** - log warning and keep archive intact.
5. **Submit Report outside temp channel** - reply that reports must be submitted from the scout channel.
6. **Report already exists** - reply with the archive link.
7. **Pending upload expired** - ignore later images and tell the user to click `Submit Report` again.
8. **Wrong user uploads during another user's pending submit** - ignore it as normal chat.
9. **Multiple image attachments** - reject and ask for exactly one final screenshot.
10. **Discord archive post fails after image upload** - do not mark reported; let the user retry.

## 8. Testing

Focused tests should cover the risky behavior without mocking every Discord detail.

Add or extend tests for:

1. Scout request stores `minScouts`, target metadata, scout code, and temp channel ID.
2. Channel name slugging handles negative coordinates, unknown player, long player names, and unsafe characters.
3. `On it` with numeric text contributes to committed scout count.
4. `On it` with empty text records a responder but does not affect committed count.
5. `Submit Report` creates pending upload state for the clicking user only.
6. Upload with no pending state is ignored.
7. Upload by the wrong user is ignored.
8. Upload with one valid image archives and marks the report submitted.
9. Second official report attempt is rejected.
10. Cleanup deletes only reported scout channels where `delete_after <= now`.
11. Cleanup does not delete unreported scout channels.

Manual verification should include a real Discord run because channel creation, attachment URLs, and message embeds depend on Discord API behavior.

## 9. Out of Scope

- Multiple official screenshots per scout call.
- Full archive search GUI.
- Automatic archiving of arbitrary screenshots pasted in temp channels.
- Auto-deleting unreported abandoned scout channels.
- Restricting temporary channel permissions beyond inheriting the `Scouting` category.
- Moving defense/offense reporting into the same system.

## 10. Open Questions

None. The approved decisions are:

- use real temporary channels, not threads
- create channels under `Scouting`
- inherit category permissions
- use `scout-reports` as the permanent archive
- archive only after `Submit Report`
- allow normal chat and screenshot pasting before official submission
- allow one official screenshot for now
- delete the temp channel 24 hours after report submission
- use `scout-<code>-x<X>-y<Y>-<player>` channel names
