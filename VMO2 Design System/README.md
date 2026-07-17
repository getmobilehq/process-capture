# VMO2 — Virgin Media O2 Business Design System

A design system distilled from Virgin Media O2's 2024 Business PowerPoint toolkit, the brand "infinity" lockup, and the AeonikPro web font family. Built to enable on-brand pitches, decks, marketing pages, product UI mocks, and quick prototypes that look like they came from VMO2 itself.

> Virgin Media O2 (VMO2) is a UK-based telecommunications joint venture between Liberty Global and Telefónica — combining Virgin Media (broadband, TV, home phone) and O2 (mobile network) under one roof since 2021. **Virgin Media O2 Business** (VMO2B) is the B2B arm, selling connectivity, mobile fleets, fibre, IoT and managed network services to UK businesses and the public sector. Sub-brands within the family include **Virgin Media**, **O2**, **giffgaff** (challenger mobile MVNO), **TalkTalk** (consumer broadband), and the wholesale-fibre venture **nexfibre**.

---

## Sources used to build this system

| File | What we extracted |
|---|---|
| `uploads/VMO2 Logo copy.png` | Primary corporate "infinity" lockup (red Virgin Media loop + blue O2 mark) |
| `uploads/VMO2B PowerPoint toolkit 2024 OF.pptx` | All slide layouts, colour scheme (`theme1.xml`), 87 brand images (logos, sub-brand marks, swooshes, photography, devices), tone/voice samples from copy decks |
| `uploads/Web.zip` | Aeonik Pro web font family (Air → Black + italics) for web use |
| `uploads/image (9).png` | "Instant expert" sample comms — colour-blocked capsule sections, pink-on-red pill stacks |

The raw extracted material lives in `_pptx/` (XML), `_pptx_media/` (every image referenced by the toolkit), `fonts/` (Aeonik Pro web fonts) and `uploads/` (originals).

---

## Index

**Foundations**
- [`colors_and_type.css`](colors_and_type.css) — Single CSS file with every brand token (colour, type, spacing, radii, shadow, motion) plus type helper classes
- [`fonts/`](fonts/) — Aeonik Pro web fonts, all 7 weights × roman + italic (14 files)
- [`assets/logos/`](assets/logos/) — Lockups: VMO2 corporate, VMO2 Business stacked, VM Business, O2 Business, sub-brand marks (giffgaff, TalkTalk)
- [`assets/imagery/`](assets/imagery/) — Brand swooshes, gradient backgrounds, hero examples

**UI kits**
- [`ui_kits/web/`](ui_kits/web/) — Marketing site recreation. Header, hero, product capsule grid, pill-headed feature cards, footer.
- [`ui_kits/slides/`](ui_kits/slides/) — Slide deck recreation matching the 2024 PPTX toolkit. Title, Section, Two-column, Big-stat, Quote, Closing.

**Cards & skill**
- [`preview/`](preview/) — Standalone HTML preview cards registered in the Design System tab
- [`SKILL.md`](SKILL.md) — Cross-compatible Agent Skill manifest

---

## Content fundamentals

VMO2's voice is **British, plain-speaking, warm, and confident**. Decks read like a smart colleague briefing you over coffee, not a corporate brochure. Sentences are short and active. Headlines often land with a full stop for emphasis ("Becoming a true wholesale market challenger.").

**Person & pronouns.** "We" and "our" are used for VMO2; "you" addresses the reader directly. The company is referenced as "Virgin Media O2" or "VMO2" — almost never as a faceless "the company". Internal toolkits address the reader as a peer ("Your two best friends", "Top tips to keep things looking great").

**Casing.** Sentence case is the default. Display headlines on hero/section pages use **ALL CAPS** for impact ("BECOMING A TRUE WHOLESALE MARKET CHALLENGER.") — but this is reserved for the loudest moments, never on body or sub-headers.

**Length & rhythm.** Slide headings ≤ 8 words. Section pills ≤ 4 words ("What's next?", "Benefits to VMO2", "The deal in four steps"). Body sentences average 15–22 words. Bulleted lists open with a **bold lead-in** then expand ("**Speed to fibre** — where our cable network and nexfibre overlap, we can move to full fibre faster for millions of our customers").

**Numbers & dates.** Numerals over words for any quantity ≥ 2. UK formatting: "4 June 2024", "around 8m full-fibre homes", "£" not "GBP", "2027" not "FY27".

