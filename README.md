# Earthquake Playground

Earthquakes for the classroom. Start a quake and watch its P, S and surface waves travel through the ground,
computed on the graphics card (WebGPU) as it happens, with live seismograms. Same look as Earth Forge and
RenderWave. Runs in a recent Chrome, Edge or Safari.

## Run

```bash
npm install
npm run dev        # http://localhost:5177
```

`npm run check` type-checks, `npm run build` writes a static site to `dist/` (relative paths, so it works from any folder of a static host such as GitHub Pages or Netlify), and `npm run preview` serves it on port 5180.

## Three views

| View | What it shows |
|---|---|
| 1 Quake | **Lessons**: seven ready-made experiments with a question each (waves, S − P distance with a hidden *mystery quake*, P first motions, earthquake or explosion, soft soil, water and S waves, mountains). **Share this experiment** copies a link (`?s=…`, the setup deflated in the address) that rebuilds the ground, faults, explosion, seismometers and noise. P marks show the first motion (P↑ up, P↓ down) on the vertical records. A slice of the ground 61 km wide and 29 km deep. Click under the ground to start an earthquake (magnitude 1 to 8) or an explosion (quarry blast to 1 Mt nuclear test); P waves in rust and ochre, S waves in navy and teal, Rayleigh waves along the top. *Show* switches to Shaking or Particles. One to five seismometers (A to E, draggable, each with its own background noise) record velocity, displacement or acceleration, up and down or sideways, in real units at 100 samples per second, until the quake's waves have gone (automatic: at least the slowest wave's crossing of the slice, then until every station's last 3 s are below 3 % of its peak; at most 120 s; noise alone 60 s), with P, S and R marks, distance from S − P, peak and Modified Mercalli intensity. *Download seismograms* saves a zip of SAC files (velocity in nm/s) and a CSV. Draw any of sixteen rock types or your own, or dig caves; draw rock in the sky to build a mountain. Draw a fault (one at a time), choose where its rupture starts, and press *Start the quake*: up to 64 sources along the fault slip in turn at 2.6 km/s over a length set by the magnitude (Wells and Coppersmith, 1994). Undo, redo and reset for drawing and faults. Ready-made grounds: layers, soft-soil valley, mountains, volcano, fault, salt dome, water table, caves, ocean, plain rock. **Noise sources**: ocean waves, traffic or a factory (up to four), simulated with the quake so their waves spread and the nearest stations are noisiest; per-station added noise is still there; with no quake they are recorded alone. **Filter and spectra** (folded): traces, amplitude spectra (with the noise before P in grey) or spectrograms, and 4-pole Butterworth band-pass filters, causal or zero phase. |
| 2 Wave types | P, S, Love and Rayleigh waves race across 60 km of rock, with particles showing how each one moves the ground. |
| 3 Inside the Earth | A slice through the whole planet (simplified PREM). Click to start a deep quake; seismometers every degree around the world record it, and the record section shows the P and S shadow zones made by the liquid outer core. A click places the origin; Play, Replay and Reset run it. The rock attenuates the waves as PREM's shear Q says, and the record runs until the quake's waves are below the background noise at every seismometer (under an hour for M 5, about nine hours for M 7, at most twelve), so the surface waves (about 3.7 km/s here) go round the planet several times (R1 to R4). P and S first arrivals match IASP91 to about 2 %. |

Keys: <kbd>Space</kbd> pause or play, <kbd>R</kbd> replay.

## How

Elastic waves in a vertical slice (P-SV): velocity and stress on a staggered grid, fourth order in space and
second order next to the air, second order in time. Air and space are vacuum (no stiffness, no mass), so the
ground surface is free and can have any shape. Liquids have no shear stiffness, so S waves stop at them. A
perfectly matched layer (C-PML) absorbs the waves at the open sides of the Quake view. Sources are a double couple (a slipping fault) or
an explosion, with a Ricker time function. The P and S marks are first-arrival times through the current
ground (shortest paths on the grid).

Sizes: the simulation is linear, so magnitude only scales the waves, by a Brune spectrum at 1.1 Hz (3 MPa stress
drop), calibrated to about 1.5 cm/s at 20 km for magnitude 5, with the 2D waves converted toward 3D
(half-differentiated, as a line source's waves are a point source's integrated by half an order, and × √(20 km /
distance)). Explosions: body-wave magnitude 4.45 + 0.75 log₁₀(yield in kt). Intensity: Worden et al.
(2012) from the peak ground velocity of the stronger direction. Added noise: synthetic microseism near 0.2 Hz plus local
noise. Noise sources: random vertical forces on the surface, coloured per kind (ocean 0.25 Hz, traffic 2 Hz swelling and
fading, factory a 2.4 Hz tone), stepped in a second layer of waves in m/s (so the quake's magnitude scaling does not touch
them), calibrated to the chosen RMS at 1 km on plain rock, losing energy as they travel (e-fold in 2 s). They start 20 s
before each quake so their waves fill the slice.

Simplified on purpose: two dimensions (so no Love waves in the slice), long waves (1.1 Hz in the Quake view, about
80 s in the Earth view), point sources that slip at once, no attenuation, and the softest materials stiffened to S
speeds of 1.6 km/s.

## Files

```
src/
  main.ts, app.ts    entry point; the frame: views, dialogs, animation loop
  sim.ts             the GPU engine: ground to stiffness and density, steps, seismometers, drawing
  sim.wgsl           the elastic wave kernels (velocity, stress and source, record, picture)
  draw.wgsl          the picture: ground colours, waves, shaking, particles
  ground.ts          the Quake view's grid, rock types and ready-made grounds
  shaking.ts         magnitude, explosions, intensity, units
  scenario.ts        a whole setup in a link (share and open experiments)
  spectrum.ts        FFT, amplitude spectra, spectrograms, Butterworth filters
  export.ts          SAC, CSV and zip files of the seismograms
  travel.ts          first-arrival times (Dijkstra) for the P and S marks
  plot.ts            Earth Forge colours and canvas helpers
  noise.ts           noise source kinds (spectra, levels, calibration)
  views/quake.ts     view 1
  views/waves.ts     view 2
  views/earth.ts     view 3
```

Validation against SPECFEM2D and an exact solution of Lamb's problem: `validation/README.md`.

Cross sections through a region's map are set aside for a later, better version: `later/region.ts` (not built).

## License

MIT (see LICENSE). Live site: https://arthifact.github.io/earthquake-playground/
