# UI Prototype

Generate **several radically different UI variations** on a single route, switchable from a floating bottom bar. The user flips between variants in the browser, picks one (or steals bits from each), then throws the rest away.

If the question is about logic/state rather than what something looks like — wrong branch. Use [LOGIC.md](LOGIC.md).

## When this is the right shape

- "What should this page look like?"
- "I want to see a few options for this dashboard before committing."
- "Try a different layout for the settings screen."

## Sub-shape A — adjustment to an existing page (preferred)

Variants are rendered **on the same route**, gated by a `?variant=` URL search param. The existing data fetching, params, and auth all stay — only the rendering swaps.

## Sub-shape B — a new page (last resort)

Only when the thing being prototyped genuinely has no existing page to live inside. Create a **throwaway route** following whatever routing convention the project already uses.

## Process

### 1. State the question and pick N

Default to **3 variants**. More than 5 stops being radically different and starts being noise.

### 2. Generate radically different variants

Draft each variant. Variants must be **structurally different** — different layout, different information hierarchy, different primary affordance, not just different colours.

### 3. Wire them together

Create a single switcher component on the route. Use a URL search param (`?variant=A`).

### 4. Build the floating switcher

A small fixed-position bar at the bottom-centre. Left/right arrows cycle variants. Keyboard `←` and `→` also cycle. Hidden in production.

### 5. Hand it over

Surface the URL.

### 6. Capture the answer and clean up

Once a variant has won, delete the losing variants and the switcher; fold the winner into the existing page.

## Anti-patterns

- Variants that differ only in colour or copy.
- Sharing too much code between variants.
- Wiring variants to real mutations.
- Promoting the prototype directly to production.