**Punctuation.**
- En-dash with spaces ("8m full-fibre homes – with most completed by 2027") — never em-dash.
- Closing full stops on display headlines ("Wholesale market challenger.").
- Bulleted items: full stop only if the bullet contains multiple sentences.
- Curly quotes throughout: `'Use Destination Theme'`, `'Keep Text Only'`.

**Emoji.** Not used in corporate or B2B communications. The brand's visual personality comes from the **capsule/pill compositions** and the red-blue-pink palette — emoji would clash.

**Tone snapshots (taken from the toolkit):**
- "Your two best friends. Use this handy toolkit along with the PowerPoint template to create Virgin Media O2 packs and presentations."
- "Get the most out of this pack."
- "Highlight your key information to draw audience attention to important details."
- "For now, nothing changes. nexfibre will begin the regulatory approval process."

What to **avoid**:
- Tech-bro hype ("revolutionary", "game-changing", "AI-powered")
- Hedging ("we believe", "we think")
- Stacked adjectives ("fast, reliable, secure, scalable")
- Exclamation marks except in genuinely conversational copy

---

## Visual foundations

The visual system is built on a small, confident vocabulary. Everything else is restraint.

### Colour
Three brand colours do almost all the work:
- **O2 Blue `#0050FF`** — primary brand, used for hero areas, CTAs, the O2 mark.
- **Virgin Media Red `#E10A0A`** — secondary brand, used for headline accents, the Virgin loop, mobile-product moments.
- **Hot Pink `#FF0090`** — the "joining" colour. Sits between red and blue to signal "Virgin × O2 together". Used heavily as an endcap, highlight, or gradient mid-stop.

Supporting accents (`#FFC548` yellow, `#02D16A` green, `#19ACFF` cyan) appear sparingly for data viz / status. Backgrounds are predominantly **white** with `#F7F7F7` for subtle surface separation. Black `#000` is used for body text and SHOUTY display headlines. There are NO heavy gradients on body content — the brand reads as flat, with the exception of the corner swoosh marketing motif.

### Type
**Aeonik Pro** is the entire system. Geometric grotesk, very high x-height, with a wide weight range (Air 100 → Black 900). The brand uses Black for displays, Bold for headers, Medium for emphasis in body, Regular for body, and Light only for very large quiet quotes. Italics are rare; reserve for editorial captions.

Display moments use **uppercase Black**, slightly tight tracking, line-height 0.95–1.0. Body text is sentence-case Regular at 1.5–1.6 line-height. The brand is comfortable mixing very large and very small on one slide; the visual hierarchy is enforced by **scale and colour, not weight alone**.

### Spacing
4-pt base grid. Slides use a 50px outer margin in the toolkit (1920 × 1080 layout). Cards and pills breathe — 24–32px vertical padding is typical for any "capsule" element.

### Backgrounds
- Predominantly **flat white**. The brand earns its visual interest from foreground composition, not background patterns.
- Marketing/title slides may use the **corner swoosh** asset (red-to-blue ribbon flowing through pink mid-stop) — full-bleed but always at low visual weight against a white canvas.
- Sub-brand product slides may use **flat blue (`#0050FF`)** or **flat red (`#E10A0A`)** full-bleed.
- No textures, no grain, no hand-drawn illustrations, no repeating patterns.

### The signature shape: capsule + circle
This is the single most identifiable VMO2 motif. A **pill-shaped label sits flush with a separate circle** of a contrasting brand colour, the circle slightly overlapping the pill's right edge. Examples from the toolkit:
- Pink "What's next?" pill + red circle endcap
- Red "Benefits to VMO2" pill + blue circle endcap
- Blue "For our customers" pill + red circle endcap
- Red gradient "Instant expert" bar fading to pink + pink circle endcap

This combination shows up as section headers, callouts, tab navigation in marketing pages, and tag/badge styling. It's the **defining shape of the system** — replace nothing else, but use it generously.

### Corner radii
Capsules are fully rounded (`9999px`). Cards use 24–32px radius. Inputs and buttons use full pill or 14–16px. Tight rectangles (4–8px) are reserved for dense product UI where pills don't fit.

### Borders
Used sparingly. When present:
- Hairline `1px solid #E5E7E9` for divider lines on dense product surfaces.
- The signature "Outlined capsule with no fill" pattern appears on tabs and secondary buttons — 2px stroke in the chosen brand colour.

