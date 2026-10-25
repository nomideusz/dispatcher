---
name: Dispatcher
description: A dispatch office's docket book for a Railway template catalog. Navy ink and hairline rules on docket paper.
colors:
  docket-paper: "#f6f4ee"
  navy-ink: "#1d2433"
  ink-light: "#4b5366"
  carbon: "#e8e1cf"
  carbon-well: "#ece6d7"
  hairline: "#cdc7b6"
  field-rule: "#a9a493"
  top-sheet: "#fbfaf6"
  action-blue: "#1f56a3"
  held-red: "#b23a2e"
  running-green: "#2d6a4f"
  caution-ochre: "#8a5f0e"
  series-teal: "#2e7d8c"
  series-ochre: "#9a6b12"
  series-plum: "#8a4f86"
  series-other: "#8b8574"
  carbon-copy-ground: "#141a26"
  carbon-copy-ink: "#f1ede3"
  carbon-copy-ink-light: "#bcc0c9"
  carbon-copy-tray: "#222b3d"
  carbon-copy-rule: "#354057"
  carbon-copy-sheet: "#1c2433"
  carbon-copy-bar: "#0d121b"
  carbon-copy-action: "#8db8f2"
  carbon-copy-held: "#ec8a7e"
  carbon-copy-running: "#6fbf97"
typography:
  display:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "2.125rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "IBM Plex Sans Condensed, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "IBM Plex Sans Condensed, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
  subtitle:
    fontFamily: "IBM Plex Sans Condensed, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.375
  body:
    fontFamily: "IBM Plex Sans Condensed, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  figure:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    letterSpacing: "-0.02em"
  label:
    fontFamily: "IBM Plex Sans Condensed, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.33
  stamp:
    fontFamily: "IBM Plex Sans Condensed, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 700
    letterSpacing: "0.06em"
rounded:
  none: "0px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  gutter: "32px"
  shell-lg: "40px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.top-sheet}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "0 10px"
    height: "32px"
  button-secondary:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.navy-ink}"
    rounded: "{rounded.none}"
    padding: "0 10px"
    height: "32px"
  button-ghost:
    textColor: "{colors.navy-ink}"
    rounded: "{rounded.none}"
    padding: "0 10px"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "{colors.carbon-well}"
  range-toggle:
    backgroundColor: "{colors.carbon-well}"
    textColor: "{colors.ink-light}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "2px"
  range-toggle-active:
    backgroundColor: "{colors.docket-paper}"
    textColor: "{colors.navy-ink}"
    height: "28px"
  nav-bar:
    backgroundColor: "{colors.navy-ink}"
    textColor: "{colors.docket-paper}"
    height: "56px"
  docket-cell:
    backgroundColor: "{colors.docket-paper}"
    textColor: "{colors.navy-ink}"
    typography: "{typography.display}"
    rounded: "{rounded.none}"
    padding: "16px 20px"
  held-tray:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.navy-ink}"
    rounded: "{rounded.none}"
    padding: "14px 20px"
  dialog:
    backgroundColor: "{colors.top-sheet}"
    textColor: "{colors.navy-ink}"
    rounded: "{rounded.none}"
    padding: "16px"
  text-field:
    textColor: "{colors.navy-ink}"
    typography: "{typography.figure}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "36px"
---

# Design System: Dispatcher

## Overview

**Creative North Star: "The Dispatch Docket"**

Dispatcher is kept like a dispatch office's docket book. The ground is docket paper, the ink is navy, and structure comes from 1px rules and hairline-boxed cells, not from cards, tints or shadows. Words are set in IBM Plex Sans Condensed. Every figure and every template code is set in IBM Plex Mono, so columns of money line up like carbon copies. The page reads from the top in a fixed order: what is held, then the day's takings, then each template as a row in a consignment table.

The tone is Operate mode and leads with code. Density is high and rows are tight, and color is used only to say what is going on. Navy ink does the work, carbon trays group things, held red marks only what needs a person, and one action blue marks only what can be pressed. The dark theme is the carbon copy: navy ground with paper ink, and the same roles shifted lighter.

The page refuses the KPI-card grid with a chart hero. The headline numbers sit in one ruled docket strip, and the charts sit below the Held tray.

**Key Characteristics:**
- Docket paper ground, navy ink, 1px hairline rules and square corners everywhere.
- Plex Sans Condensed for words, Plex Mono for every figure and code.
- No cards and no shadows. Containers are hairline-boxed cells or carbon trays.
- Held red and action blue are scarce. Each carries one meaning only.
- A navy bar at the top. The dark theme is the carbon copy.

## Colors

Warm paper and navy ink, with two scarce signal colors and a chart series that stays tied to ink.

