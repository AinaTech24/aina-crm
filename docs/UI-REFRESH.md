# Workspace design refresh

The web CRM now shares a navy and neutral design system. Existing tenant brand
colors, font choices and density preferences remain supported. The stock theme
and the Appearance preview use the same generated brand tokens.

## Implemented

- Inter for body text and Manrope for display headings and headline metrics.
- Quiet navigation highlights, readable group labels, a persistent explicit
  collapse control, and contextual breadcrumbs based on accessible modules.
- Consistent page spacing, search, cards, KPI surfaces, table headers, fields,
  dialogs, empty states and loading placeholders.
- Coordinated login, signup and password-recovery branding.
- Responsive pagination, bounded main-pane width, keyboard-accessible table
  scrolling, skip navigation, labelled collapsed links, larger touch actions
  and reduced-motion support.

Shared styles live in `src/app/globals.css`. Keep colors semantic and implement
future screens with the shared components rather than page-specific palettes.
The desktop sidebar expands only through its button, preventing pointer movement
from resizing the page while users work.

## Verification

- TypeScript and ESLint checks passed for the updated implementation.
- Tailwind stylesheet compiled successfully.
- Login visually inspected at desktop (1440 px) and phone (390 px) widths.
- Authenticated browser verification remains pending: the documented demo login
  was rejected by the local database. No authentication controls or credentials
  were changed to work around this.

After signing in, verify the dashboard, Clients, Leads, Tasks, settings and a
record form at desktop and phone sizes, including pagination, table scrolling,
sidebar collapse, keyboard navigation and custom tenant branding. This is a
shared-system refresh; it is not a claim that every individual route has received
a separate visual acceptance review. The native Expo app is unchanged.
