# Engine assumptions

The file format is confirmed against files written by the module. The timing model below is built from the V1.3 manual and has **not** been compared with gate recordings. Each item says what the engine does and what a recording would settle.

## Taken from the manual, with a worked example to match

- **Euclidean distribution**: Bjorklund's algorithm, starting on an Event. Matches p6 (3 in 8, 3 in 9) and my reading of the p9 circle (5 in 16 as `x..x..x..x..x...`).
- **Rotate** shifts Events later by that many steps (p6).
- **Burst** repeats each Event on the following Pattern Clock steps (p8, p11).
- **Ratchet** spreads N Events evenly across one Pattern Clock step (p8).
- **Order**: euclid → Burst → Ratchet → Chance (p8).
- **Clock tree**: Channel Clock = Main Clock × Channel ratchet ÷ Channel divide; Pattern Clock = Channel Clock ÷ Pattern divide (p13).
- **Logic** runs on Pulses of unmuted Patterns only; XOR is high for an odd count (p17).
- **Flop** toggles on each rising edge of the combined Pulses (p10).

## Guesses

| Topic | What the engine does | What is uncertain |
|---|---|---|
| Rotate off-by-one | Rotate 28 on length 32 puts the Event on step 28 | The p11 figure may show it one step earlier |
| Burst at the loop end | Wraps into the start of the next loop | Could be cut off at the loop boundary |
| Pulse width | Width percent of one ratchet sub-step (step ÷ ratchet) | The manual says "of the pattern clock"; it might be the full step |
| Width 0 | No Pulse at all | The module may emit a minimum-length trigger |
| Channel Rotate | Delay of rotate ÷ 100 Channel Clock steps | The panel goes to 999, so the unit may not be percent |
| Swing | Even Main Clock pulses lengthen, odd ones shorten; everything downstream follows the warped clock | How the Channel scaler treats a swung clock |
| Internal tempo | Pulses per second = BPM ÷ 60 × clock ratchet ÷ clock divide | The manual says the internal clock is "always 4 ppqn" |
| Chance | A hash of seed, Channel, Pattern and Event number, so it repeats for a given seed | The module is presumably truly random |
| Flop while muted | Keeps toggling underneath a muted Channel | The module may freeze or clear it |
| Simultaneous changes | One Pattern falling as another rises at the same instant gives no XOR glitch | The module may emit a very short pulse |
| AND with nothing unmuted | Low | Unknown |
| Events > length (file only) | Treated as events = length | Unknown |
| Rotate ≥ length (file only) | Taken modulo length | Unknown |
| Pattern ratchet or divide of 0 (file only, after the 8-bit wrap) | Pattern is silent | Unknown; the module did not hang |
| Channel ratchet or divide of 0 (file only) | Channel is silent | Unknown; the module did not hang |

## Not modelled

- CV Input modulation.
- External clock (`extRatchet`, `extDivide`) and Reset timing against an external clock.
- The stopped Main Clock (`clock.mute`): a transport concern for the caller.