### Primary
- **Action Blue** (action-blue; carbon-copy-action in dark): the only fill for things that can be pressed: the primary button, inline action links ("80 templates behind on upgrades"), the focus ring, text selection, the caret and native control accents.

### Secondary
- **Held Red** (held-red; carbon-copy-held in dark): only for what needs you now. That covers the Held tray stamp, held template names (underlined in red), the "held · NN%" health cell, the held-mark row, errors and destructive actions.
- **Running Green** (running-green; carbon-copy-running in dark): rising deltas, the "Nothing held" stamp and the second chart series.

### Tertiary
- **Caution Ochre** (caution-ochre): chores rather than alarms, such as an unsorted template kind or an upgrade to take.
- **Chart series**: navy ink comes first (the kickback line), then running green, teal, ochre and plum, with a warm grey for "other". The steps differ in lightness and hue so they stay apart under color-vision deficiency, and each is at least 3:1 on paper. In dark mode the first series becomes carbon (#e8e1cf).

### Neutral
- **Docket Paper** (docket-paper): the page ground and the ground of every cell. Cards share it, so they disappear into the page.
- **Navy Ink** (navy-ink): body text, the top bar, section rules and the first chart series.
- **Ink, Set Lighter** (ink-light): secondary text, meta lines and falling deltas. It is still ink.
- **Carbon** (carbon): the Held tray and the selected secondary button.
- **Carbon Well** (carbon-well): hover fills and the range toggle's well.
- **Hairline** (hairline): every 1px rule, cell border and the table header's underline.
- **Field Rule** (field-rule): input borders, which are one step darker than the hairlines.
- **Top Sheet** (top-sheet): dialogs and popovers, which are one step lighter than paper. This tone separates the floating layer.

### Named Rules
**The Ink, Not Grey Rule.** Secondary text is navy ink set lighter (#4b5366), never a neutral grey. A falling figure is information, not an alarm, so "down" is ink too.

**The One Meaning Rule.** Blue means "press this". Red means "this needs you". Neither appears as decoration, as a heading color or as a fill for brand moments.

## Typography

**Body Font:** IBM Plex Sans Condensed (weights 400, 500, 600 and 700, with ui-sans-serif and system-ui as fallbacks)
**Figure/Code Font:** IBM Plex Mono (weights 400, 500 and 600, with ui-monospace as fallback)

**Character:** The condensed sans fits a lot of words into a narrow docket, and the mono makes every figure line up in columns like carbon. The two are used together everywhere, and the job of the text decides which one applies, not the page.

### Hierarchy
- **Display** (Mono 600, 34px on desktop and 26px on phones, line-height 1): the four headline figures in the docket strip, and nothing else.
- **Headline** (600, 28px, tight): the page title (Today, Decide, Payouts) with a one-line freshness sub under it.
- **Title** (600, 20px): section titles that sit above a full-ink rule, with a description of at most 75ch under them.
- **Subtitle** (600, 16px): titles for sub-blocks inside a section, such as All templates and Kickback per day.
- **Body** (400, 14px): descriptions, held reasons and dialog copy.
- **Figure** (Mono 400, 14px, -0.02em): every number in tables, legends, deltas and toggles. The tabular-nums utility switches to the mono face.
- **Label** (500, 12px): table headers and filter chips. Template codes use 12px Mono in ink-light.
- **Stamp** (700, 14px, uppercase, 0.06em tracking): the DISPATCHER wordmark and the Held tray's status ("HELD · 3" or "Nothing held"). It always sits inline with its content and is never stacked above a heading.

### Named Rules
**The Carbon Column Rule.** If it is a number or a code, set it in Plex Mono. No figure is set in the sans.

## Layout

The layout is one shell, at most 1600px wide, with side padding of 16, 24 and 40px at the base, sm and lg breakpoints. The navy bar and every page share it. Pages stack vertically with 24px between blocks. Each section opens with a title and description above a full-ink 1px rule. Under the rule, sub-blocks split across a 12-column grid (7/5 on lg) with a 32px gutter and a hairline divider between them.

The docket strip is a ruled grid of four cells, made by laying 1px gaps over the hairline color. It shows 2 columns on phones and 4 on lg. Each cell has 16px of padding (20px horizontal from sm up). The Held tray spans the full width directly below it. Tables run full-bleed inside their section, with tight 8px row padding and hairline row rules. They scroll inside a 36rem box whose bottom edge fades while more rows remain.

On phones, the bar drops the wordmark text to the mark alone and labels to icons, the code column hides, and the docket keeps 2 columns so the key numbers read in one screen.

## Elevation & Depth

The system is flat. Depth comes from tone and rules: carbon trays sit on paper, and the top sheet (dialogs and popovers) is one step lighter than paper, with a 1px ink ring at 10% opacity over a navy scrim at 40%. No resting surface casts a shadow. The only inset rules are structural: the sticky table header's 1px underline and the held-mark row's red top and bottom rules.

### Named Rules
**The Carbon, Not Shadow Rule.** To set something apart, put it on carbon or box it with a hairline. Never lift it.

## Shapes

Every corner is square (radius 0, the root radius that every component scale derives from). Edges are 1px hairlines, or full navy ink where a section opens. The current page in the bar is marked by a 3px bottom rule in currentColor. Only the avatar and the hairline-thin lifetime meter in table cells are rounded. The brand mark is three staggered square bars.

## Components

### Buttons
Square, compact and quiet. Ink-colored ghost buttons are the norm, and the action blue is saved for a single committing action.
- **Shape:** square corners (0px). Heights are 32px by default, 28px small and 24px extra small. On coarse pointers all of them grow to 36px.
- **Primary:** filled with action blue and set in 14px weight 500, with top-sheet text. It is used for committing actions such as "Save" in auto-withdraw and "Sign in with Railway".
- **Hover / Focus / Active:** on hover the fill drops to 88%. Focus shows a 3px ring in action blue at 50%. On press the button moves down 1px.
- **Secondary:** filled with carbon. It also marks the pressed state of filter chips.
- **Ghost:** ink text with a carbon-well fill on hover. The bar uses it for refresh, notifications, auto-withdraw and the account menu.
- **Destructive:** held red text on a 10% red tint.

### Chips (filters)
- **Style:** extra-small buttons, ghost when off and secondary (carbon) when pressed, each with a count in mono ink-light.

### Range Toggle
- **Style:** a carbon-well segment group inside a hairline box with 2px padding. Labels are 12px mono ("7d", "30d", "90d"). The active segment is lifted onto paper with a 1px ink ring at 25%.

### Cards / Containers
- **Corner Style:** square.
- **Background:** docket paper, the same as the page, so a card is only a grouping and never a visible tile.
- **Shadow Strategy:** none.
- **Border:** none by default. Dividers between cards are hairlines.
- **Internal Padding:** 16px, or 12px for the small size.

### Inputs / Fields
- **Style:** square, 36px tall, with a 1px field-rule border and a transparent fill. Values that are code, such as cron specs, are set in mono.
- **Focus:** a 2px action-blue ring.
- **Error:** a held-red border, with the message in red below.

### Navigation
- **Style:** a sticky navy bar 56px tall that holds the stamp wordmark and three page links (Today, Decide, Payouts) in 14px weight 500. Its ink is re-scoped to paper so stock ghost buttons read on it. Inactive links are paper at 72% and active links are full paper with a 3px bottom rule. The links carry the range (`?days`) between pages.

### Docket Strip (signature)
Four hairline-boxed cells: Today, Last N days with delta, Balance with auto-withdraw state, and Templates. Each cell has a 14px weight-600 label, a mono display figure and two or three ink-light meta lines.

### Held Tray (signature)
A carbon band under the docket. A stamp gives the status, followed inline by each held template name underlined in held red with its reason. A "Next" line follows below a navy rule at 15%, with action-blue links. When nothing is held, the stamp turns running green and one sentence explains why.

### Held Mark (signature interaction)
Pressing a held name jumps to that template's consignment row (scroll margin 6rem). The row keeps a 9% held-red wash with red rules above and below until another row is chosen. The mark settles in once from a 28% wash over 900ms, easing on cubic-bezier(0.16, 1, 0.3, 1). The settle is skipped under reduced motion.

### Consignment Table
Columns: a mono code column, a template name with an expander chevron, a sparkline strip, then mono figures right-aligned. The header is sticky on paper with a hairline underline. Health shows as a mono percentage, and a held row reads "held · NN%" in red at weight 600.

## Do's and Don'ts

### Do:
- **Do** set every figure and template code in IBM Plex Mono at -0.02em.
- **Do** open each section with a 20px title, a short plain description and a full-ink 1px rule.
- **Do** group things with hairline-boxed cells (1px gaps over the hairline color) or a carbon tray.
- **Do** keep held red for what needs a person now, and send chores to caution ochre.
- **Do** keep every corner square (0px).
- **Do** give dialogs the top-sheet tone with a navy scrim at 40%.

### Don't:
- **Don't** build KPI cards or put a chart in the hero. Headline numbers go in the ruled docket strip.
- **Don't** add drop shadows or rounded corners to any resting surface.
- **Don't** use neutral grey for secondary text. Use ink set lighter.
- **Don't** use action blue for anything that cannot be pressed, or held red for anything that is not held or broken.
- **Don't** put a small uppercase eyebrow above a heading. The stamp is for the wordmark and the Held tray's status only.
- **Don't** use Railway's train logo or wordmark. The mark is three staggered bars.
