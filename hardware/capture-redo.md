# Hardware capture: redo sheet

Follow-up to `capture-checklist.md`. The first pass settled the Channel line, the clock line and file tolerance. This sheet covers only what it left open:

- CV assignments made from the panel (nothing was captured)
- what the first `cv` field means (every saved file had 0 there)
- CV-to-load from the panel, and whether it survives a reload
- partial saves
- clock field 2
- `DEFAULTS.TXT`

The input-menu steps in the first sheet did not produce assignments, so this one asks you to write down what the panel does instead of assuming.

## Before you start

- Pick three Bank numbers that do not exist on the card. This sheet calls them **R1**, **R2** and **R3**. Write them here: R1 ____ R2 ____ R3 ____
- Copy `hardware/to-card/redo/` onto the card as Bank **R2**. It holds the two files used in Part 4.
- No cable in the clock input.
- Whenever a step says **load with everything**, press `mute`, `clock` and `input` in the load menu and check each is lit before pressing the slot button. Your `SETTINGS.TXT` has all three off by default.
- Whenever a step says **save with clock**, press `save`, `clock`, check `clock` is lit, then the slot button.

## Part 1: how the input menu behaves

`load`, encoder to R1, press the encoder, load with everything from slot button 20 (a never-saved slot).

1. Press `input`. What lights up or flashes? ______
2. Press Channel button I to choose input 1. What changes? ______
3. Press Channel III, then P2, then `events`. What does the display show? ______
4. Turn the encoder a few clicks. Does the display change like an attenuation value (for example `1.00` → `0.90`)? ______
5. Leave the menu the way that feels right. How did you leave? ______
6. Patch a slow LFO or a manual voltage into input 1 and watch Channel III. Does P2's rhythm change? ______

If step 6 shows no modulation, the assignment did not take. Try again, changing the order (parameter first, then Channel and Pattern), and note the order that works: ______

## Part 2: one assignment per slot, no loading in between

Do not load anything during this part. Each row adds one assignment and saves.

| # | Assignment | Save to (plain save) | Notes |
|---|---|---|---|
| 1 | Input 1 → Channel III, P2, `events` (from Part 1) | Button 1 | |
| 2 | Input 2 → Channel III, `width` | Button 2 | |
| 3 | Input 3 → Channel IV, `mute` | Button 3 | |
| 4 | Input 4 → Channel V, P3, `chance`, attenuation `-0.50` | Button 4 | |
| 5 | Same input 4, add the `random` modifier | Button 5 | How did you add it? ______ |
| 6 | Input 5 → load slot 4 (hold `load`, press slot button 4) | Button 6 | |
| 7 | Input 6 → load slot 16 | Button 7 | |
| 8 | Unassign input 1 (hold `reset`, press Channel I in the input menu) | Button 8 | |

## Part 3: what loading does to assignments

1. `load`, **without** pressing `input`, press slot button 7. Plain save to button 9.
2. `load`, **with** `input` lit, press slot button 7. Plain save to button 10.
3. With a voltage in input 6: does it switch to slot 16, or to slot 9? ______

Comparing slots 7, 9 and 10 shows what the first `cv` field means and whether a load slot above 8 survives.

## Part 4: clock field 2 and CV flag from hand-written files

Bank R2 holds two generated files.

1. `load`, encoder to R2, load **with everything** from button 1 (`clock` field 2 set to 0, bpm 111). Does the clock run? ____ Does the clock menu show 111? ____ **Save with clock** to button 1 of R3.
2. Load **with everything** from button 2 of R2 (`cv0` assigned to Channel I P1 events). Does a voltage in input 1 change Channel I? ____ Plain save to button 2 of R3.

## Part 5: partial save

Back in Bank R1.

1. Load with everything from slot button 20 (never saved).
2. Channel I, P1, `length` → 7. Channel II, P1, `length` → 9.
3. `save`, press Channel I only. Is Channel I's button lit differently from the others? ____ Press button 11.
4. `save`, press Channel II only, press button 11 again (same slot).
5. `save`, no Channel pressed, button 12.

Before step 4, the file should hold length 7 on Channel I and defaults on Channel II. After step 4 it should hold both. Because step 4 overwrites, copy the card after step 3 if you want both states, or just note what the load menu shows.

## Part 6: DEFAULTS.TXT

1. Power off, mount the card, copy it to `hardware/redo-mid/`.
2. Edit `DEFAULTS.TXT`: steps 12, chance 80, events 5, offset 2, burst 2, ratchet 3, div 4. Keep the format. Eject, reinsert, power on.
3. Pick a fourth unused Bank. Load with everything from slot button 20. Save with clock to button 1.
4. Select Channel I, P2. Hold P2 and press `reset`. Save with clock to button 2.
5. Power off, restore `DEFAULTS.TXT` from `hardware/from-card/`.

## Part 7: copy back

Copy the whole card to `hardware/redo-after/`. Then load a normal slot with everything so the module is not left in a test state.

## Still not covered

- Gate recordings to check the engine's timing against the module. The engine was built from the manual's description; see `src/engine/ASSUMPTIONS.md` for the list of things a recording would confirm or correct.
