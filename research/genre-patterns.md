# Genre patterns on Constellation

Research for a per-genre Bank generator and an "evolve" operation. Written 2026-10-03.

**Question.** Which genre idioms (house, techno, DnB, IDM, drill, boom bap, juke, and the world rhythms that are Euclidean) can be written with Constellation's feature set, how, and what does that imply for generating a Bank and for evolving a Save Slot without going fully random?

**Short answer.** Almost everything fits, because any grid with eight or fewer onsets per Channel can be written as an OR of single-Event Patterns, and Pattern length goes to 999 so multi-bar phrases fit too. The real limits are three: there is no velocity (ghost notes and accents need their own Channel), swing is one global value, and per-Channel microtiming can only delay. The generator should be a library of per-role recipes; evolve should mutate the recipe choices and their parameters by tier, then accept or reject by measuring how far the rendered output moved.

## How far to trust this

| Source | What it supports | Confidence |
|---|---|---|
| Constellation V1.3 manual (PDF in repo root) | Feature set, ranges, signal order | High |
| `src/engine` + `research/genre-patterns-spike.ts` | Every encoding below was rendered and matched its target grid | High for the model, **unverified on hardware** (see `src/engine/ASSUMPTIONS.md`) |
| Toussaint, *The Euclidean Algorithm Generates Traditional Musical Rhythms* (2005) | World-rhythm catalogue | High; primary source, quoted |
| Roger Linn interview, Attack Magazine | Swing percentages | High; first-party |
| Attack Magazine *Beat Dissected*, Native Instruments blog, drum-lesson transcriptions | Genre step positions | Medium; secondary, but consistent with each other |
| Assorted production blogs (footwork especially) | Genre step positions | Low; they contradict each other |
| Marked *(unsourced)* | Common convention from my own knowledge | Treat as a starting guess |

Genre conventions have no specification. The grids below are the central case of each genre, good enough to seed a generator, not a definition.

## 1. What Constellation can express

One Main Clock pulse is a 16th note (internal clock is 4 ppqn, manual p18), so a `length 16` Pattern is one bar and step numbers map directly onto a drum-machine grid. Steps here are numbered from 0.

Each Pattern is `euclid(length, events)` → Rotate → Burst → Ratchet → Chance, on a clock of Main × Channel ratchet ÷ Channel divide ÷ Pattern divide. A Channel combines eight Patterns' Pulses with one Logic operator, then optionally Flop. Global: BPM and swing 50–90. Per Channel: Width and a delay ("rotate") of 0–100% of a Channel Clock step.

### Techniques, all confirmed in the spike

| # | Technique | Encoding | Use |
|---|---|---|---|
| T1 | **Euclidean atom** | one Pattern | Four-on-floor `(4,1)`, backbeat `(8,1) r4`, offbeat hat `(4,1) r2`, 8th hats `(2,1)`, tresillo `(8,3)` |
| T2 | **One-hot OR** | `(16,1) rN` per onset, Logic OR | Any grid with ≤ 8 onsets. The universal fallback |
| T3 | **Long one-hot** | `(32,1) rN` or `(64,1) rN` | A hit that happens in only one bar of 2 or 4 |
| T4 | **Burst cluster** | `(16,1) rN burst 2` | Adjacent 16ths such as the amen's kicks on 10, 11 |
| T5 | **XOR subtraction** | dense Pattern XOR a Pattern coinciding with the hits to remove | Dembow snare = `(8,3)` XOR `(8,1)`; 16ths with holes; dropping bar 2's downbeat |
| T6 | **XOR nudge** | `E(5,16)` XOR a `burst 2` pair | Moves one onset by a step: claves and Jersey kick in two Patterns |
| T7 | **AND bar mask** | fast Pattern AND a slow Pattern (`divide 8`) with Width ≈ 90 | Fills and rolls that only sound in the last half-bar of four |
| T8 | **Chance layer** | extra Pattern at Chance 10–40 | Fills, non-repetition. Per-Event, not per-bar |
| T9 | **Pattern Ratchet** | `ratchet 2/3/4` on a sparse Pattern | Hat rolls: 32nds, 16th triplets |
| T10 | **Channel scaler** | Channel ratchet:divide such as 3:4, 3:2, 2:1, 5:4 | 12/8 feel, triplet grid, 32nd grid, quintuplets |
| T11 | **Polymeter** | Patterns with lengths 3, 5, 7, 12 beside 16 | Techno percussion drift, IDM |
| T12 | **Flop gate** | sparse Events + Flop | Sustained bass or pad gates from start and stop Events |
| T13 | **Microtiming** | Channel rotate 5–25 | Late snare or clap. Delay only |