### Shadows
Brand is **flat first**. When shadows do appear (modals, dropdown menus, floating product cards on light backgrounds) they are large, very soft, and tinted slightly cool. Inner shadows are not used. Drop shadows are never coloured.

### Hover / press states
- Buttons darken ~15% on hover (e.g. `#0050FF` → `#003ECC`).
- Capsules and cards lift 2px on hover with shadow growing one step (`--shadow-sm` → `--shadow-md`).
- Pressed state: shrink to 98% scale, no colour change.
- Tab/pill hover: the small endcap circle scales 1.1× — a subtle nod to the brand's connective motif.
- Links underline on hover, never by default in marketing copy.

### Motion
Standard UI motion is fast (160–220ms) on `cubic-bezier(0.2, 0, 0, 1)`. Hero swooshes and big-feature reveals use an **emphasised ease** with a longer duration (400ms+). Bounce is reserved for the "endcap circle" pop on focus or arrival. Fades over translates. No parallax. No carousels that auto-advance.

### Transparency & blur
Almost never. The brand's confidence comes from **solid fills**. Glass/blur effects are not part of the toolkit. The one exception: protection scrims behind text on full-bleed photography use a 35% black gradient from bottom, no blur.

### Photography colour vibe
Toolkit photography is warm, optimistic, real-world UK business scenes (small business owners, engineers, families). Shot on slight wide-angle, natural light, mid-saturation. No B&W, no heavy grain, no monochrome filters. Devices are shot clean on white or on the brand blue/red.

### Layout rules
- Fixed: 50px outer margin on 1920×1080 slides; 24–32px on web tiles
- The logo lockup sits **bottom-left** on internal slides; **top-left** on marketing pages
- Page numbers sit **bottom-right** alongside the "Confidential" footer
- Headlines are top-aligned in their content area, with generous space before body copy

---

## Iconography

The VMO2 toolkit does **not** ship a custom icon set. The brand strongly relies on its **photography + capsule** shapes for visual storytelling rather than illustrative icons. Where icons are needed in supporting comms (e.g. product feature checklists, contact info, navigation bars), the convention is:

- **Style**: line icons, **2px stroke**, rounded line caps, square corners on geometric shapes. No filled icons, no two-tone, no gradients.
- **Source**: When neither a Figma sticker sheet nor a Brand Factory icon set is available, we substitute **Lucide** (`lucide.dev` / `unpkg.com/lucide@latest`) — its line-icon style, 2px stroke, and 24px optical size match the closest visible icons in toolkit screenshots and the giffgaff/O2 web headers. **This is a substitution — flag to brand team and replace with the official set when supplied.**
- **Colour**: Icons inherit the surrounding text colour (`currentColor`), so a black headline gets black icons, a blue hero gets white icons.
- **Sizing**: 16, 20, 24 (default) and 32px. Always on a square box; never on a circle.
- **Country flags**: The toolkit ships a circular-cropped flag set (UK, Belgium, Austria, Poland, Netherlands, Switzerland) for international business slides — see `_pptx_media/image79-83.png`. These are bundled in `assets/flags/`.
- **Sub-brand marks**: Are NOT icons — they're full lockups, used only at logo scale, never as 24px badges.
- **Emoji & Unicode glyphs**: Not used in formal brand comms.

The corporate "infinity" lockup is the brand's only proprietary glyph. Don't recreate it in SVG — always use the supplied PNGs from `assets/logos/`.

---

## ⚠️ Caveats

- **Aeonik Pro is a paid Cofo Type Foundry typeface** — the `.woff` files in this repo ship inside Virgin Media O2's web bundle and are intended for VMO2 use only. If this design system is forked outside VMO2, swap to **Helvetica Neue** or the free Google alternative **"Space Grotesk"** (closest geometric grotesk match). The CSS already lists Helvetica as the immediate fallback.
- **No production codebase was provided** — UI kits are recreated from the PPTX toolkit + the public website style. The web kit is therefore **a fair-fidelity recreation, not a 1:1 of virginmediao2.co.uk** — flag to a designer for verification.
- **No icon set was provided** — see Iconography. Lucide is a flagged substitution.
- **No mobile app context** was provided (Priority, My O2, etc.) — so no mobile UI kit is included. If you need one, attach screens or the React/Swift codebase and ask.
