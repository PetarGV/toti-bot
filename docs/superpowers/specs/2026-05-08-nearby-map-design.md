# Nearby Map General Panel Design

## Summary

Add a Discord-native nearby map lookup to the existing Travian alliance bot. The feature is GUI-first: the General panel gets a `Nearby Map` button that opens a modal, accepts coordinates, and returns nearby villages from cached `map.sql` data. A matching `/nearby` slash command will also be added for keyboard users, following the bot's existing pattern of panel actions having command mirrors.

## Goals

- Give alliance members a quick general-intel view of what villages are near a coordinate.
- Keep the feature inside Discord rather than adding a browser map.
- Reuse the existing `x_world` cache populated by `/admin fetch-map` and the daily map fetch job.
- Keep results readable in Discord embeds.
- Design the first version so later filters by alliance, tribe, population, or player can be added without rewriting the core search logic.

## Non-Goals

- No full graphical web map in this version.
- No live Travian scraping beyond the existing `map.sql` fetch flow.
- No pathfinding, troop travel-time calculation, or defender suggestion logic.
- No persistent saved searches or alerts.

## User Experience

### General Panel

When an admin runs `/setup general`, the pinned Status & Overview panel will include a new `Nearby Map` button. Clicking it opens a modal.

The modal contains:

- `coords`, required, accepting the existing coordinate formats such as `10|-20`, `(10|-20)`, and `10/-20`.
- `radius`, optional, defaulting to `10`.
- `limit`, optional, defaulting to `10`.

The modal reply is ephemeral so lookup results do not spam the channel.

### Slash Command

Add `/nearby coords:<x|y> [radius] [limit]`.

The slash command returns the same result format as the General panel modal. This keeps the feature accessible to users who prefer commands and matches existing bot behavior where panel actions have slash command equivalents.

## Result Format

The bot replies with an embed titled similar to `Nearby villages around (10|-20)`.

The embed includes:

- Search center.
- Radius.
- Number of returned villages.
- Last map update timestamp when available.

If the exact coordinate is a village, it appears first as `Center village`.

Nearby results are sorted by distance, nearest first. Each result line includes:

```text
1. (12|-20) 2.0 fields - Village Name - Player [Alliance] - 512 pop - Romans
```

The coordinate text links to the Travian map URL for that village.

Only villages in `x_world` are shown. Empty terrain is not listed.

## Search Behavior

The search uses Euclidean distance:

```text
sqrt((village.x - center.x)^2 + (village.y - center.y)^2)
```

The implementation should:

- Query only rows inside the square bounding box first for efficiency.
- Compute exact distance in JavaScript.
- Keep rows whose distance is less than or equal to the selected radius.
- Sort by distance, then population descending, then coordinates for deterministic ordering.
- Separate the exact center village from nearby results when the center exists.

## Validation And Limits

- Invalid coordinates use the bot's existing coordinate validation behavior.
- If map data is empty, the bot tells the user to run `/admin fetch-map`.
- Radius is clamped to `1-50`.
- Limit is clamped to `1-20`.
- If no villages are found within the radius, the bot replies with a clear empty-state message.
- Nature and unoccupied rows can appear if they exist in `x_world`, using the same tribe mapping behavior as `/whois`.

## Implementation Boundaries

### `src/utils/mapSearch.js`

Owns reusable map-search behavior:

- Clamp radius and limit.
- Calculate distance.
- Fetch nearby `x_world` rows through the existing DB shim.
- Format row metadata needed by handlers.

This keeps search logic independent from Discord interaction code and easy to test.

### `src/handlers/nearby.js`

Owns Discord interaction behavior:

- Handle `/nearby`.
- Handle `general:nearby` button clicks.
- Handle nearby modal submission.
- Build the embed and link row payload.

### Wiring Files

- `src/panel/types.js`: add `Nearby Map` to the General panel.
- `src/commands/definitions.js`: add `/nearby`.
- `src/handlers/router.js`: route command, button, and modal interactions.
- `README.md` and `COMMANDS.md`: document the new command and General panel button.

## Error Handling

The feature follows current bot patterns:

- User input errors are ephemeral replies.
- Unexpected errors are caught by the central router and logged.
- Missing map data produces a user-facing message, not a stack trace.

## Testing

Focused test coverage should be added for the pure map-search utility:

- Radius and limit clamping.
- Distance sorting.
- Center village separation.
- Empty result behavior.
- Deterministic ordering when distances match.

At minimum, changed source files must pass `node --check`, matching current CI. If a small Node test script is added, it should be runnable without Discord credentials.

## Future Extensions

The first version intentionally keeps the interface small. Later versions can add:

- Alliance/player filters.
- Tribe filters.
- Minimum population filter.
- Enemy/friendly tagging if the bot later gains alliance relation data.
- Browser map view backed by the same search utilities.