### Constraints that shape the design

1. **No velocity.** Ghost notes, accents and open versus closed hats each need their own Channel and voice. Eight Channels is the budget. This is the largest gap between drum-machine thinking and this module.
2. **Pulse length is Width × the Pattern's own step.** A slow Pattern in an OR Channel holds the output high and swallows faster hits (spike: 8th hats OR a `divide 8` Pattern loses three hats per bar; at Width 10 they come back). So keep one Pattern clock per OR Channel, and use slow Patterns only as AND masks.
3. **AND masks need wide Pulses.** A mask covers Width% of its step. At Width 50 a `divide 8` mask passes four of eight 16ths; at 90 it passes all eight. Width is per Channel, so the hits get wide too.
4. **XOR tricks depend on exact coincidence.** T5 and T6 need two Pulses to be high over the same interval. The manual defines XOR by level: it outputs "when an odd number of the un-muted patterns are high at the same time" (p17), so two identical Pulses give silence, and both Patterns are computed from the same clock count. XOR recipes are therefore treated as first-class. A sliver at the shared edge is still possible in principle and would show in any gate recording.
5. **Swing is global and applies to Main Clock pulse pairs.** Every Channel shares it. With the default clock that is 16th swing. How a Channel scaler treats a swung clock is an open engine assumption, so triplet-grid Channels plus swing are unverified.
6. **Channel rotate only delays.** To push hats early, delay everything else.
7. **Chance is per Event.** "A fill every fourth bar" is a T7 mask, not Chance. Combining the two (Chance inside a mask) gives an occasional fill in the right place.
8. **Burst is capped at length ÷ events** on the panel (manual p16).
9. **The engine's Bjorklund output differs from Toussaint's for four cases**: `E(2,3)`, `E(3,4)`, `E(5,6)`, `E(7,8)` come out as `xx.`, `xxx.`, `xxxxx.`, `xxxxxxx.`. They are rotations of the paper's strings, so the necklace is right, but the Rotate needed for a named rhythm depends on which the module emits. Unverified on hardware.

## 2. World rhythms (Euclidean)

From Toussaint, with the Rotate value that makes this repo's engine start where the tradition does. "Necklace" is Toussaint's word for a rhythm considered without a fixed starting point.

| Rhythm | E(k,n) | Target | Rotate | Grid fit |
|---|---|---|---|---|
| Tresillo (Cuba), habanera bass | E(3,8) | `x..x..x.` | 0 | 16ths, half bar |
| Cinquillo (Cuba) | E(5,8) | `x.xx.xx.` | 0 | half bar |
| Cumbia, calypso | E(3,4) | `x.xx` | 2 | one beat |
| Bossa nova | E(5,16) | `x..x..x...x..x..` | 10 | one bar |
| Samba | E(7,16) | `x.x..x.x.x..x.x.` | 2 | one bar |
| Central African / samba cowbell necklace | E(9,16) | `x.xx.x.x.xx.x.x.` | 0 | one bar |
| West African bell (Mpre) | E(7,12) | `x.xx.x.xx.x.` | 0 | 12/8: Channel 3:4 |
| Bembé | E(7,12) | `x.x.xx.x.x.x` | 9 | 12/8: Channel 3:4 |
| Venda clapping | E(5,12) | `x..x.x..x.x.` | 0 | 12/8: Channel 3:4 |
| Fandango clap | E(4,12) | `x..x..x..x..` | 0 | 12/8 |
| Swing tumbao conga | E(2,3) | `x.x` | 2 | 6/8 |
| Khafif-e-ramal (Persia) | E(2,5) | `x.x..` | 0 | odd meter |
| Take Five | E(2,5) | `x..x.` | 3 | 5/4 |
| Ruchenitza (Bulgaria), *Money* | E(3,7) | `x.x.x..` | 0 | 7/8 |
| Ruchenitza II | E(4,7) | `x.x.x.x` | 0 | 7/8 |
| Aksak (Turkey), *Rondo à la Turk* | E(4,9) | `x.x.x.x..` | 0 | 9/8 |
| Agsag-Samai (Arab) | E(5,9) | `x.x.x.x.x` | 0 | 9/8 |
| Nawakhat (Arab) | E(5,7) | `x.xx.xx` | 0 | 7/8 |
| York-Samai (Arab) | E(5,6) | `xxxxx.` | 0 | 6/8 |
| Tuareg bendir | E(7,8) | `x.xxxxxx` | 2 | half bar |
| Zappa, *Outside Now* | E(4,11) | `x..x..x..x.` | 0 | 11/8 |
| Mussorgsky, *Pictures* | E(5,11) | `x.x.x.x.x..` | 0 | 11/8 |
| Aka Pygmies | E(11,24), E(13,24) | see paper | 0 | 24-step |

