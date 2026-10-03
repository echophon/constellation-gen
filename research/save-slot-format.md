# Save Slot file format: what is documented or already known

Research for [issue #3](https://github.com/echophon/constellation-gen/issues/3). Researched 2026-10-03. Vocabulary follows `CONTEXT.md`.

Every claim below carries one of four labels:

- **[doc]** stated in Acid Rain Technology's manual or website.
- **[data]** observed directly in the factory Bank files or in literal strings inside the official firmware image.
- **[disasm]** read out of a disassembly of the official V1.3 firmware image. This is primary-source evidence, but the reading of the machine code is mine and has not been checked against a module.
- **[inferred]** a conclusion drawn from the above; reasoning given.

## Summary

- The manual documents which SD card files exist and what they are for, but says **nothing** about the syntax of any of them. [doc]
- No community documentation of the format was found. ModWiggler (the main thread) blocks automated fetching (HTTP 403), so it was **not read**; GitHub code search and web search turned up nothing.
- The official firmware download is an unencrypted ARM Cortex-M image. It contains the exact `printf`/`sscanf` format strings for every SD card file, and its save, load and CV-modulation routines settle nearly all field meanings, including the CV parameter codes.
- A Save Slot is 83 LF-terminated ASCII lines. Field orders:

```
clock = mute, <flag, always 1>, bpm, int_ratchet, int_divide, ext_ratchet, ext_divide, swing
cvN   = assigned, random, target_code, channel, pattern, attenuation      (N = 0..9)
CN    = mute, flop, ratchet, divide, width, rotate, LOGIC                 (N = 0..7)
CN.PM = mute, chance, length, events, rotate, burst, ratchet, divide      (M = 0..7)
```

- CV target codes: `1` mute, `10` width, `20` divide, `21` length, `22` events, `23` rotate, `24` burst, `25` ratchet, `26` chance, `29` load. So the factory Bank's `22` and `23` are **events** and **rotate**.
- An unsaved Save Slot is simply a missing file.

## Sources

| Source | What it is | How used |
|---|---|---|
| `Constellation_Manual_Firmware_1.3_8.26.2026.pdf` (repo root, untracked) | Official manual, 29 pp. | Read in full |
| `000/00.TXT`..`19.TXT` (repo root, untracked) | Factory Bank | Byte-level and statistical analysis |
| <https://acidraintechnology.com/pages/product-firmware-updates> | Official downloads page | Lists exactly three Constellation downloads |
| `000.zip` from that page (sha256 `a09fdd23…5c3bc2`) | Official quickstart Bank | `diff -r` against repo `000/`: **identical** |
| `Constellation_FW_V1.3.zip` → `FW.BIN` (161064 bytes, sha256 `474a8f7e…8ce28c`) | Official firmware V1.3 | Strings + disassembly |
| `Constellation_Fimware_V1.1.zip` → `FW.BIN` (162632 bytes, sha256 `1a01271e…88a388`) | Official firmware V1.1 | Strings only |
| <https://acidraintechnology.com/products/constellation> | Product page | No format information |
| V1.0 manual (May 2022, third-party mirror) | Older manual | SD card section is a subset of V1.3's; nothing extra |
| `constellation-gen.sh` (repo root, untracked) | Old generator script | Shows what the author previously wrote to the card |

The firmware zips contain only `FW.BIN`. They do **not** include sample `DEFAULTS.TXT`, `SETTINGS.TXT` or any other card files.

### Reproducing the firmware reading

`FW.BIN` is a raw image with a Cortex-M vector table (initial SP `0x20020000`, reset `0x080243C9`). Its load address is `0x08008000`: with that base, every format string below is referenced from a literal pool; with other candidate bases none are. Disassembled as Thumb-2 with Capstone. Addresses in V1.3:

| Address | Routine |
|---|---|
| `0x0801AD28` | Initialise a Save Slot to built-in defaults |
| `0x0801AE5C` | Write a Save Slot (the only writer; one call site) |
| `0x0801B0A8` | Parse a Save Slot |
| `0x0801B47C` | Write `SETTINGS.TXT` |
| `0x0801B9C4` | Write `DEFAULTS.TXT` |
| `0x0801CC34` | Bank load loop: builds each slot path, opens, parses |
| `0x080147AE` | Apply CV modulation (jump table on target code at `0x080147F4`) |
| `0x08015464` / `0x08015558` | Encoder handlers for the clock menu (internal / external) |

## What the manual says

- "Save and load channel settings in up to 20 save slots per bank and up to 999 banks"; the Bank display runs "000 to 999". (pp. 3, 21) [doc]
- Banks are folders named `000`, `001`, … at the card root; deleting them is the factory reset, after which "all patterns will load whatever settings are set in the default.txt file … and remove all CV input assignments". (p. 28) [doc]
- Card files, by the manual's names: "defaults" (default Pattern parameters for Patterns "you haven't edited before"), "settings" (load-menu defaults for mute/clock/input, display blink rate, power-on Bank and Save Slot), "version", "autosave" ("the currently autosaved pattern and channel data"), "autoslot" ("used to load the previously loaded bank when loading from autosave"), "cal" (factory input calibration, "do not move or delete"). (p. 27) [doc]
- Two `settings.txt` keys are named in prose: `dont_load_autosave = 1` (p. 21) and `cv_norm = 0` / `cv_norm = 1` (p. 26). [doc]
- The manual is inconsistent about one filename: "default.txt" (pp. 16, 28) versus "defaults" (p. 27). The firmware opens `/DEFAULTS.TXT`. [doc + data]
- Parameter ranges: Pattern divide 1–255, length up to 999, events 0..length, rotate 0..length−1, ratchet 1–255, chance 0–100 (p. 16); Channel width 0–100 % (p. 17), Channel rotate "between 0% and 100%" (p. 19); Main Clock swing 50–90 (p. 18). [doc]
- CV Input attenuation runs "from 1.0 through -1.0 in 0.01 increments" (p. 24). CV can target a Pattern's divide, length, events, rotate, burst, ratchet, chance and a Channel's width and mute, plus "load" with a slot number, and any assignment can carry a "random" modifier (pp. 24–25). There are 8 CV Inputs. [doc]
- A save always covers Channels; Main Clock settings are saved only if "clock" is pressed in the save menu (p. 21). On load, mutes, Main Clock and CV Input assignments are each opt-in; Channel clock settings always load (p. 22). [doc]

## The Save Slot file

### Encoding and layout [data]

All 20 factory files are identical in structure:

- Pure 7-bit ASCII, no BOM, no tabs, no trailing spaces.
- Line ending **LF only** (zero CR bytes in the whole Bank). The file ends with a trailing LF.
- Exactly 83 lines, always in the same order: `clock`, `cv0`..`cv9`, then for each Channel `C0`..`C7` one `CN` line followed by `CN.P0`..`CN.P7`.
- Every line is `key = v,v,v…` with exactly one space each side of `=` and no spaces in the value list.
- File names are two digits plus upper-case `.TXT`; the folder is three digits.

The firmware writes these lines with the following format strings, each ending in `\n` and nothing else: [data]

```
clock = %d,%d,%d,%d,%d,%d,%d,%d\n
cv%d = %d,%d,%d,%d,%d,%d\n
C%d = %d,%d,%d,%d,%d,%d,%s\n
C%d.P%d = %d,%d,%d,%d,%d,%d,%d,%d\n
```

The writer always emits all 83 lines, with a fixed loop of 10 `cv` lines. [disasm]

### `CN.PM` — Pattern [disasm, agrees with prior inference]

`mute, chance, length, events, rotate, burst, ratchet, divide`

The save routine prints the Pattern record's fields in memory order, and the `DEFAULTS.TXT` writer labels the same offsets `chance`, `steps`, `events`, `offset`, `burst`, `ratchet`, `div`. This confirms the order already inferred.

| # | Field | Clamp applied on load | Manual range | Seen in factory Bank |
|---|---|---|---|---|
| 1 | mute | 0..1 | — | 0, 1 |
| 2 | chance | 0..100 | 0–100 | 1..100 |
| 3 | length | 1..999 | up to 999 | 4..256 |
| 4 | events | 0..999 | 0..length | 0..58 |
| 5 | rotate | 0..999 | 0..length−1 | 0..63 |
| 6 | burst | 1..999 | dynamic maximum | 1..3 |
| 7 | ratchet | 1..999, then stored in 8 bits | 1–255 | 1..7 |
| 8 | divide | 1..256, then stored in 8 bits | 1–255 | 1..8 |

- The loader does not check events ≤ length or rotate < length. In the factory Bank both always hold. [disasm + data]
- Because ratchet and divide are stored in one byte after a wider clamp, the disassembly predicts that `divide = 256` wraps to 0 and ratchet values above 255 wrap. Unverified. [inferred]

### `CN` — Channel [disasm]

`mute, flop, ratchet, divide, width, rotate, LOGIC`

| # | Field | Evidence | Clamp on load |
|---|---|---|---|
| 1 | mute | CV target code 1 (mute) writes this byte | 0..1 |
| 2 | flop | By elimination: the only other boolean on a Channel | 0..1 |
| 3 | ratchet (Channel clock multiplier) | Clock-menu handler edits it when the ratchet button is held | 0..256 |
| 4 | divide (Channel clock divider) | Same handler, divide button | 0..256 |
| 5 | width | CV target code 10 and the width button edit it, range 1..100 | 0..100 |
| 6 | rotate (output microtiming) | Clock-menu handler, rotate button | 0..999 |
| 7 | Logic | Stored as 0/1/2 and printed as `AND`/`OR`/`XOR` | exact upper-case match |

- Note the order is **ratchet then divide**, matching the Pattern line.
- Field 2 = flop is the weakest link here: it rests on elimination, not on seeing the flop button write it. [inferred]
- Channel rotate: the manual says 0–100 %, but both the encoder handler and the loader allow 0..999. The unit is therefore unclear. [disasm vs doc]
- A Logic value that is not exactly `AND`, `OR` or `XOR` makes the parser abandon the file. [disasm]
- Every factory Channel line is `0,0,1,1,50,0,<LOGIC>` (146 OR, 11 XOR, 3 AND), which is also the built-in default with `OR`. So the factory Bank never exercises fields 1–6. [data]

### `clock` — Main Clock [disasm]

`mute, flag, bpm, int_ratchet, int_divide, ext_ratchet, ext_divide, swing`

| # | Field | Evidence | Clamp on load | Encoder range |
|---|---|---|---|---|
| 1 | mute (internal clock stopped) | A toggle handler flips it and restarts the clock when clearing it | 0..1 | — |
| 2 | unknown flag | Loader ignores the file's value and always stores 1; default is 1 | forced to 1 | — |
| 3 | BPM | Default handler in the internal clock menu | none | 1..300 |
| 4 | internal ratchet | Ratchet button, internal clock menu | 1..999 | 1..99 |
| 5 | internal divide | Divide button, internal clock menu | 1..999 | 1..99 |
| 6 | external ratchet | Ratchet button, external clock menu | 1..999 | 1..99 |
| 7 | external divide | Divide button, external clock menu | 1..999 | 1..99 |
| 8 | swing (Main Clock Width) | Width button, range 50..90 as the manual states | 50..90 | 50..90 |

- Built-in default and every factory file: `0,1,120,4,1,1,1,50`. The `4` is the internal ratchet, which is how "4 ppqn" at 120 BPM is expressed. [disasm + doc p. 18]
- Field 1 = mute is a reasonable reading of the toggle code but was not traced back to the mute button itself. [inferred]
- Field 2 is read by the clock engine as a boolean but its purpose was not determined.

### `cvN` — CV Input assignment [disasm]

`assigned, random, target_code, channel, pattern, attenuation`

| # | Field | Evidence | Clamp on load |
|---|---|---|---|
| 1 | assigned | Modulation loop skips the entry when 0; set to 1 on assignment, 0 on un-assign | 0..1 |
| 2 | random | Toggled by a handler; when set, a rising edge on the input randomises the target | 0..1 |
| 3 | target code | Index into the modulation jump table | upper bound 36 |
| 4 | channel (0-based) | Multiplied by the Channel record size | upper bound 8 |
| 5 | pattern (0-based) | Multiplied by the Pattern record size | upper bound 8 |
| 6 | attenuation ×100 | Encoder range −100..100; multiplied into the CV value | −100..100 |

Target codes, from which field each jump-table handler writes:

| Code | Target | Handler writes |
|---|---|---|
| 1 | Channel mute | Channel field 1 |
| 10 | Channel width | Channel field 5, clamped 1..100 |
| 20 | Pattern divide | Pattern field 8 |
| 21 | Pattern length | Pattern field 3 |
| 22 | Pattern events | Pattern field 4, clamped 0..length |
| 23 | Pattern rotate | Pattern field 5, clamped 0..length |
| 24 | Pattern burst | Pattern field 6 |
| 25 | Pattern ratchet | Pattern field 7 |
| 26 | Pattern chance | Pattern field 2, clamped 0..100 |
| 29 | Load a Save Slot | Special-cased; field 4 then holds the slot number, edited over 0..19 |

All other codes do nothing in the modulation loop. The codes look like front-panel button numbers (the panel has 36 buttons, and the same numbers index the button bitmask in the clock menu), which would explain the gaps. [inferred]

**Why 10 `cv` lines:** the Save Slot record holds an array of 10 assignment entries, and the save, default-init and modulation loops all run to 10. The manual only exposes inputs 1–8. What entries 8 and 9 are for is not determined; they are unassigned (`0,0,0,0,0,100`) in every factory file. [disasm + data]

**Factory Bank correlation** [data + inferred]: ten of the twenty slots assign `cv0` only, all with pattern 0 and random 0:

| Slot | `cv0` | Reading | Target Pattern line |
|---|---|---|---|
| 00, 11 | `1,0,22,1,0,100` | events of C1.P0 | unmuted |
| 01, 05, 14 | `1,0,22,0,0,100` | events of C0.P0 | unmuted |
| 02 | `1,0,22,3,0,100` | events of C3.P0 | unmuted |
| 03, 10 | `1,0,23,1,0,100` | rotate of C1.P0 | unmuted |
| 12 | `1,0,22,2,0,-100` | events of C2.P0, inverted | unmuted |
| 13 | `1,0,22,3,0,-58` | events of C3.P0, inverted ×0.58 | unmuted |

Reading field 4 as channel and field 5 as pattern lands on an unmuted Pattern in all ten slots. The opposite reading would point slots 00 and 02 at muted Patterns. This independently supports the disassembly. It also matches the Quick Start, which tells the user to patch a CV into input 1 (p. 5).

**Predicted quirk:** the loader caps field 4 at 8, yet a load assignment stores a slot number up to 19 there. If the reading is right, a CV-to-load assignment for slots 9–19 would not survive a save and reload. Unverified. [inferred]

### Parser behaviour [disasm]

- Lines are read one at a time into a 64-byte buffer and matched by key, trying `C%u.P%u = %s`, `C%u = %s`, `clock = %s`, `cv%d = %s` in turn. Order of lines is therefore not significant, and a missing line leaves that part of the slot at its default.
- A line matching none of the four keys is skipped.
- A line whose key matches but whose value list has the wrong number of fields makes the parser return failure.
- Values are captured with `%s`, so a value list may not contain spaces.
- `%s` and `%u` stop at whitespace, so a trailing CR should be tolerated. Not tested. [inferred]

## How unsaved Save Slots are represented [disasm]

When a Bank is loaded, the firmware loops over slots 0..19. For each one it first fills the slot with built-in defaults, then builds the path `/BBB/SS.TXT` character by character (three Bank digits, two slot digits, literal upper-case `TXT`) and opens it for reading. If the open fails, it sets that slot's bit in an "empty" bitmask and moves on. There is no placeholder file: **an unsaved Save Slot is an absent file**, and an unsaved Bank is presumably an absent folder.

Built-in defaults written by the init routine:

```
clock = 0,1,120,4,1,1,1,50
cvN   = 0,0,0,0,0,100
CN    = 0,0,1,1,50,0,OR
CN.P0 = 0,100,4,1,0,1,1,1
CN.P1..P7 = 1,100,4,1,0,1,1,1      (muted)
```

These match the untouched lines of the factory Bank, where 1059 of 1280 Pattern lines are muted. [data] How `DEFAULTS.TXT` is layered over these built-ins was not traced.

## File names and case

- The firmware uses upper-case 8.3 names throughout: `/BBB/SS.TXT`, `/AUTOSAVE.TXT`, `/AUTOSLOT.TXT`, `/VERSION.TXT`, `/CAL.TXT`, `/SETTINGS.TXT`, `/DEFAULTS.TXT`, and `FW.BIN` for updates (manual p. 27). The image contains the `FAT32` filesystem tag. [data]
- FAT name matching is normally case-insensitive, so lower-case `00.txt` (as written by `constellation-gen.sh`) probably loads. Not established from any source. [inferred]
- The manual refers to these files in lower case with a `.txt` extension; that is prose, not the on-card spelling. [doc]

## The other SD card files

Line formats are literal strings from the V1.3 image [data]; the association of each group with its file comes from the routine that references the path [disasm].

**`SETTINGS.TXT`** — written in this order:

```
load_mutes = %d
load_clock = %d
load_input = %d
seven_seg_blink_rate_hz = %d
starting_bank = %d
starting_slot = %d
dont_load_autosave = %d
cv_norm = %d
```

These map one-to-one onto the settings the manual describes (pp. 21, 26, 27). Default values were not extracted.

**`DEFAULTS.TXT`** — written in this order:

```
steps = %d
chance = %d
events = %d
offset = %d
burst = %d
ratchet = %d
div = %d
```

Note the key names differ from the panel: `steps` is Length, `offset` is Rotate, `div` is Divide. There is no mute key.

**`AUTOSLOT.TXT`**: `autosave_bank = %d` and `autosave_slot = %d`.

**`AUTOSAVE.TXT`**: the image has a single Save Slot writer with a single call site, and the autosave path is passed into the routine around it, so this file is in Save Slot format. [inferred from disasm]

**`VERSION.TXT`**: `fw version %s` and `fw hash %s`. V1.3 embeds version `1.3.0` and hash `cc0ec8c7efec4723c1ac389f8c0dbf47b63cdbe1`.

**`CAL.TXT`**: lines of three integers, written as `%d %d %d` and read as `%u %d %d`. Meaning not investigated.

**V1.1 versus V1.3**: the V1.1 image contains the same set of file-format strings and file names. Only V1.3 was disassembled, so clamps and field meanings are established for V1.3 only.

## What remains unknown

Only a hardware capture can settle these.

1. **Literal contents of the non-Bank card files as shipped**: `SETTINGS.TXT` (default values), `DEFAULTS.TXT`, `AUTOSAVE.TXT`, `AUTOSLOT.TXT`, `VERSION.TXT`, `CAL.TXT`. Copy the whole card.
2. **`clock` field 2**: always 1 and forced to 1 on load. Purpose unknown.
3. **`clock` field 1 is mute**: save with the internal Main Clock stopped (with "clock" pressed in the save menu) and check it becomes 1.
4. **`CN` field 2 is flop**: save a Channel with flop on and check.
5. **`CN` fields 3 and 4**: confirm ratchet-then-divide by saving a Channel with, say, ratchet 3 and divide 2.
6. **Channel rotate unit and range**: manual says 0–100 %, firmware allows 0..999. Save at several settings and read the value.
7. **`cv8` and `cv9`**: what the two extra entries are for, and whether they can ever be non-default.
8. **CV-to-load assignments**: the saved line for a load assignment (expected code 29 with the slot number in field 4), what field 5 holds, and whether slots above 8 survive a reload.
9. **CV assignments to Channel targets** (mute, width): what field 5 holds when no Pattern is involved.
10. **Random modifier**: confirm field 2 becomes 1.
11. **Tolerance of hand-written files**: lower-case file names, CRLF line endings, a missing trailing newline, reordered or missing lines.
12. **Out-of-range values**: events > length, rotate ≥ length, Pattern ratchet > 255, Pattern divide = 256, Channel ratchet or divide = 0.
13. **Partial saves**: the file produced by saving only some Channels, or without pressing "clock" (predicted: still all 83 lines).
14. **How `DEFAULTS.TXT` interacts with the built-in defaults** for an unsaved Save Slot, and whether a fresh Bank folder is created on first save.
15. **Community knowledge**: the ModWiggler thread "New module?: Acid Rain Constellation" could not be fetched and may contain statements from the manufacturer.
