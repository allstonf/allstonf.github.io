---
name: Grayscale Revival
version: alpha
description: >
  A high-contrast black canvas with full-bleed grayscale photography,
  uppercase geometric-sans headings, and a serif reading voice. One mint
  accent carries every interactive state. Derived from the 2020 design of
  allstonf.github.io.
colors:
  ground: "#000000"
  text: "#ffffff"
  textMuted: "rgba(255,255,255,0.8)"
  accent: "#42DCA3"
  accentHover: "#1d9b6c"
  overlayWeak: "rgba(255,255,255,0.2)"
  overlayMedium: "rgba(255,255,255,0.3)"
  controlBorder: "rgba(255,255,255,0.4)"
typography:
  display:
    fontFamily: "Montserrat"
    fontWeight: 700
    textTransform: "uppercase"
    letterSpacing: "1px"
  body:
    fontFamily: "Lora"
    fontWeight: 400
    fontSize: "18px"
    lineHeight: 1.6
  scale:
    h1: "40px"
    h1Wide: "100px"
    h2: "clamp(1.75rem, 1.35rem + 1.6vw, 2.75rem)"
    bodyWide: "20px"
spacing:
  sectionY: "100px"
  headingBottom: "35px"
  paragraphBottom: "25px"
rounded:
  pill: "9999px"
  circle: "50%"
components:
  heroButton:
    shape: "{rounded.circle}"
    border: "2px solid {colors.text}"
    color: "{colors.text}"
  link:
    color: "{colors.accent}"
    hoverColor: "{colors.accentHover}"
---

## Overview

The design's thesis is a division of labor: photography carries the mood, type carries the information, and one accent carries every action. A full-bleed grayscale photograph sits behind a nearly monochrome interface so nothing competes with it for attention, and the single point of color that does exist, `{colors.accent}`, is reserved so strictly for interactive elements that its presence alone tells a reader "you can do something here."

This language originates in the 2020 revision of allstonf.github.io, built on the Start Bootstrap Grayscale template (Bootstrap 3, jQuery, `grayscale.css`). V3 reimplements the same visual thesis on a modern stack, with no Bootstrap and no jQuery, and with all fonts self-hosted rather than pulled from a CDN. What is being carried forward is the look and the rationale behind it, not the old markup or dependencies.

## Colors

