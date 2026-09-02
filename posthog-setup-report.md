# PostHog post-wizard report

## Summary

Meta Display analytics now treats every web-app launch as a distinct PostHog session while retaining a stable, anonymous installation identifier for recognizing repeat use from the same browser storage. The implementation stays dependency-free and defers all analytics work until after the application has loaded.

Each launch sends one `$pageview`. A single best-effort `meta_display_session_ended` event is sent when the page becomes hidden or unloads, carrying measured duration and in-memory interaction totals. No heartbeat or per-interaction network requests were added.

## Events

| Event | Description | File |
| --- | --- | --- |
| `$pageview` | Records a launch with a fresh UUIDv7 `$session_id`, anonymous installation ID, app metadata, viewport, locale, timezone, and browser-provided device/OS context. | `visit-analytics.js` |
| `meta_display_session_ended` | Records best-effort elapsed session duration and accumulated Situation interaction counters using the same `$session_id`. | `visit-analytics.js` |

Situation currently accumulates refresh successes/errors, empty feeds, maximum headline count, headline opens, and detail navigations in memory for the end-of-session summary.

## PostHog dashboard

- [Analytics basics](https://us.posthog.com/project/408524/dashboard/2059511)
- [Situation launches](https://us.posthog.com/project/408524/insights/vgNsb8GL)
- [Verified Situation sessions](https://us.posthog.com/project/408524/insights/GJdO9Qm2)
- [Average Situation session duration](https://us.posthog.com/project/408524/insights/tNdjOiHG)

The telemetry-version-2 insights will remain empty until these changes are deployed and new launches occur.

## Validation

- Three Node tests cover launch payloads, unique session IDs, installation persistence, duration, counters, and end-event deduplication.
- JavaScript syntax checks pass.
- The analytics helper is approximately 3.2 KB gzipped.

## Next steps

1. Deploy the updated shared analytics file and Situation app references.
2. Launch Situation from the glasses several times and close or background it normally.
3. Confirm that launch count and verified unique sessions rise together and that duration begins populating.
4. Treat missing end events as abruptly terminated launches; pageviews still preserve the launch count.

### Agent skill

The PostHog JavaScript integration workflow kept telemetry lightweight, documented the event contract, verified the implementation, and created the initial operational dashboard.
