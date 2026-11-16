# Plugin design tokens

Sources inspected:
- `sit-aap-fe/src/styles/theme.css`: AAP neutral navy brand, IBM Plex Sans family, semantic colors and radii.
- `sit-course-builder-app/src/styles/theme.css`, `radius.css`: Course Builder orange brand and its radius scale.

The plugin uses AAP light-theme tokens as a self-contained snapshot in `ui.html :root`. Course Builder uses a different brand and radius scale, so its values are not mixed with AAP. CSS consumers use semantic variables rather than hardcoded colors. No absolute app paths or Tailwind runtime are required by the distributed plugin. Refresh the snapshot intentionally when the source theme changes; this is not automatic inheritance.

IBM Plex Sans is preferred only when installed; system sans is the fallback. No remote font request is made. The plugin remains light-themed; dark mode parity is not implemented.