The palette is deliberately almost monochrome: `{colors.ground}` (black) and `{colors.text}` (white) carry every band on the page, with `{colors.textMuted}` (white at 0.8 opacity) used for secondary nav text. Three neutral overlay values exist to shade interface chrome on top of black, never as content color. `{colors.overlayWeak}` sets thin hairline borders (project card and loop-item top borders, the loop progress bar's track). `{colors.overlayMedium}` sets the nav's permanent border-bottom and other decorative bordered chrome that is not itself a control (see Nav, under Components). `{colors.controlBorder}` is different in kind, not just in value: it is the visible boundary of an actual interactive control a reader operates directly (a native button, such as a LoopExplainer mode tab or a walkthrough prev/next control, and the agent-view toggle at rest), so it is held to WCAG SC 1.4.11's non-text-contrast threshold of 3:1 rather than the 4.5:1 text threshold that governs `{colors.text}` and `{colors.accent}`. Composited over `{colors.ground}`, `{colors.overlayMedium}` computes to 2.46:1 and would fail that boundary requirement; `{colors.controlBorder}` computes to 3.66:1 and clears it. Both figures are fixed, checkable properties of a flat white-over-black composite, the same way `{colors.accent}` on `{colors.ground}` is a fixed 12.0:1 below rather than an asserted number.

Note on `#fcfcfc`: this value appears twice in the source stylesheet, in the `::selection` and `::-moz-selection` rules, but each occurrence is immediately overridden on the following line by `background: rgba(255, 255, 255, 0.2)` within the same rule, so it never actually renders in any browser. It is dead CSS, not a design color, and it is not carried into the token set below for that reason.

Against that restraint, `{colors.accent}` (`#42DCA3`, a mint green used five times in the source stylesheet) and its darker hover state `{colors.accentHover}` are the only chromatic colors in the system. Because nothing else in the interface carries color, the accent is unambiguous: if something is mint, it is interactive, and if something is not interactive, it is never mint. This is the rule that makes the palette legible at a glance, and it is the rule most at risk when a design is extended carelessly (a colored icon, a tinted card, a decorative gradient all break it).

Two contrast figures here are fixed properties of the palette and anyone can recompute them from the hex values alone: `{colors.text}` on `{colors.ground}` is 21:1, the maximum possible in sRGB, and `{colors.accent}` (`#42DCA3`) on `{colors.ground}` (`#000000`) is 12.0:1. Both clear WCAG AA (4.5:1) at any text size, so on the flat black bands the accent is safe for body-sized copy as well as for large text, icons, borders and states, which is what it does: every inline link on a flat band is set in the accent.

**Contrast over the photo bands is not a fixed property and must be re-verified per image.** Text there sits on a photograph behind a 0.55-opacity black scrim, so the effective ratio depends on the photograph, on the region the text lands over, and on the viewport width that decides where it lands. A sampling across the shipped contact band measured the accent above 7:1 at every point tested, comfortably over AA, but that number is a property of that specific image and is not a guarantee. If you reuse this design with your own photography, sample the actual composite behind your text rather than inheriting a figure from here.

## Typography

Two families do two distinct jobs. Montserrat, set at `{typography.display.fontWeight}`, `{typography.display.textTransform}`, with `{typography.display.letterSpacing}` of letter-spacing, is the structural face: it appears on headings, the nav, and buttons in the source stylesheet, never in paragraph text. Lora, a serif, is the reading face: body copy runs at `{typography.body.fontSize}` (`{typography.scale.bodyWide}` at the wider breakpoint) with a line-height of `{typography.body.lineHeight}` at that same breakpoint, sized generously because long-form reading is exactly what it is for.

The uppercase transform combined with letter-spacing is what makes Montserrat read as a structural *label* rather than a heading in the conventional sense. Uppercase text loses the word-shape cues that make lowercase prose fast to read, and letter-spacing widens that further; both are fine, even desirable, on a short nav item or button where the goal is identification, not reading. Applied to running prose, the same treatment would make paragraphs measurably harder to read for no benefit. Montserrat therefore never sets body copy, and Lora never sets a label, nav item, or button.

## Layout

The page is built from full-width bands stacked vertically, each separated by `{spacing.sectionY}` of vertical padding. The ground beneath every band is `{colors.ground}` (black); there is no lighter band anywhere in the source. Contrast between bands comes entirely from alternating photographic bands (the hero and the contact band, each a full-bleed grayscale image over black, `.photo-band`) with flat black content bands (`.band`: About, Projects, Experience, and the Loop), not from alternating light and dark backgrounds. Composition inside each band is centered: headings, body copy, and controls sit on a single centered column rather than a multi-column grid, which keeps the reading experience linear and keeps the photography, not a background swap, doing the work of visual rhythm. Headings carry `{spacing.headingBottom}` of margin below them and paragraphs carry `{spacing.paragraphBottom}` (25px on mobile; the source bumps this to 35px, with body line-height to 1.6, at the 768px breakpoint), so vertical rhythm inside a band is consistent even as photographic and flat bands alternate.

## Elevation and Depth

This design uses no shadows. There is no box-shadow, no drop-shadow, and no elevation scale anywhere in the source stylesheet, and V3 should not introduce one. Depth in this system comes from two things only: the photographic overlay (a full-bleed image behind a darker band reads as "behind" the flat-color bands around it without any shadow doing that work) and raw contrast (white text on a black ground, or a mint border on a transparent button, reads as foreground because of value difference, not elevation). An agent extending this design will be tempted to add a shadow to a card or a button to make it "pop." Resist that: it is not what makes this design read as designed, and it would be the first thing to look wrong against everything else in the system.

## Shapes

The shape vocabulary is deliberately small. The one circular element is the scroll cue (`{components.heroButton.shape}`, a 70px circle with a `{components.heroButton.border}` outline), and it is circular specifically because it is the one element the eye needs to find instantly as a "press this" affordance floating over a photograph. The source stylesheet writes this circle as `border-radius: 100% !important` on a fixed 70px-by-70px element; `{rounded.circle}` normalizes that to `50%`, the standard CSS idiom for a circle on an equal-width/height box, which is visually identical but not a byte-for-byte copy of the source declaration. Everything else in the source stylesheet is square (`border-radius: 0` on buttons), which keeps the type-driven chrome feeling structural rather than soft. A pill radius (`{rounded.pill}`) is reserved for V3 toggle-style controls, such as the agent-view toggle, where a fully rounded capsule communicates "switch" the way it conventionally does in modern interfaces; it is a deliberate, narrow addition to the vocabulary, not a general rounding of the corner radius across the design.

## Components

**Hero.** A full-bleed photographic band in `{colors.ground}`, centered text in `{colors.text}`, an uppercase display heading at `{typography.scale.h1}` (scaling up to `{typography.scale.h1Wide}` at wider viewports), body copy at `{typography.body.fontSize}`, and the scroll-cue button anchored at the bottom. This is the one place in the system where photography, the display face, and the reading face all appear together. Every other section heading (About, Projects, Experience, Contact) is set at `{typography.scale.h2}`, a fluid clamp rather than a fixed pixel value or breakpoint jump, so it scales continuously between its floor and ceiling instead of stepping at a single width like the hero heading does.

**Section band.** A flat `{colors.ground}` band (`.band`), padded `{spacing.sectionY}` top and bottom, with centered content. Alternating these flat bands with the photographic bands (hero, contact) is what produces the page's overall rhythm; the flat band itself does not change color.

**Scroll cue.** The circular button described under Shapes: 70px, `{components.heroButton.border}`, transparent fill, `{colors.text}` icon. On hover the fill shifts to a low-opacity white wash (measured at `rgba(255,255,255,0.1)` in the source stylesheet, a third, lighter overlay value distinct from `{colors.overlayWeak}` and `{colors.overlayMedium}`) and the icon pulses. No color changes; only the wash and the motion communicate the hover state.

**Nav.** An uppercase Montserrat nav in `{colors.ground}`, with `{colors.text}` links, rendered always-solid (not transparent-over-hero collapsing to solid on scroll, since that would need a JS scroll listener this JS-free-by-default nav doesn't add) with a permanent `{colors.overlayMedium}` border-bottom. V3 ships no nav toggle button; there is no hamburger, no collapsed-menu state, and no `overlayWeak` resting background anywhere in the nav. Instead the nav row collapses by removing content, not by hiding it behind a control: below 960px the header's five section links disappear and `.site-footer__nav`, an identical set of links in the page footer, becomes the reachable copy (the two `<nav>` elements are mutually exclusive by viewport width, never both visible); below 480px the brand link also drops, since it duplicates the footer name and isn't a control. The resume link and the agent-view toggle never leave the header at any width down to 320px; an `overflow-x: auto` scroll container is the defensive fallback if the row is ever wider than measured. Secondary nav text (a hovered link) drops to `{colors.textMuted}` rather than changing hue, keeping the rule that hue is reserved for the accent.

**Link.** Inline links are set in `{components.link.color}` at rest and `{components.link.hoverColor}` on hover or focus, with no underline. This is the accent doing its one job: marking text as actionable.

**Agent-view toggle.** A V3 addition, not present in the 2020 source, but built to the same rules: a pill-shaped (`{rounded.pill}`) capsule with a bordered dot indicator, labeled "agent view." At rest it uses `{colors.textMuted}` for its label and `{colors.controlBorder}` for its border, the dedicated control-boundary value described under Colors above; on hover and in its pressed (`aria-pressed="true"`) state, both the border, the text, and the dot fill shift to `{colors.accent}`, the same accent that governs every other interactive element in the system. A pending state dims the control and a load-error state switches the border to dashed, so state is never carried by color alone.

## Do's and Don'ts

**Do** keep `{colors.accent}` reserved for interactive elements only; if it appears, something under it must be clickable, focusable, or otherwise actionable.

**Do** self-host every font (Montserrat and Lora) as part of the build. The site makes zero external network requests, and font loading is part of that contract, not an exception to it.

**Do** let photography and contrast carry the depth of the page; keep the flat bands genuinely flat.

**Don't** add gradients. The palette's flatness is deliberate; a gradient reintroduces the kind of visual noise the near-monochrome palette exists to avoid.

**Don't** add drop shadows or an elevation scale. See Elevation and Depth: there is none in the source, and none should be introduced.

**Don't** use `{colors.accent}` for decoration, icons that aren't interactive, or emphasis in running prose. If it is not a control, it does not get the accent.

**Don't** set body prose in the display face (Montserrat, uppercase, letter-spaced). That treatment is reserved for short structural labels, per Typography above.

**Don't** load fonts from any external host or third-party font CDN. Self-hosting is part of this design's contract with its zero-external-request goal, not a styling preference.