For 12/8 rhythms, set the Channel scaler to 3:4 so twelve steps fill one bar of four beats (spike: `E(7,12)` lands on 0, 2.67, 4, 6.67, 9.33, 10.67, 13.33 sixteenths).

**Not Euclidean, but one step away.** Toussaint gives son clave as `[x . . x . . x . . . x . x . . .]` and treats the tresillo as its first bar; the clave itself is not maximally even. The spike's search found that these are all `E(5,16)` with one onset moved:

| Rhythm | Grid | Two-Pattern XOR | OR Patterns |
|---|---|---|---|
| Son clave 3-2 | `x..x..x...x.x...` | `(16,5) r0` XOR `(16,1) r9 burst 2` | 5 |
| Son clave 2-3 | `..x.x...x..x..x.` | `(16,5) r8` XOR `(16,1) r1 burst 2` | 5 |
| Rumba clave 3-2 | `x..x...x..x.x...` | `(16,5) r7` XOR `(16,1) r12 burst 2` | 5 |
| Gahu bell | `x..x..x...x...x.` | `(16,5) r10` XOR `(16,1) r13 burst 2` | 4 |
| Soukous | `x..x..x...xx....` | `(16,5) r0` XOR `(16,1) r9 burst 4` | 3 |
| Jersey club kick | `x...x...x..x..x.` | `(16,5) r8` XOR `(16,1) r0 burst 2` | 4 |

Shiko (`x...x.x...x.x...`) needs three under XOR or four under OR. A whole "world" genre family is therefore one Pattern, or two, per Channel, which leaves the other six or seven Patterns free for Chance fills and polymeter.

## 3. Genres

Roles follow the manual's Quick Start (p5): Channel I kick, II snare/clap, III closed hat, IV open hat, V rim/perc. VI–VIII are free; the suggestion below is VI ghost/accent, VII second perc or roll, VIII bass gate (Flop).

Encodings are written `(length,events) rN`; `bN` is Burst, `xN` Ratchet, `/N` Divide.

### House (118–128, swing 54–60)

| Role | Grid | Encoding |
|---|---|---|
| Kick | `x...x...x...x...` | `(4,1)` |
| Clap | `....x.......x...` | `(8,1) r4` |
| Closed hat | 16ths or 8ths | `(1,1)` or `(2,1)` |
| Open hat | `..x...x...x...x.` | `(4,1) r2` |
| Perc | tresillo, cinquillo, `E(5,16)` at a random Rotate | T1 |

Variation: a second kick Pattern `(16,1) r14` or `r15` at Chance 20–40; clap Burst 2 as an AND-masked end-of-phrase fill. The swing range is a convention *(unsourced)*; Linn's 54%, which will "loosen up the feel without it sounding like swing", is a sensible house default.

### Techno (125–145, swing 50–55)

Kick `(4,1)`, hat `(4,1) r2` or 16ths, clap sparse or absent. The identity is in percussion: each perc Channel gets one or two Patterns with lengths from {3, 5, 6, 7, 12} beside the 16-step bar (T11), OR or XOR. Attack's Beat Dissected techno entries give 50–55% swing and build grooves from elements on different loop lengths (read from search summaries of several entries, not one article in full). A rumble Channel: 16ths XOR `(4,1)` gives `.xxx.xxx.xxx.xxx`. Bass gate: Flop on `E(3,8)` or `E(5,16)`.

### Drum and bass (170–176, swing 50–54)

Two-step: kick `x.........x.....` = `(16,1) r0` OR `(16,1) r10`; snare `(8,1) r4`; hats 8ths or 16ths. Kick variants add 7, 11 or 13 as Chance one-hots.

Amen (jungle), from the transcription sources, verified in the spike over four bars:

| Role | Bars 1–2 | Bar 3 | Bar 4 | Patterns |
|---|---|---|---|---|
| Kick | `x.x.......xx....` | `x.x.......x.....` | `..xx......x.....` | 7 (XOR) or 8 (OR), length 16 and 64 |
| Snare | `....x.......x...` | `....x.........x.` | `....x.........x.` | 5 |
| Ghost snare | `.......x.x.....x` | `.......x.x......` | `.x.....x.x......` | 5 |
| Ride | `x.x.x.x.x.x.x.x.` | same | same | 1 |

Splitting ghosts onto their own Channel is both what makes it fit and what makes it sound right on a gate-only module. A one-bar amen is cheaper: kick `(8,1) r2` + `(16,1) r10 b2` + `(16,1) r0`; snare `(8,1) r4` + `(16,3) r15` + `(8,1) r7` covers main and ghost in three.

### IDM (any tempo, often 90–160)

No canonical grid; the idiom is the technique list. Polymeter (T11), XOR between unrelated Euclidean loops, Channel scalers of 3:2, 5:4, 7:4 (T10), Ratchet 3–8 on sparse Events with Chance 30–60, odd lengths up to 23, Flop on a perc Channel so that it turns triggers into irregular gates. Keep kick and snare recognisable (a two-step or half-time skeleton at Chance 100) so the rest reads as variation, not noise. *(unsourced; design judgement)*

### UK drill (138–144, swing 50)

| Role | Grid (2 bars) | Encoding |
|---|---|---|
| Snare | `........x....... ............x...` | `(32,1) r8` OR `(32,1) r28` |
| Hats | `x..x..x.x..x..x.` | `(8,3)`: the tresillo |
| Hat roll | 16th-triplet or 32nd bursts | extra Pattern, `x3 /2` or `x2`, Chance 30–50 |
| Kick | downbeat plus syncopation | `(16,1) r0` plus two or three Chance one-hots from {6, 7, 10, 11, 14} *(unsourced)* |
| 808 | follows kick, sustained | Flop Channel |

Sources agree on the two defining facts: hats are 3+3+2 on steps 1, 4, 7, 9, 12, 15 (1-based), and the snare is on beat 3 of bar 1 and beat 4 of bar 2. That is `E(3,8)` plus a length-32 Pattern, so drill is one of the cheapest genres here.

### Trap (130–150, half-time)

