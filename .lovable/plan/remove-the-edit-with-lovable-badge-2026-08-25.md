# Remove the "Edit with Lovable" badge

## What will change
- The "Edit with Lovable" floating badge/widget on the published site will be hidden.
- No source files, UI, or app functionality will be modified.

## How
1. Read the current badge visibility setting (already done: `hide_badge` is `false`).
2. Call `publish_settings--set_badge_visibility` with `hide_badge: true` to disable the badge on the published deployment.
3. Verify the badge is hidden by checking the updated setting.

## Note
- Hiding the Lovable badge requires a Pro plan or higher. If the workspace is on a lower tier, the operation will report that limitation and the badge will remain visible.
- This change affects only the published/custom-domain site preview badge, not the in-editor Lovable toolbar or project branding.
