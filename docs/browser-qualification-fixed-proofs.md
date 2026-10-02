# Fixed idle and media qualification proofs

These additional operations belong only to the existing disabled-by-default,
actor-bound 600-second qualification job. They retain its HMAC/CSRF/origin/tenant/
principal/revision, 45-second requests, 64-request and 64-KiB bounds. The helper,
controller and frontend do not execute sites, scripts or host commands.

Each new request contains exactly `operation` and `label`. Idle is bound to
fixture A (`labels[0]`); media is bound to B (`labels[1]`). URLs, scripts,
selectors, paths, values, labels arrays and extra scalars are refused. Replies
contain exactly the operation's boolean fields; observed false cannot qualify
an assertion. The form checks the same field sets before submission, then the
broker validates before publication. Generic controller admission, duplicate-key
and body bounds are unchanged.

| Operation | Actual operator observation |
| --- | --- |
| `close_dock_for_idle` | Close only A's dock; retain its tab/connection, preserve B, observe no browser Start/Close. Separate Native/host proof establishes capture pause. |
| `reopen_dock_after_idle` | Reopen A normally: same running browser, fresh Attach, unchanged B and no browser Start/Close. |
| `observe_media_surfaces` | B's three decoded surfaces, changing canvas/video orange/blue pixels and versions, decoded video-frame/time progress, unsupported frame orange, no input. |
| `observe_media_frame_change` | After one separate Native effect: same unsupported surface, advancing version and decoded blue pixels, three surfaces visible, no input. |

The shared viewer snapshot matches the coordinated Core media source byte-for-byte.
Public localized IMG nodes carry source node/version and public browser/incarnation/
document/capture fences; private/disconnected/unavailable/stopped/disposed views
clear public identity. Metadata is observation, never authority. Keep raw JPEGs
only in the bounded operator Node-side decoder; no images, content, URL or
credential enters proof replies.

Schema and mounted-viewer contracts are prepared, not native passing evidence.
Root owns the coordinated final Core/Web checks, publication/deployment, exact
snapshot/helper pins and actual qualification. Do not enable old helper/new
driver combinations or reuse expired jobs. No tests/build/native effects ran
in preparation.
