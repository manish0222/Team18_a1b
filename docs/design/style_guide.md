# RideSync visual style

The console should feel like a calm piece of transport signage: dark slate navigation, clean white working surfaces, and one warm "live" colour. Tokens live in `web/src/styles/tokens.css`, and every screen uses only these.

## Colour

| Token | Hex | Used for |
|---|---|---|
| `--ink` | `#1B2430` | text, sidebar, plate lettering |
| `--paper` | `#F4F6F8` | page background |
| `--surface` | `#FFFFFF` | panels, inputs |
| `--line` | `#D9DEE4` | borders, table rules |
| `--signal` | `#0B7A72` | primary buttons, positive numbers, chart series 1 |
| `--auto` | `#F2B705` | **"live" only**: active trip, map origin, new pings, current step |
| `--danger` | `#C2412D` | debits, failures, cancel buttons |

Rule: yellow (named after auto-rickshaws) means "happening now". It is never used for decoration, so when it appears it draws the eye to something live.

## Type

- **Barlow** (400/500/600) for all UI text. It is a grotesk modelled on road signage, so it fits the subject and reads well at small sizes.
- **Barlow Condensed** (600) for page titles, big numbers (balances, stats, ranks) and licence plates.
- Both are bundled through `@fontsource`, so the app needs no font CDN and works offline.
- Scale: 0.78 / 0.875 / 1 / 1.25 / 1.6 / 2.15 rem. Body line-height is 1.5, and intro text is capped at 72 characters per line.
- Labels use sentence case. There are no all-caps eyebrow labels.

## The signature element: the plate

Every vehicle reference, in tables, the map list, pickers and headers, is drawn as an Indian HSRP-style number plate. It has a white face, a dark border and a blue `IND` band. A plate is what riders and dispatchers actually look for, so it identifies the vehicle faster than a UUID. Sizes: `sm` in tables, `md` in forms, `lg` on the vehicle page.

## Components (`web/src/components/ui.tsx`)

| Component | Notes |
|---|---|
| `Button` | `primary` (teal, one per area), `secondary` (outlined), `ghost`, `danger` (outlined red); sizes `sm`/`md`; a `busy` state disables the button and sets `aria-busy` |
| `Panel` | white surface, 10 px radius, 1 px border, no shadow. Variants: `--live` (yellow left bar), `--success` (teal bar), `--error` (red bar) |
| `TextInput`, `SelectInput`, `Field` | label above, hint or error below; the error is announced with `role="alert"` |
| `SearchPicker` (Rider/Vehicle) | type-ahead combobox that queries the API (8 results), with arrow-key navigation |
| `DataTable` + `Pagination` | hairline rows, right-aligned tabular numbers, clickable rows reachable by keyboard, "1–25 of 10,000" |
| `Avatar` / `PersonCell` | initials on one of 8 muted colours chosen from the name, so the same rider always looks the same; used wherever a person appears (lists, pickers, sidebar, headers) |
| Nav icons | 18 px stroke icons beside every nav label (`components/icons.tsx`); decorative, label always shown |
| `StatusBadge` | coloured dot + word: Requested (yellow), In transit (blue), Completed (teal), Cancelled (hollow grey) |
| `Stat` | condensed big number + label + optional note |
| `Segmented` | small option sets (period, ping window, status filter) |
| `LoadingBlock` / `EmptyState` / `ErrorState` | used by `AsyncContent` on every data view, so no screen is ever blank |
| Charts | hand-written SVG `LineChart`, `BarChart`, `HBarList` with tooltips and `aria-label`s |

## Layout

- Desktop: a 264 px sidebar with navigation grouped by user (Rider / Operations / Records), the "Acting as" switcher at the top, and content up to 1320 px wide.
- Under 900 px the sidebar becomes a top bar with a Menu button, and every grid collapses to one column.
- Under 560 px secondary table columns hide and tables scroll sideways inside their panel. The page itself never scrolls sideways; this is checked on every route at 390 px.

## Accessibility

Focus rings are always visible. Every input has a label, and chart SVGs have accessible names. Toasts use `aria-live`, and error panels use `role="alert"`. Animations stop under `prefers-reduced-motion`. Text colours meet 4.5:1 contrast on their backgrounds; muted text is `#5D6875` on white, about 5.6:1.

## UX pass (v2): what changed and why

| Problem seen in review | Change |
|---|---|
| A first-time user lands with no rider and must guess a name | **Start here** panel on the Overview suggests four riders who can book right away; one click acts as them and opens booking |
| Booking asks for a plate nobody knows | **Available near HITEC City**: the four nearest available vehicles (same `$geoNear` endpoint as the map) are one-click choices |
| Overspending is only discovered after submitting | The fare field says, before submit, what will be left, or that the fare exceeds the balance and the database will refuse it (the button still works, so the refusal can be demonstrated) |
| The primary button did not say what it costs | Button reads **Book trip · ₹45.00** |
| On phones the result appeared off-screen below the form | After booking, the result scrolls into view and receives focus (screen readers announce it) |
| Rows are hard to tell apart in a 10,000-rider list | Avatars with initials; name and email stacked in one cell |
| Clickable rows had no visual cue | A › chevron on every clickable row, turning teal on hover |
| "Ride" and "trip" used interchangeably | One word everywhere: **trip** |
| Every page had the same browser-tab title | Per-page titles (e.g. "Book a trip · RideSync") |
| Keyboard users had to tab through the whole sidebar | "Skip to content" link as the first focusable element |
| US names and plates in a Hyderabad product | Indian names, `@example.in` emails, Indian plates (`TS 09 EK 4821`) via `sql/09_localize_india.sql` and the seeders |
