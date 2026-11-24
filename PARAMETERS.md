# Parameter reference

Every control in 8bitFX, the range it accepts, and the formula that turns it into the
value the engine actually uses. These are the same expressions as `js/params.js`
(`toKnobsCoerced`), so if you are porting a sound into another engine you can reproduce it
exactly from the numbers below.

Conventions: `p` is the stored parameter (0…1, or −1…1 where marked **signed**), `p³`/`p²`
are cubes/squares of that value, and "internal rate" is 352 800 Hz (44.1 kHz × 8) unless a
preview is being rendered at reduced oversampling.

## Envelope (`p_env_*`)

| Parameter | Range | Default | Becomes |
|---|---|---|---|
| `p_env_attack` | 0…1 | 0 | `p² · 100000 / 44100` seconds |
| `p_env_sustain` | 0…1 | 0.3 | `p² · 100000 / 44100` seconds |
| `p_env_punch` | 0…1 | 0 | sustain starts at `1 + (1−p)² · 2` and falls linearly to 1 — so **0 = maximum punch** |
| `p_env_decay` | 0…1 | 0.4 | `p² · 100000 / 44100` seconds |

The three stage lengths are scaled down together if they exceed the 4 s render cap. If a
sound ends at full level (decay = 0) the last millisecond is ramped down to avoid a click.

## Tone (`p_base_freq`, `p_freq_*`)

| Parameter | Range | Default | Becomes |
|---|---|---|---|
| `p_base_freq` | 0…1 | 0.3 | `3528 · (p² + 0.001)` Hz (≈3.5 Hz … 3.5 kHz) |
| `p_freq_limit` | 0…1 | 0 | same formula, used as the **lowest** allowed frequency; `0` = off |
| `p_freq_ramp` | −1…1 | 0 | `−44100 · log₂(1 − p³/100)` octaves/second (positive = rising) |
| `p_freq_dramp` | −1…1 | 0 | `−p³ · 10⁻⁶` added to the period per internal sample (accelerating slide) |

The glide is applied to the oscillator period every internal sample and clamped by
`p_freq_limit`, which is what gives lasers their "floor" at the bottom of the sweep.

## Vibrato (`p_vib_*`)

| Parameter | Range | Default | Becomes |
|---|---|---|---|
| `p_vib_strength` | 0…1 | 0 | depth = `p / 2` → ±50 % of the period at full |
| `p_vib_speed` | 0…1 | 0 | `68.9 · p²` Hz (up to ~69 Hz warble) |

Vibrato modulates the instantaneous period rather than the running one, so it warbles
instead of drifting.

## Arpeggio (`p_arp_*`)

| Parameter | Range | Default | Becomes |
|---|---|---|---|
| `p_arp_mod` | −1…1 | 0 | period × `1 / (1 − p²·0.9)` when positive, `1 / (1 + p²·10)` when negative — a value < 1 raises the pitch |
| `p_arp_speed` | 0…1 | 0 | `(⌊(1−p)² · 20000⌋ + 32) / 44100` seconds between steps (`p = 1` disables it) |

Each step **multiplies** the current period, so repeated steps climb (or fall) in a ladder —
the classic power-up sound.

## Pulse width (`p_duty`, `p_duty_ramp`)

| Parameter | Range | Default | Becomes |
|---|---|---|---|
| `p_duty` | 0…1 | 0 | duty = `(1 − p) / 2` → 50 % at 0, narrowing to 0 % at 1 |
| `p_duty_ramp` | −1…1 | 0 | `−17.64 · p` duty-units per second (clamped to 1–99 %) |

Only affects square and sawtooth waves.

## Retrigger (`p_repeat_speed`)

| Parameter | Range | Default | Becomes |
|---|---|---|---|
| `p_repeat_speed` | 0…1 | 0 | `44100 / (⌊(1−p)² · 20000⌋ + 32)` Hz; `0` = off |

Restarts the oscillator phase at that rate, which produces the stuttering "warble" used by
power-ups and alarms.

