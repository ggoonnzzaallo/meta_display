# PostHog post-wizard report

## Summary

All 19 registered Meta Display apps now use the same telemetry-v3 integration. It groups nearby pageviews per app into a 30-minute inactivity session while retaining a stable, anonymous installation identifier for recognizing repeat use from the same browser storage. Leaf's upload page stays within the Leaf app identity. The implementation remains dependency-free and defers all network analytics work until after each application has loaded.

Each launch sends one `$pageview`. Session state is checkpointed locally every 30 seconds and after instrumented interactions, without network requests. Once a later launch occurs after at least 30 minutes of inactivity, it sends one `meta_display_session_ended` event for the prior session with its checkpointed duration and interaction totals. This does not depend on the glasses firing an unload event.

## Events

| Event | Description | File |
| --- | --- | --- |
| `$pageview` | Records a launch, reusing its UUIDv7 `$session_id` while activity remains within the 30-minute session window. | `visit-analytics.js` |
| `meta_display_session_ended` | Finalizes a prior inactive session on a later launch using its last local duration and interaction checkpoint. | `visit-analytics.js` |

Every app reports the shared launch, session, device, browser, viewport, locale, timezone, referrer, and approximate network-derived location properties. Situation additionally accumulates refresh successes/errors, empty feeds, maximum headline count, headline opens, and detail navigations in memory for its end-of-session summary.

## PostHog dashboard

- [Analytics basics](https://us.posthog.com/project/408524/dashboard/2059511)
- [Situation launches](https://us.posthog.com/project/408524/insights/vgNsb8GL)
- [Verified Situation sessions](https://us.posthog.com/project/408524/insights/GJdO9Qm2)
- [Average Situation session duration](https://us.posthog.com/project/408524/insights/tNdjOiHG)
- [Unique sessions by app](https://us.posthog.com/project/408524/insights/yOZONYlo)
- [App launches by app](https://us.posthog.com/project/408524/insights/aa03P3BC)

The telemetry-version-3 insights will remain empty until these changes are deployed and new launches occur.

## Validation

- Five Node tests cover all registered app entry pages, Leaf upload, launch payloads, adjacent-pageview session reuse, installation persistence, delayed finalization, duration, and counters.
- JavaScript syntax checks pass.
- The analytics helper is approximately 3.8 KB gzipped.

## Next steps

1. Deploy the updated app entry pages.
2. Open several apps and confirm each appears separately in the cross-app dashboard insights.
3. Launch an app again after 30 minutes of inactivity to finalize its previous session and populate duration.
4. Treat the most recent session as provisional until a later launch finalizes it.

### Agent skill

The PostHog JavaScript integration workflow kept telemetry lightweight, documented the event contract, verified the implementation, and created the initial operational dashboard.