Snare `(16,1) r8`. Hats 8ths or 16ths plus Ratchet rolls (T9): `(8,1) r7 /2 x3` puts three hits on 14, 14.67, 15.33; `(16,1) r15 x2` gives 32nds. Kick sparse, 808 on Flop. *(unsourced beyond the drill sources' comparison)*

### Boom bap (85–96, swing 58–66)

| Role | Grid | Encoding |
|---|---|---|
| Kick | `x......x..x.....` or `x..x....x.x.....` | 3 one-hots |
| Snare | `....x.......x...` | `(8,1) r4` |
| Hats | 8ths | `(2,1)` |
| Ghost snare | 16th before 2 and 4: steps 3, 11 | `(8,1) r3` on its own Channel, Chance 40–70 |
| Ghost kick | 16th before a main kick | one-hot, own Channel or Chance |

Swing is the genre. Linn: 66% is exact triplet swing, and 62% at 90 BPM "feels looser" than 66. Ghost notes on odd 16ths are what swing moves, which is why they belong in the recipe. Linn also says he never found delaying individual drums useful; the late snare (T13, Channel rotate 5–15) is the opposing J Dilla-era convention *(unsourced)*, so make it optional.

### 2-step / UK garage (126–134, swing 60–66)

Kick `x.........x.....` with optional 13 or 7; Attack's example omits the kick on bar 2's downbeat, which is T5: add `(32,1) r16` under XOR. Snare `(8,1) r4`. Offbeat hat `(4,1) r2`, 16th shaker. Swing 60–65% per Attack.

### Juke / footwork (155–165, swing 50)

The weakest sourcing. Agreed: about 160 BPM, syncopated "beat-skipping" kicks, clap sparse, alternating half-time and full-time sections (Wikipedia). Disagreed: one guide says triplet-grid claps define it, another says never use triplets and work on a 32-step grid with paired 32nd kicks. A generator can offer both as recipe variants:

| Role | Encoding | Note |
|---|---|---|
| Kick A | `(8,3)`, double tresillo `x..x..x.x..x..x.` | *(unsourced, common)* |
| Kick B | Channel 2:1, `(8,1) b2`: pairs at 0, 0.5, 4, 4.5 … | 32nd pairs, per the beatkey guide |
| Clap | `(16,1) r12`, or `(8,1) r4` | half-time and full-time |
| Toms/perc | Channel 3:2 or 3:4, Euclidean, Chance 50–80 | the triplet layer |
| Hat | `(4,1) r2` or 16ths | |

Half-time versus full-time is a natural pair of sibling Save Slots.

### Jersey club (130–145)

Kick on steps 1, 5, 9, 12, 15 (1-based): `x...x...x..x..x.`, two Patterns under XOR or four under OR (table in §2). Clap `(8,1) r4`.

### Dembow / reggaeton (88–100)

Kick `(4,1)`. Snare `...x..x....x..x.`: tresillo without its downbeat = `(8,1) r3` OR `(8,1) r6`. Sourced only as "3+3+2 over a four-on-the-floor kick"; the exact grid is the standard reading *(partly unsourced)*.

## 4. Generator design

**A genre is data, not code.**

```
Genre  = { bpm: [lo, hi], swing: [lo, hi], roles: Role[8] }
Role   = { voice, weightedRecipes: Recipe[], width, flop, delay: [lo, hi] }
Recipe = { logic, clock: [ratchet, divide], layers: Layer[] }
Layer  = { tier, pattern template with ranges, e.g. rotate ∈ {7,10,13}, chance ∈ [20,40] }
```

Each Layer carries a **tier**, which is what makes evolve controllable:

| Tier | Contents | Example |
|---|---|---|
| 0 Anchor | What makes it the genre | 4-floor kick, drill snare, backbeat |
| 1 Motif | Role's main variation | which syncopated kicks, hat density |
| 2 Ornament | Chance fills, rolls, ghost Channel, polymeter layers | hat roll, masked fill |
| 3 Feel | swing, Width, Channel delay, BPM | |

Keep the generating choices (a "genotype": genre, recipe ids, drawn values, seed) alongside each Save Slot. The file format has no room for it. The firmware skips unrecognised lines, so a comment line would load, but the module would drop it on its next save. **Decided 2026-10-03: one sidecar file per Bank**, in the Bank's folder beside its Save Slots. A Save Slot edited on the module no longer matches its genotype, so evolve must detect that and fall back to the generic operators below, which work on a bare Save Slot.

**Built** (2026-10-03): the genre data is `src/gen/genres.ts`, the generator `src/gen/generate.ts`, the sidecar `src/gen/sidecar.ts` (`BANK.JSN`, one line per Save Slot, with a hash of the Channel lines to detect edits). `npm run generate -- <genre>` writes a Bank; the app has a genre picker. A generated Bank uses the family layout below.

**Bank layout.** Twenty Save Slots, and Live Mode plays them like a keyboard without losing sync. So a Bank should be a family, not twenty strangers: for example four parents on buttons 1, 6, 11, 16, each followed by four evolutions of increasing distance. Keep BPM, swing and all Channel scalers identical across a Bank, since the manual warns that switching between different clock divisions needs a Reset.

**A fitter as a building block.** The spike's search (grid in, fewest Patterns out, OR and XOR) is now `src/gen/fitter.ts` (`npm run fit -- "x..x..x...x.x..."`). It takes whichever of OR and XOR needs fewer Patterns. It lets recipes be authored as readable `x..x..x.` strings, and it lets a user paste any grid.

## 5. Evolve

Reroll some aspects, keep the rest. Three parts.

**Operators**, from smallest to largest change:

| Operator | Changes | Tier |
|---|---|---|
| Feel | swing ±, one Channel's delay or Width | 3 |
| Ornament reroll | redraw Chance layers, rolls, fills | 2 |
| Thin / thicken | mute or unmute an ornament; Events ±1; Chance ±15 | 2 |
| Nudge | Rotate ±1 or Events ±1 on one motif Pattern, inside the recipe's range | 1 |
| Motif reroll | redraw one role's tier-1 choices | 1 |
| Role reroll | pick another recipe for one Channel | 1–2 |
| Phase | rotate a polymeter layer; change its length among {3,5,7} | 2 |
| Logic flip | OR ↔ XOR on a perc Channel | 1 |

Anchors are never touched unless the user unlocks them.

**An amount control.** One value from 0 to 1 sets how many operators run and the highest tier they may reach: low touches only tiers 3 and 2, high reaches tier 1 on one or two roles. Per-Channel locks sit on top.

**A distance check.** Because the engine renders any Save Slot, evolve can measure what it did: render parent and child for 4 bars with Chance forced to 100 and to 0, and count differing 16th cells per Channel (Hamming distance), weighted so kick and snare cost more than hats. Reject a child that is identical to its parent or over the budget for the chosen amount, and redraw. This catches the two real failures of parameter mutation on Euclidean patterns: changes that do nothing (rotating `(4,1)` by 4) and small parameter changes that sound like a different rhythm (Events 3 → 4 on length 8).

**Built** (2026-10-03): `src/gen/evolve.ts`, `npm run evolve -- <bank folder> <from> <into>`, and an evolve button with an amount slider in the app. Differences from the plan above:

- Distance is the Events only one Save Slot has over the Events either has, at Chance 100 over four bars, with kick and snare weighted 3. The budget is 0.08 + 0.5 × amount. Chance, Width and delay changes do not move it, so a candidate also counts as changed when those differ.
- Evolve never changes BPM or swing, so a Bank stays on one clock.
- There is no "logic flip" or "phase" operator; a nudge (Rotate ±1 or Events ±1) and a Layer reroll cover them.
- A Role with anchors keeps its Recipe; only Roles without anchors are rerolled whole.
- Without a Genotype, evolve only nudges Patterns and shifts Chance, and leaves Channels I and II and any AND Channel alone.

Euclidean parameters make good mutation handles on their own terms: Events ±1 keeps the hits evenly spread, and Rotate keeps the shape and moves the accent. That is why a nudge sounds like a relative of the parent where flipping random steps does not.

## 6. Open questions

1. ~~XOR coincidence~~ Answered by the manual's definition of XOR (constraint 4). Worth a glance at the next gate capture: `(16,5)` XOR `(16,1) r9 b2` should play son clave.
2. **Bjorklund start for `E(3,4)`, `E(2,3)`, `E(7,8)`, `E(5,6)`**: `xxx.` or `x.xx`?
3. **Swing with a Channel scaler**: does a 3:4 Channel follow the swung clock?
4. ~~Where the genotype lives~~ Decided: a sidecar file per Bank (§4). Still open: its name and format, and whether the module tolerates an extra file in a Bank folder.
5. **Voices**: the app has eight voice slots matching the Quick Start. A ghost/accent Channel needs a quieter copy of a voice.

## Sources

- Constellation Manual, Firmware 1.3, `Constellation_Manual_Firmware_1.3_8.26.2026.pdf`: p5 Quick Start roles, p6–11 Euclidean, Burst, Ratchet, Chance, Logic, Flop, p13 clock tree, p16–20 parameter ranges, p22–23 load and Live Mode.
- G. Toussaint, "The Euclidean Algorithm Generates Traditional Musical Rhythms", BRIDGES 2005. https://cgm.cs.mcgill.ca/~godfried/publications/banff.pdf
- "Roger Linn on Swing, Groove & the Magic of the MPC's Timing", Attack Magazine. https://www.attackmagazine.com/features/interview/roger-linn-swing-groove-magic-mpc-timing/
- "Rolling 2-Step", Attack Magazine Beat Dissected. https://www.attackmagazine.com/technique/beat-dissected/rolling-2-step-garage/
- Attack Magazine Beat Dissected, techno entries. https://www.attackmagazine.com/technique/beat-dissected/dark-berlin-techno/
- "How to make a drill beat", Native Instruments blog. https://blog.native-instruments.com/drill/
- "Drill Drum Patterns 101", Cedar Sound Studios. https://www.cedarsoundstudios.com/blogs/news/drill-drum-patterns-101-counter-snares-hi-hat-rolls-and-bounce
- "The famous Amen Break drum groove", Elephant Drums. https://www.elephantdrums.co.uk/blog/guides-and-resources/amen-break-drum-groove/
- E. Hein, "Building the Amen break". https://www.ethanhein.com/wp/2023/building-the-amen-break/
- "Footwork (genre)", Wikipedia. https://en.wikipedia.org/wiki/Footwork_(genre)
- "How to Make Footwork Music", beatkey (low confidence). https://beatkey.app/how-to-make-footwork-music
- "What Is Jersey Club?", Orphiq. https://orphiq.com/resources/what-is-jersey-club
- "Dembow beat", Wikipedia. https://en.wikipedia.org/wiki/Dembow_beat
- "Essential Boom Bap Drum Patterns", BVKER. https://bvker.com/boom-bap-drum-patterns/
