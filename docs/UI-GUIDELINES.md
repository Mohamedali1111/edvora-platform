# UI Guidelines

## Quality Bar

Edvora UI must be professional, responsive, accessible, and suitable for a real commercial SaaS product. Do not design a generic bloated LMS. Build focused workflows for students, instructors, and platform operators.

This document does not define final fonts, colors, logos, or visual branding. Those choices are intentionally deferred.

## Arabic and English

Arabic and English are mandatory from the beginning.

- English uses LTR direction.
- Arabic uses RTL direction.
- UI copy must not be hardcoded inside product components once implementation begins.
- Use localization keys consistently.
- Do not create duplicated Arabic and English screen implementations.
- Components must support both directions.
- Layouts must remain correct with longer translations.
- Arabic and English must receive equal QA attention.

## Directionality

Text alignment, spacing, navigation, forms, tables, dialogs, menus, and back/forward interactions must work properly in both RTL and LTR.

Use logical layout concepts where possible. Avoid manually duplicating Arabic layouts.

Icons whose direction conveys meaning should mirror appropriately in RTL. Icons that represent fixed concepts, objects, brands, or non-directional actions should not be mirrored.

## Mobile Requirements

The student mobile app must support realistic modern iPhone and Android screen sizes.

Implementation must account for:

- Safe areas.
- Keyboard behavior.
- Dynamic content sizes.
- Long Arabic and English content.
- Loading, empty, error, success, offline/network-error, and disabled states.
- Accessibility labels, focus behavior, contrast, and touch target sizes.
- Intentional orientation decisions.
- No arbitrary fixed-width layouts.

The mobile architecture may require Expo development/custom builds for native security capabilities and must not depend on Expo Go.

## Web Requirements

The instructor/admin web dashboard must work professionally on desktop, laptop, tablet, and reasonable smaller widths.

Implementation must account for:

- Responsive navigation.
- Tables and dense management screens that degrade gracefully on smaller viewports.
- No overlapping text or controls.
- No horizontal overflow caused by Arabic or English translations.
- Clear loading, empty, error, success, and disabled states.
- Keyboard navigation and screen-reader compatibility.

## Accessibility

Accessibility is required from implementation time. Future UI work should consider semantic structure, labels, focus order, color contrast, touch/click target sizes, reduced-motion needs, and understandable error messages.

## State Handling

User-facing workflows should explicitly handle loading, empty, error, success, disabled, unauthorized, forbidden, offline/network-error, and stale-data states where relevant.

## Visual QA

UI work must receive visual QA, not only typechecking or build verification. Future tasks that add UI should include screenshot or browser/device inspection where practical, including both Arabic/RTL and English/LTR states for affected surfaces.

## Avoided UI Patterns

- Do not use generic template LMS screens without adapting them to Edvora's focused V1 scope.
- Do not overuse cards for every page section.
- Do not rely on tiny hidden controls for critical security or admin workflows.
- Do not create layouts that only work for short English text.
- Do not define final visual branding until explicitly requested.
