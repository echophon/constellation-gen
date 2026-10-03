# Scheduling gates in the browser: Tone.js and WebMIDI on one clock

Research for [issue #4](https://github.com/echophon/constellation-gen/issues/4). Sources fetched 2026-10-03.

Each claim is tagged:

- **[V]** verified against a primary source in this session (linked).
- **[I]** inference or arithmetic from verified facts. Not measured.
- **[U]** unverified: could not be confirmed from a primary source; treat as a lead.

Nothing here was measured on real hardware. Every jitter figure is either a spec constant or an inference, and the recommendation ends with what to prototype.

## Answer in one paragraph

Make `AudioContext.currentTime` the only musical clock. Run one lookahead loop that, every ~25 ms, asks the engine for the Output Signal *edges* in the next slice of audio time and emits each edge twice: to Tone.js voices with the audio-clock time, and to WebMIDI with that same time converted to a `performance.now()` timestamp through `AudioContext.getOutputTimestamp()`. Use Tone.js for voices and its context only; do not put gates on `Tone.Transport`. Audio stays sample-accurate with itself. Audio-to-MIDI cannot be sample-tight: it is millisecond-class at best, backend-dependent, and needs a user trim. Events already handed to the browser are effectively committed (Chrome has no `MIDIOutput.clear()`), so a parameter or Save Slot change takes effect at the scheduling horizon, 50-100 ms later. Ratchet rates reach audio rate and exceed what a MIDI cable can carry, so both outputs need an explicit density limit.

## 1. How Tone.js scheduling works

Read from Tone.js `main` at commit [`d2d52ff`](https://github.com/Tonejs/Tone.js/commit/d2d52ffa8803b35debd9f19f2da08ad1c3540de0) (2025-04-27); npm `latest` is 15.1.22.

- **[V]** A `Ticker` drives everything. It is a Web Worker running `setTimeout(tick, updateInterval)` and posting `'tick'` to the main thread, falling back to main-thread `setTimeout` if workers are unavailable. The interval is clamped to at least `max(128 / sampleRate, 0.001)` s. ([Ticker.ts](https://github.com/Tonejs/Tone.js/blob/d2d52ffa8803b35debd9f19f2da08ad1c3540de0/Tone/core/clock/Ticker.ts))
- **[V]** `Context` defaults: `clockSource: "worker"`, `latencyHint: "interactive"`, `lookAhead: 0.1`, `updateInterval: 0.05`. Setting `lookAhead` also sets `updateInterval = lookAhead / 2` (or 0.01 when `lookAhead` is 0). The doc comment states "context.updateInterval + context.lookAhead gives you the total latency between scheduling an event and hearing it". ([Context.ts](https://github.com/Tonejs/Tone.js/blob/d2d52ffa8803b35debd9f19f2da08ad1c3540de0/Tone/core/context/Context.ts))
- **[V]** `Tone.now()` is `currentTime + lookAhead`; `Tone.immediate()` is raw `currentTime`. The source warns that mixing the two "can cause some timing issues". (same file)
- **[V]** `Clock._loop` runs on each context `tick`, takes the window `[lastUpdate, now())`, and calls its callback once per clock tick inside that window with the exact audio time of the tick. The class comment: "While the callback is not sample-accurate (it is still susceptible to loose JS timing), the time passed in as the argument to the callback is precise." ([Clock.ts](https://github.com/Tonejs/Tone.js/blob/d2d52ffa8803b35debd9f19f2da08ad1c3540de0/Tone/core/clock/Clock.ts), [TickSource.ts `forEachTickBetween`](https://github.com/Tonejs/Tone.js/blob/d2d52ffa8803b35debd9f19f2da08ad1c3540de0/Tone/core/clock/TickSource.ts#L392-L452))
- **[V]** `Transport` is a `Clock` at `bpm x PPQ` with default `ppq: 192`. Scheduled events are stored at tick positions and fired by `this._timeline.forEachAtTime(ticks, ...)`, where `ticks` is an integer (`Math.round`). Transport swing is a fixed sine-shaped offset on an 8n/16n grid. ([Transport.ts](https://github.com/Tonejs/Tone.js/blob/d2d52ffa8803b35debd9f19f2da08ad1c3540de0/Tone/core/clock/Transport.ts#L236-L271))
- **[V]** `Transport.clear(id)` and `Transport.cancel(after)` remove events from the Transport timeline only. ([Transport.ts](https://github.com/Tonejs/Tone.js/blob/d2d52ffa8803b35debd9f19f2da08ad1c3540de0/Tone/core/clock/Transport.ts#L355-L397))
- **[V]** `Draw` queues callbacks by audio time and runs them from `requestAnimationFrame` when `currentTime + anticipation (0.008 s)` passes the event time; events more than `expiration` (0.25 s) late are dropped. ([Draw.ts](https://github.com/Tonejs/Tone.js/blob/d2d52ffa8803b35debd9f19f2da08ad1c3540de0/Tone/core/util/Draw.ts))
- **[V]** `triggerAttackRelease(note, duration, time)` is just `triggerAttack(time)` plus `triggerRelease(time + duration)`, both taking absolute audio times. ([Instrument.ts](https://github.com/Tonejs/Tone.js/blob/d2d52ffa8803b35debd9f19f2da08ad1c3540de0/Tone/instrument/Instrument.ts))

### Limits at high Ratchet rates

- **[I]** The Transport grid is too coarse and the wrong shape. At 120 BPM one Transport tick is 60 / (120 x 192) = 2.6 ms. A Main Clock step at 4 ppqn and 120 BPM is 125 ms; a Ratchet of 255 gives a gate period of 0.49 ms (about 2 kHz, 4080 edges per second per Pattern, before Channel and Main Clock multipliers). Transport cannot place an event between ticks, and raising PPQ makes Tone iterate every tick in JS.
- **[I]** Transport also duplicates state the engine already owns (position, tempo, swing, loop). The engine is a pure function of time since Reset, so a second timeline is a second source of truth to keep in sync.
- **[I]** The Tone *mechanism* (worker tick plus a window on the audio clock) is exactly the right pattern, and its time arguments are exact. The limit is per-edge JS cost: at 4080 edges/s a 25 ms window holds ~100 edges per Channel, ~800 across 8 Channels, each becoming several AudioParam automation events inside a Tone envelope. Whether that holds without glitches is unmeasured.
- **[I]** Above some rate a triggered envelope voice stops being meaningful: a gate period shorter than the envelope attack never reaches full level, and at ~2 kHz the gate is itself an audible tone. The audio path needs a defined behaviour for audio-rate gates (see section 7).

## 2. The two clocks and how to convert

- **[V]** `MIDIOutput.send(data, timestamp)`: timestamp is "a number of milliseconds measured relative to the navigation start of the document", a `DOMHighResTimeStamp`. "If timestamp is set to zero (or another time in the past), the data is to be sent as soon as possible. Multiple calls to send() with the same timestamp must result in the data being sent in the order the calls were made." Running status is not allowed; data must be complete messages. ([Web MIDI API, MIDIOutput](https://webaudio.github.io/web-midi-api/#midioutput-interface))
- **[V]** Chromium implements this as `GetTimeOrigin(context) + timestamp`, i.e. the `performance.now()` time base of the calling context. ([midi_output.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/webmidi/midi_output.cc))
- **[V]** `AudioContext.getOutputTimestamp()` returns `contextTime` ("the time of the sample frame which is currently being rendered by the audio output device ... in the same units and origin as context's currentTime") and `performanceTime` ("estimating the moment when the sample frame corresponding to the stored contextTime value was rendered by the audio output device, in the same units and origin as performance.now()"). Both are zero until the graph has processed a block. The spec gives the conversion itself. ([Web Audio API, getOutputTimestamp](https://webaudio.github.io/web-audio-api/#dom-audiocontext-getoutputtimestamp))

  ```js
  function outputPerformanceTime(contextTime) {
    const timestamp = context.getOutputTimestamp();
    const elapsedTime = contextTime - timestamp.contextTime;
    return timestamp.performanceTime + elapsedTime * 1000;
  }
  ```

- **[V]** The spec adds that accuracy is better the closer the argument is to `timestamp.contextTime`, and that `currentTime - contextTime` "cannot be considered as a reliable output latency estimation because currentTime may be incremented at non-uniform time intervals, so outputLatency attribute should be used instead." (same section)
- **[V]** `outputLatency` is "the interval between the time the UA requests the host system to play a buffer and the time at which the first sample in the buffer is actually processed by the audio output device"; it "may change while the context is running" and "it is useful to query this value frequently when accurate synchronization is required." `baseLatency` covers only the hand-off from the destination node to the audio subsystem. ([Web Audio API, AudioContext attributes](https://webaudio.github.io/web-audio-api/#dom-audiocontext-outputlatency))
- **[V]** Support: `getOutputTimestamp` Chrome 57, Firefox 70, Safari 14.1. `outputLatency` Chrome 102, Firefox 70, Safari 18.4. ([browser-compat-data, AudioContext.json](https://github.com/mdn/browser-compat-data/blob/main/api/AudioContext.json))
- **[V]** `performance.now()` is coarsened to 100 microseconds in non-isolated contexts and 5 microseconds in cross-origin-isolated ones. ([MDN, Performance.now](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now))

What follows from that:

- **[I]** The spec's `outputPerformanceTime(t)` is the conversion to use. It maps an audio time to the moment that sample leaves the audio device, so output latency is already included and a MIDI message stamped with it lines up with the sound, not with the moment the sample was rendered.
- **[I]** The naive form `performance.now() + (t - ctx.currentTime) * 1000` is wrong twice: it ignores output latency, and `currentTime` advances in render-quantum steps (2.7 ms at 48 kHz, more with large device buffers), which becomes MIDI jitter. Keep it only as a fallback, with `outputLatency` added: use it when `getOutputTimestamp()` returns zeros or an implausible pair.
- **[I]** Re-read `getOutputTimestamp()` on every scheduler pass. The audio clock runs off the sound card and `performance.now()` off the system clock; they drift, and the audio device or its latency can change mid-session. A conversion captured once at start goes stale.
- **[I]** `MIDIOutput` is exposed in workers, but a worker has its own time origin. Send from the main thread, or convert with the worker's own origin. Mixing origins produces a constant offset equal to the worker's start time.
- **[I]** The MIDI timestamp for audio time `t` is later than the wall-clock moment `currentTime` reaches `t`, by the output latency. MIDI therefore always has at least as much headroom as audio; a negative user trim eats into it.

## 3. The lookahead pattern, fed by a pure function

- **[V]** Chris Wilson's pattern: a coarse JS timer wakes regularly and schedules, on the audio clock, everything that falls inside a short window ahead. `while (nextNoteTime < audioContext.currentTime + scheduleAheadTime) { scheduleNote(...); nextNote(); }`. He suggests "100ms of 'lookahead' time, with intervals set to 25ms" as a starting point and names the trade-off: the lookahead should be "large enough to avoid any delays, but not so large as to be create noticeable delay when tweaking the tempo control". Scheduling far ahead means "if you want to change the tempo in the middle ... you're out of luck". Visuals run from `requestAnimationFrame` and read the audio clock. The article does not cover workers or MIDI. ([A Tale of Two Clocks](https://web.dev/articles/audio-scheduling), 2013)
- **[I]** The article's `nextNote()` is a stateful cursor. With a pure engine the loop gets simpler and more robust: keep one number, `scheduledUntil` (audio time), and each pass ask for the edges in `[scheduledUntil, currentTime + lookahead)`. There is no note cursor to corrupt when settings change, and a late timer just produces a longer slice.

This asks something specific of the engine, which matters for the engine spec:

- **[I]** The engine must offer an *edge query*, `edges(settings, fromSinceReset, toSinceReset) -> [{ time, channel, level }]`, alongside the point query `level(settings, tSinceReset)`. Sampling the point query on a grid cannot find 0.49 ms gates. The edge query must be half-open and exact, so consecutive slices neither drop nor duplicate an edge.
- **[I]** The point query is still needed: at a settings change (section 4) and for drawing.
- **[I]** Chance must be deterministic in time since Reset (seeded per step), or the edge query and the point query will disagree and slices will not join up. This is a constraint on the engine, not a scheduling finding.

## 4. Already-scheduled events when a parameter or Save Slot changes

- **[V]** Web MIDI defines `MIDIOutput.clear()` ("Clears any enqueued send data that has not yet been sent"), but Chrome does not implement it (tracked at [crbug 40411677](https://crbug.com/40411677)); Firefox has since 108. ([spec](https://webaudio.github.io/web-midi-api/#midioutput-interface), [browser-compat-data, MIDIOutput.json](https://github.com/mdn/browser-compat-data/blob/main/api/MIDIOutput.json))
- **[V]** `Transport.clear`/`cancel` only remove not-yet-fired Transport callbacks (section 1).
- **[I]** So a MIDI message sent with a future timestamp is committed in the dominant browser. Audio automation can be cancelled in principle (`AudioParam.cancelScheduledValues`), but cancelling audio and not MIDI would split the two outputs. Treat both as committed.

Consequences and the rule to adopt:

- **[I]** A change takes effect at the *horizon* `scheduledUntil`, not instantly. Worst-case delay is lookahead plus one timer interval: about 75 ms at 50/25 ms, 125 ms at 100/25 ms. Tone's own defaults give 150 ms.
- **[I]** Because output is a pure function of time since Reset, the changeover is exact and stays in sync: edges before the horizon come from the old settings, edges after it from the new, with the same time base. This is the same mechanism for a single parameter tweak, a CV-style modulation, and a Live Mode Save Slot press.
- **[I]** The seam needs one reconciliation step. Track the last level emitted per Channel. At the horizon, evaluate the new settings' point query; if it differs from the tracked level, emit an edge at the horizon. Without this a Channel that was high under the old settings and is low under the new leaves a hung MIDI note and a stuck voice.
- **[I]** Reset is the same case: it changes the time base at the horizon and reconciles levels there.
- **[I]** Stop cannot recall queued note-ons in Chrome. On stop, schedule a note-off per held Channel at the horizon (after everything already queued), then optionally CC 123 All Notes Off. Sending note-offs "now" is not enough: a queued note-on can land after them.
- **[I]** Coalesce UI input: apply the latest settings once per scheduler pass, not once per input event.

## 5. MIDI clock and jitter in practice

- **[V]** Chromium's handling of the send timestamp differs by OS. On macOS the timestamp is converted to a CoreMIDI `MIDITimeStamp` and passed to `MIDIPacketListAdd`, so the OS MIDI stack does the timing. On Linux (ALSA) and Windows (WinMM and WinRT backends) the message is held with a `PostDelayedTask` for `TimestampToTimeDeltaDelay(timestamp)` and then written, so timing depends on the browser's task timer. ([midi_manager_mac.cc](https://github.com/chromium/chromium/blob/main/media/midi/midi_manager_mac.cc), [midi_manager_alsa.cc](https://github.com/chromium/chromium/blob/main/media/midi/midi_manager_alsa.cc), [midi_manager_win.cc](https://github.com/chromium/chromium/blob/main/media/midi/midi_manager_win.cc), [midi_manager_winrt.cc](https://github.com/chromium/chromium/blob/main/media/midi/midi_manager_winrt.cc))
- **[I]** Expect the tightest MIDI on macOS Chrome and looser, timer-granularity jitter (order of a millisecond, worse under load) on Windows and Linux. No measurements were found or made; this is read off the code path.
- **[U]** Firefox's timestamp handling was not checked in source. Assume no better than Chrome on Windows/Linux until tested.
- **[I]** Timestamped sends are still far better than calling `send()` with no timestamp from a JS timer, which inherits the full jitter of the timer (tens of ms).
- **[I]** MIDI clock is 24 pulses per quarter note (`0xF8`), i.e. 6 per Main Clock pulse at 4 ppqn, 48 per second at 120 BPM (20.8 ms apart). Generate it from the same loop and time base: tick `n` is at `reset + n x 60 / (bpm x 24)`, converted like any other edge. Send `0xFA` Start at Reset/play and `0xFC` Stop on stop. (MIDI 1.0 constants; the MIDI spec was not re-fetched this session.)
- **[I]** A tempo change applies at the horizon like any other setting; compute subsequent ticks from the last tick emitted, not from Reset, or the clock phase jumps.
- **[I]** Wire limits, DIN MIDI: 31250 baud at 10 bits per byte is 320 microseconds per byte. A clock byte queued behind a 3-byte note message waits up to ~1 ms. A note on/off pair is 6 bytes, 1.92 ms, so one DIN port carries at most ~520 gates per second *in total across all 8 Channels and the clock*. A single Ratchet-255 Pattern at 120 BPM wants 2040. USB MIDI is faster on the wire but the receiving instrument is the practical limit. Dense ratchets must be limited before MIDI (section 7), or they will delay the clock and smear everything else.
- **[I]** "Sample-tight" is achievable only audio-to-audio. Audio-to-MIDI is bounded below by the wire (320 microseconds per byte), `performance.now()` coarsening (100 microseconds), the accuracy of `getOutputTimestamp`, and the OS path, plus the external device's own latency, which the browser cannot know. A user-facing MIDI offset in ms (positive and negative) is required, not optional.
- **[I]** Whether Main Clock Width (swing) should swing the MIDI clock or leave it straight is a product decision, not a scheduling one.

## 6. WebMIDI support and permissions, October 2026

- **[V]** `navigator.requestMIDIAccess`: Chrome 43+ (Edge, Opera, Chrome for Android and Android WebView follow Chrome). Firefox desktop 108+, with the note "API access is gated by installation of a site permission add-on (user prompt), secure context, and Permission Policy: midi". Firefox for Android: no. Safari, macOS and iOS: no, tracked at [webkit.org/b/107250](https://webkit.org/b/107250). ([browser-compat-data, Navigator.json](https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json))
- **[V]** MDN classes the API as "Limited availability ... not Baseline". ([MDN, Web MIDI API](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API))
- **[U]** Secondary sources report Safari 27 still lacks it and that WebKit has declined to ship over fingerprinting concerns ([caniuse](https://caniuse.com/midi)). WebKit's own position statement was not read. Browsers on iOS use WebKit, so assume no WebMIDI on iPhone/iPad.
- **[V]** Secure context is required (`[SecureContext]`), and the `midi` Permissions Policy defaults to `'self'`, so an embedding iframe needs `allow="midi"`. ([spec](https://webaudio.github.io/web-midi-api/#permissions-policy-integration))
- **[V]** Chrome 124+: "the entire Web MIDI API is now gated behind a permission prompt", where before only SysEx was. Denial rejects the promise. ([Chrome for Developers, 2024-04-16](https://developer.chrome.com/blog/web-midi-permission-prompt))
- **[V]** Permission state is queryable: `navigator.permissions.query({ name: "midi", sysex: false })` gives `granted`, `prompt` or `denied`. ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API), [spec](https://webaudio.github.io/web-midi-api/#permissions-integration))
- **[I]** For this app: do not request `sysex` (not needed for notes and clock, and it is the stronger permission). Call `requestMIDIAccess()` only from an explicit "Enable MIDI" control, never on load: it prompts in Chrome and triggers an add-on install dialog in Firefox. Feature-detect and show MIDI as unavailable in Safari; the audio path must work without it. A static HTTPS host (or `localhost` under Vite) satisfies the secure-context rule.
- **[I]** The AudioContext also needs a user gesture to start, so one "Start" interaction can cover audio, and a separate one MIDI.

## 7. Recommended pattern

One clock, one loop, two sinks.

1. **Clock.** `AudioContext.currentTime` is the only time base. Reset is stored as an audio time `resetAt`; time since Reset is `t - resetAt`. Never derive musical time from `performance.now()` or `Date`.
2. **Timer.** A Web Worker `setInterval`/`setTimeout` at ~25 ms posting to the main thread (Tone's `Ticker` already is one; either reuse the context's `tick` event or own a worker and keep Tone's internals out of the contract). Lookahead 50 ms to start; raise toward 100 ms if dropouts appear.
3. **Slice.** Each pass: `from = scheduledUntil`, `to = ctx.currentTime + lookahead`. If `from` is already in the past (timer stalled), jump `from` to `currentTime` and reconcile levels rather than emit a burst of late events. Take the latest settings snapshot, reconcile levels at `from` if settings or Reset changed, then call the engine's edge query for `[from, to)`. Set `scheduledUntil = to`.
4. **Audio sink.** For each edge call the Channel's voice with the absolute audio time (`triggerAttack(note, time)` / `triggerRelease(time)`). Never call Tone with no time argument and never mix in `Tone.now()`; the loop owns the lookahead.
5. **MIDI sink.** Once per pass read `getOutputTimestamp()`; for each edge send note on/off with `performanceTime + (time - contextTime) * 1000 + userOffsetMs`. Fallback when the pair is zero or implausible: `performance.now() + (time - currentTime + outputLatency) * 1000`. Emit MIDI clock from the same pass and the same conversion. Send in time order, clock included.
6. **Density limits.** Decide these in the spec, per sink:
   - MIDI: enforce a minimum gate period per Channel (for example, merge or drop edges closer than a few ms) and a global byte budget per slice so the clock is never starved.
   - Audio: below a threshold rate use triggered envelopes; above it treat the gate as a signal (drive a gain with `setValueAtTime` at each edge, or render the gate in an AudioWorklet) instead of retriggering an envelope.
7. **Changes.** Parameter, CV, Save Slot and Reset all apply at `scheduledUntil` with level reconciliation. Nothing already sent is recalled.
8. **Stop.** Stop the loop, schedule note-offs for held Channels at `scheduledUntil`, send `0xFC`, release voices.
9. **Drawing.** Do not schedule a `Draw` callback per edge. In `requestAnimationFrame`, evaluate the engine's point query at `getOutputTimestamp().contextTime - resetAt` (the time currently audible) and paint that. Dense gates need a visual treatment of their own (a "ratcheting" state) since a 60 Hz display cannot show 2 kHz.

### Known limits

- Change latency is the lookahead plus one interval (~75 ms at the suggested settings). Lower it and dropouts under main-thread load become likelier. This is the central trade-off and cannot be removed on the main thread.
- Audio-to-MIDI alignment is ms-class, varies by OS (best on macOS Chrome), and includes an unknown device latency: user trim required.
- Chrome cannot unsend queued MIDI. Stop and panic act at the horizon, not instantly.
- Ratchet rates exceed MIDI wire capacity by roughly 4x for a single Pattern at 120 BPM; a limiter is mandatory and changes what MIDI output means at high Ratchet.
- No WebMIDI in Safari or on iOS; Firefox needs an add-on install; Chrome prompts.
- Background tabs: Chrome throttles main-thread timers in background tabs and exempts pages "playing audio" ([Chrome blog, 2017](https://developer.chrome.com/blog/background_tabs)). **[I]** A worker timer still has to post to the throttled main thread, and a MIDI-only session with silent audio may not qualify for the exemption. Current behaviour was not verified; assume MIDI-only playback in a hidden tab can stall.
- A long main-thread block (GC, layout, a large Bank import) longer than the lookahead causes an audible and MIDI gap. Moving the engine and scheduler into an AudioWorklet would fix audio but not MIDI, which has no API on the audio thread.
- `performance.now()` may not advance during system sleep on non-Windows platforms ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now)); re-reading the timestamp pair each pass covers this, a one-time offset would not.

### Prototype before committing

1. Loopback test: MIDI out to an audio interface input (or a MIDI-triggered click), record against the app's audio, and measure offset and jitter of `getOutputTimestamp` conversion on macOS, Windows and Linux Chrome, and Firefox.
2. Edge throughput: how many edges per second per Channel Tone voices and `send()` sustain before glitches, to set the density thresholds in step 6.
3. Hidden-tab behaviour with and without audible audio.
4. MIDI clock stability into a hardware sequencer, with and without dense note traffic on the same port.
