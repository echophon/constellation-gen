# Hardware capture checklist

Step-by-step tests for the gaps left by the [Save Slot format research](https://github.com/echophon/constellation-gen/issues/3), for the ticket [Capture reference Save Slots from the hardware](https://github.com/echophon/constellation-gen/issues/2). Each test ends in one new Save Slot.

The panel steps follow the V1.3 manual and have not been tried on a module. If the panel does not behave as a step says, do what makes sense and write down what happened.

## How this works

- **Nothing is reset between tests.** Each test changes one more thing and saves to the next Save Slot. Afterwards each file is diffed against the one before it, so the only difference is the thing you changed.
- **Slot buttons** are the 20 buttons in the two middle rows. This sheet numbers them 1–10 along the upper row (AND … chance) and 11–20 along the lower row (flop … P8). Button 1 is expected to write `00.TXT`; the captures will confirm that.
- **A plain save** means: `save`, then the slot button. **A save with clock** means: `save`, `clock`, then the slot button.
- Banks used: **900** and **901** for panel saves, **902** for hand-written files, **903** for re-saves of those, **904** for the defaults test. Check first that none of these exist on your card. Bank 000 is not touched.
- Fill in the **Observed** blanks as you go. They are the things a file cannot tell us.

## Part A: copy the card before touching anything (gap 1)

1. Power off, take the card out, mount it on the computer.
2. Copy the entire card into `hardware/card-before/` in this repo, including `SETTINGS.TXT`, `DEFAULTS.TXT`, `AUTOSAVE.TXT`, `AUTOSLOT.TXT`, `VERSION.TXT` and `CAL.TXT`.
3. Do not edit `CAL.TXT`, ever. This copy is also your restore point.
4. Copy `hardware/to-card/902/` onto the card as the folder `902`. It is used in Part D.
5. Eject properly, put the card back, power on with **no cable in the clock input**.

## Part B: panel saves, Bank 900

Start: `load`, turn the encoder to `900`, press the encoder. Press `mute`, `clock` and `input` so all three are loaded, then press slot button 20. This puts you on a never-saved Save Slot with default clock, mutes and no CV assignments. Leave slot 20 unsaved for the whole session.

Observed: were all 20 slot buttons dim (unsaved) in Bank 900? ______ Could you load the dim slot? ______

| # | Gap | Do this | Save to | Observed |
|---|---|---|---|---|
| B1 | 14 | Change nothing. | Button 1, with clock | |
| B2 | 4 | Select Channel I. Press `flop` so it is on. | Button 2 | |
| B3 | Channel mute field | `mute`, press Channel II, `mute` to leave. | Button 3 | |
| B4 | 5 | `clock`, press Channel III. `ratchet` → 3. `divide` → 2. `clock` to leave. | Button 4 | |
| B5 | Channel width field | Select Channel IV. `width` → 25. | Button 5 | |
| B6 | 6 | `clock`, press Channel V. `rotate` → 37. `clock` to leave. | Button 6 | |
| B7 | 6 | `clock`, press Channel VI. `rotate` → turn up until it stops. `clock` to leave. | Button 7 | Highest value shown: 999 ______ |
| B8 | 12 | `clock`, press Channel VII. `ratchet` → turn down until it stops. `divide` → turn down until it stops. `clock` to leave. | Button 8 | Lowest ratchet: 001 ____ Lowest divide: 001 ____ |
| B9 | 12 | Select Channel VIII, Pattern P1. `ratchet` → turn up until it stops. `divide` → turn up until it stops. | Button 9 | Highest ratchet: 255____ Highest divide: 255____ |
| B10 | 12 | Select Channel VIII, Pattern P2. `length` → 16. `events` → 12. `rotate` → 10. Then `length` → 8. | Button 10 | Events shown after shrinking: 007____ Rotate shown: 007____ |
| B11 | clock fields 3, 4, 5, 8 | `clock` (no Channel selected). Encoder → 97 bpm. `divide` → 3. `ratchet` → 5. `width` → 66. `clock` to leave. | Button 11, with clock | |
| B12 | 3 | `clock`, press `mute` so the Main Clock stops. `clock` to leave. | Button 12, with clock | |
| B13 | 2, clock fields 6, 7 | `clock`, press `mute` so the clock runs again, `clock` to leave. Patch any steady clock into the clock input. `clock`. `divide` → 7. `ratchet` → 6. `clock` to leave. | Button 13, with clock | |
| B14 | 13 | Unpatch the clock input. `clock`, encoder → 133 bpm, `clock` to leave. | Button 14, **plain save** | |
| B15 | 13 | Select Channel I, P1, `length` → 7. Select Channel II, P1, `length` → 9. Then `save`, press Channel I only, then button 15. | Button 15 | |
| B16 | cv channel and pattern order | `input`, select input 1, press Channel III, press P2, press `events`. Leave the menu. | Button 16 | |
| B17 | 9 | `input`, select input 2, press Channel III, press `width`. Leave the menu. | Button 17 | |
| B18 | 9 | `input`, select input 3, press Channel IV, press `mute`. Leave the menu. | Button 18 | |
| B19 | 10 | `input`, select input 4, press Channel V, press P3, press `chance`, press `random`. Turn the encoder to `-0.50`. Leave the menu. | Button 19 | |

For B13: if `divide` and `ratchet` in the clock menu show different values with the cable in than they did in B11, that confirms the external clock has its own pair. Observed: ______

Slot button 20 stays unsaved. Afterwards there should be no `19.TXT` in `900`.

## Part C: panel saves, Bank 901

`load`, encoder to `901`, press the encoder. Do not load a slot, so the current settings carry over.

| # | Gap | Do this | Save to | Observed |
|---|---|---|---|---|
| C1 | 8 | `input`, select input 5, hold `load` and press slot button 4. Leave the menu. | Button 1 | |
| C2 | 8 | `input`, select input 6, hold `load` and press slot button 16. Leave the menu. | Button 2 | |
| C3 | 8 | `load`, press `input` so input assignments are loaded, press button 2 (the slot just saved). Then save again without changing anything. | Button 3 | |
| C4 | 7 | Look for any way to select a ninth or tenth input in the `input` menu (for example the `clock` or `reset` buttons). If one exists, assign it to Channel I, P1, `length`. | Button 4 (only if you found one) | What you tried: ______ |

C3 tests the predicted bug: if input 6's line in `02.TXT` differs from `01.TXT`, a CV-to-load assignment above slot 8 does not survive a reload.

## Part D: hand-written files, Bank 902 → re-save to Bank 903 (gaps 7, 11, 12)

The files in `902` were generated on the computer. Each is the built-in default Save Slot with one oddity, and Channel I, Pattern P1 has **length = 20 + file number** so you can see on the display whether it loaded.

For each row:

1. `load`, encoder to `902`, press the encoder. Press `mute`, `clock` and `input` so all three are loaded, then press the slot button.
2. Select Channel I, P1, press `length`, and write down the number shown. Also note the extra reading the row asks for.
3. `save`, encoder to `903`, press the encoder, `clock`, then the **same** slot button.

| # | File | Oddity | Slot button | Slot pulsing in load menu? | Length shown (expect) | Extra reading |
|---|---|---|---|---|---|---|
| D1 | `00.TXT` | None (control) | 1 | | (20) | |
| D2 | `01.txt` | Lower-case file name | 2 | | (21) | |
| D3 | `02.TXT` | CRLF line endings | 3 | | (22) | |
| D4 | `03.TXT` | No trailing newline | 4 | | (23) | Channel VIII P8 `length`: ____ (expect 4) |
| D5 | `04.TXT` | Lines in reverse order | 5 | | (24) | |
| D6 | `05.TXT` | Only the `clock`, `C0` and `C0.P0` lines | 6 | | (25) | Channel II P1 `length`: ____ |
| D7 | `06.TXT` | Events 40 on length 26 | 7 | | (26) | `events`: ____ |
| D8 | `07.TXT` | Rotate 35 on length 27 | 8 | | (27) | `rotate`: ____ |
| D9 | `08.TXT` | Pattern ratchet 300 | 9 | | (28) | `ratchet`: ____ |
| D10 | `09.TXT` | Pattern divide 256 | 10 | | (29) | `divide`: ____ Does Channel I still output? ____ |
| D11 | `10.TXT` | `cv8` assigned to Channel I P1 events | 11 | | (30) | |
| D12 | `11.TXT` | Clock field 2 set to 0, plus an unknown line `foo = 1,2,3` | 12 | | (31) | Does the clock run normally? ____ |
| D13 | `12.TXT` | `cv0` set to load slot 15 | 13 | | (32) | `input`, select input 1: what does it show? ____ |

If a slot is dim in the load menu or shows length 4, the file was rejected. Write that down, skip step 3 for that row, and move on.

### D14: zero clock values (optional, do it last)

`13.TXT` sets Channel I's clock ratchet to 0 and Channel II's clock divide to 0. A divide by zero could hang the module, and because the module autosaves and reloads the autosave at boot, a hang could come back after a power cycle.

- Only do this if you are comfortable restoring the card from `hardware/card-before/`.
- Load slot button 14 from `902` as above. Observed: Channel I output ____ Channel II output ____ `clock` menu values for each ____
- If it keeps running, save to `903` button 14 with clock.
- If it hangs: power off, mount the card, delete `AUTOSAVE.TXT` and `902/13.TXT`, and power on again. If it still misbehaves, restore the card from the backup.

## Part E: DEFAULTS.TXT (gap 14)

1. Power off, mount the card. Check whether folders `900`, `901` and `903` exist, and that no `904` does. Observed: ______
2. Copy the card to `hardware/card-mid/` so the work so far is safe.
3. Edit `DEFAULTS.TXT` on the card. Keep its existing lines and format, and change the values to: steps 12, chance 80, events 5, offset 2, burst 2, ratchet 3, div 4. Eject, reinsert, power on.
4. `load`, encoder to `904`, press the encoder, press slot button 20 with `mute`, `clock` and `input` selected.
5. Save with clock to button 1 of `904`.
6. Select Channel I, P2, hold the P2 button and press `reset` (resets the Pattern to the defaults file). Save with clock to button 2 of `904`.
7. Power off, mount the card, restore the original `DEFAULTS.TXT` from `hardware/card-before/`.

This shows whether a never-saved Save Slot takes its Pattern values from `DEFAULTS.TXT` or from the firmware's built-in defaults, and whether Patterns P2–P8 stay muted.

## Part F: copy the card back

1. With the card still mounted, copy the entire card into `hardware/card-after/`.
2. Note whether any files appeared that you did not expect (for example in the card root). Observed: ______
3. Eject, reinsert, power on. To get back to where you were, `load` Bank 000 with `mute`, `clock` and `input` selected and pick a slot. Unassign the test CV inputs if any remain: `input`, hold `reset`, press each input button.

## Not covered here

- Gap 15 (the ModWiggler thread) is reading, not a hardware test.
- Gate recordings for the engine model are a separate sitting; this sheet only settles the file format.