## Flanger (`p_pha_*`)

| Parameter | Range | Default | Becomes |
|---|---|---|---|
| `p_pha_offset` | −1…1 | 0 | `sign(p) · p² · 1020 / 44100` seconds of delay (±23 ms) |
| `p_pha_ramp` | −1…1 | 0 | `sign(p) · p²` seconds of delay per second (sweeps the comb) |

The delay line is 8192 samples at the internal rate. The flanger is bypassed entirely when
both values are 0 (sfxr always sums the current sample with itself at zero delay).

## Filters (`p_lpf_*`, `p_hpf_*`)

| Parameter | Range | Default | Becomes |
|---|---|---|---|
| `p_lpf_freq` | 0…1 | 1 | cutoff `352800 · x/(1−x)` Hz with `x = p³/10`; `p ≥ 0.9999` = off |
| `p_lpf_ramp` | −1…1 | 0 | cutoff multiplier `(1 + p/10000)^44100` per second |
| `p_lpf_resonance` | 0…1 | 0 | feedback damping `min(0.8, 5/(1 + p²·20) · (0.01 + coeff))` — higher = more ringing |
| `p_hpf_freq` | 0…1 | 0 | cutoff `352800 · y/(1−y)` Hz with `y = p²/10` |
| `p_hpf_ramp` | −1…1 | 0 | cutoff multiplier `(1 + 0.0003p)^44100` per second |

The low-pass is a one-pole filter with sfxr's feedback resonance; its smoothing coefficient is
clamped to 0.1 so the top of the slider still sounds filtered. The high-pass is a true
one-pole (unity gain at DC), so "OFF" really is off.

## Output and format

| Parameter | Range | Default | Becomes |
|---|---|---|---|
| `sound_vol` | 0…1 | 0.25 | linear gain `e^p − 1` (0.25 ≈ −10.9 dB, 1.0 ≈ +4.7 dB) |
| `p_dc_block` | 0/1 | 1 | 25 Hz high-pass after the flanger (removes pulse/noise offset) |
| `p_wave_trim` | 0/1 | 1 | scales saw/sine/noise by 0.5 so all waves peak at ±0.5 |
| `sample_rate` | 4000…96000 | 44100 | output rate; the UI offers 44.1k / 22.05k / 11.025k / 8k |
| `sample_size` | 8 or 16 | 8 | bit depth of the quantised output |
| `noise_seed` | uint32 | random | seeds the 32-entry noise table (makes renders reproducible) |

## JSON sound file

`Save .json` writes a flat object using exactly these keys, which is also the shape sfxr
reads, so sounds can be moved between tools:

```json
{
  "wave_type": 1,
  "p_env_attack": 0,
  "p_env_sustain": 0.31718502829007483,
  "p_base_freq": 0.2612619612083371,
  "p_lpf_freq": 1,
  "sound_vol": 0.25,
  "sample_rate": 44100,
  "sample_size": 8,
  "noise_seed": 1234567890
}
```

Unknown keys are ignored and out-of-range values are clamped on load.

## Permalink payload

`Copy link` stores everything in the URL fragment:

| Version | Format | Size |
|---|---|---|
| **v3** (current) | `#3` + base64url of 31 bytes: wave type, 23 parameters as bytes, 16-bit sample rate, flags (depth + two switches), 4-byte seed | ~43 chars |
| v2 | `#2` + same layout with a 4-entry rate index | ~41 chars |
| v1 | base64url of a JSON array | ~147 chars |

All three decode, so links made by any earlier build still open. Byte-quantising a knob
shifts it by at most 1/510 of its range — inaudible, but it is why a link can differ from the
original by a fraction of a step.

## Export naming

Single files are named `<sound>-<bits>bit-<kHz>k.wav` (e.g. `laserShoot-8bit-44k.wav`), and
`Pack .zip` writes the same names for every banked sound, with spaces in names replaced by
underscores.
