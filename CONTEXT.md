# Constellation

A browser emulator and bank editor for the Acid Rain Technology Constellation, an eight-channel euclidean gate sequencer. Vocabulary follows the Constellation Firmware V1.3 manual; where the manual has a word, the manual wins.

## Language

### Storage

**Bank**:
A numbered collection (000–999) of 20 Save Slots, stored as one folder on the module's micro SD card.

**Save Slot**:
One complete snapshot of the module's settings — Main Clock, CV Input assignments, and all 8 Channels — stored as one file in a Bank.
_Avoid_: Pattern (the prototype script used "pattern" for this), preset, scene

### Rhythm

**Channel**:
One of the 8 outputs; combines the Pulses of its 8 Patterns with one Logic operator into a single Output Signal.
_Avoid_: Track, voice

**Pattern**:
One of the 8 looping euclidean event generators inside a Channel, with its own Pattern Clock.
_Avoid_: Layer, lane, sequence; never use Pattern for a Save Slot or for a Channel's combined output

**Event**:
A single trigger instant emitted by a Pattern, before it is shaped into a Pulse.
_Avoid_: Hit, note, step (a step may or may not hold an Event)

**Length**:
The number of Pattern Clock steps in a Pattern's core euclidean loop.

**Events**:
The number of Events the core euclidean loop distributes across its Length.
_Avoid_: Hits, pulses, fills

**Rotate**:
The offset, in steps, by which a Pattern's core euclidean loop is shifted. At Channel level, Rotate instead means the Channel's output microtiming delay.

**Burst**:
Repeats each Event on the subsequent Pattern Clock steps.

**Ratchet**:
Repeats each Event several times between two Pattern Clock steps. At Channel and Main Clock level, Ratchet instead means a clock multiplier.

**Chance**:
The probability that an Event passes through to the Channel.
_Avoid_: Probability, prob

**Pulse**:
The variable-width high period that a Channel shapes each Event into; Logic operates on Pulses, not Events.

**Width**:
A Channel's Pulse width, as a percentage of the Pattern Clock step. At Main Clock level, Width instead means swing.

**Logic**:
The single operator (AND, OR, XOR) a Channel uses to combine the Pulses of its unmuted Patterns.

**Flop**:
A Channel's optional flip-flop, which toggles the output on each rising edge of the combined Pulses, turning triggers into gates.

**Mute**:
Excludes a Pattern from its Channel's Logic, or silences a Channel's output entirely.

**Output Signal**:
The binary gate stream a Channel emits after Logic and Flop.
_Avoid_: Pattern, rhythm (as a noun for this)

### Clocking

**Main Clock**:
The root clock, internal (BPM, 4 ppqn) or external, from which everything is derived.

**Channel Clock**:
The Main Clock scaled by a Channel's integer multiplier/divider ratio (its Scaler).

**Pattern Clock**:
A Channel Clock divided by a Pattern's Divide.

**Divide**:
An integer clock divider; exists at Pattern, Channel, and Main Clock level.

**Reset**:
Returns every Pattern to the start of its loop; the module's output is always a pure function of clock pulses elapsed since the last Reset.

### Modulation

**CV Input**:
One of 8 freely assignable control-voltage inputs, each modulating a single parameter of one Pattern or Channel.

### Modes

**Edit Mode**:
The default mode, in which one Channel, one Pattern, and one parameter are selected and adjusted.

**Live Mode**:
A performance mode in which Save Slots are played momentarily like a keyboard without losing sync.
