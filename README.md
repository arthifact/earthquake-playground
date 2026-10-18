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
| 1 Quake | **Model templates**: real settings as cross-sections, each opening at its natural width: average continental crust (CRUST1.0), a subduction zone (Chile, Maule 2010; Slab2), the Himalayan front (Nepal, Gorkha 2015), the East African Rift (Kenya), the Los Angeles basin (SCEC CVM), a Gulf Coast salt basin, a mid-ocean ridge (Atlantic), an Etna-type stratovolcano, an Alpine valley (Grenoble) and a uniform half-space; each comes with the fault it is known for. **Width**: any slice from 20 to 1000 km (the grid keeps 768 × 400 cells, so it runs as fast; cells and waves scale together, 80 m and 1.1 Hz at 61 km). **Faults by numbers**: length, dip, top depth, position and dip direction, or drawn on the picture; *Fit to M* sets the down-dip width a magnitude ruptures (Wells and Coppersmith, 1994; Strasser et al., 2010, for megathrusts). Explosions from a quarry blast to 1 Mt. Up to five seismometers (draggable) record velocity, displacement or acceleration with P, S and R marks, first motions (P↑, P↓), distance from S − P, peak and intensity; filters, spectra and spectrograms; *Download* (SAC in nm/s and CSV) and *Copy link* (the whole setup in the address). Draw rock or dig caves; noise sources (ocean, traffic, factory) on slices up to 123 km. On wide slices the waves are slower, so peaks and intensities count only those and underrate the shaking near a big quake. |
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
