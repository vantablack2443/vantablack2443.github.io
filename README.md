# Dipu Balamurugan · Portfolio

**Live: [vantablack2443.github.io](https://vantablack2443.github.io)**

A static, bilingual (English / German) portfolio with two modes on one page:

- **Daylight**: a calm landing page over a looping, hand-painted Kerala backwaters video, with the CV, projects, skills and contact.
- **Lantern River** (in development): a browser game set on the same river at night. Paddle a boat across the water, moor at six docks to open the projects, light lanterns, and stay away from the crocodiles.

No backend, no tracking, no framework. Hosted for free on GitHub Pages.

## Highlights

- **Water simulated in Rust, compiled to WebAssembly.** A 2D height field (wave equation, 560 × 64 cells, 60 Hz) with absorbing reed beds along the banks. The crate has no dependencies and exports a small C ABI; TypeScript reads the wave heights straight from wasm memory. A TypeScript reference implementation is the fallback and is checked against the Rust build by a parity test.
- **Physics coupled two ways.** planck.js (Box2D) moves the boat, crocodiles, logs and water hyacinth in the river plane; heave and pitch come from the water under each hull, and every moving body pushes back into the water, so the boat leaves a wake.
- **Crocodile AI.** Lurk, stalk with lead pursuit, lunge, retreat. Lit lanterns and docks are safe zones they steer around.
- **Deterministic, headless simulation.** The game logic runs without a DOM or renderer, so it is covered by Vitest: settling, capsizing, mooring, lantern and bite rules, determinism, and a bot that has to finish the river.
- **Rendering with PixiJS (WebGL)** in a low-angle 2.5D perspective, with painted parallax layers, a water mesh shaded from its slopes, reflections and fireflies.
- **Light by default, game on demand.** Each mode's code is loaded only when it is opened, so light-mode visitors never download the game, Pixi or the wasm.
- **EN / DE** switch with no reload; German visitors get German on first paint.
- Accessible by default: semantic landmarks, a skip link, keyboard focus states, `prefers-reduced-motion` and Save-Data respected.

## Tech

TypeScript · Vite · Rust → WebAssembly · PixiJS · planck.js · Vitest · GitHub Actions

## Run it locally

Requirements: Node 22+, and Rust with the WebAssembly target.

```bash
rustup target add wasm32-unknown-unknown
cd portfolio
npm ci
npm run dev        # builds the wasm, then starts Vite on http://localhost:5173
```

```bash
npm test           # Vitest (game sim, water parity, i18n)
npm run build      # type check + production build into dist/
cd water-rs && cargo test
```

## Project layout

```
portfolio/
├── index.html            all CV text, once; both modes are CSS layouts of it
├── src/
│   ├── main.ts           theme switching, lazy loading, email
│   ├── i18n/             EN/DE switch and the German dictionary
│   ├── light/            daylight mode: video background, reveals, nav
│   ├── river/            the game: sim, water, camera, render, input, audio
│   └── styles/
├── water-rs/             the Rust water simulation (cdylib → water.wasm)
├── scripts/build-wasm.mjs
├── tests/                Vitest suites
└── public/               video, poster and the night art
```

## Deployment

Every push to `main` runs `.github/workflows/deploy.yml`: Rust tests, wasm build, JS tests, production build, then publish to GitHub Pages. If any test fails, nothing is published.

## Credits

Background video and game art generated with Google Gemini, then cut out and edited for the game. Icons from [Phosphor](https://phosphoricons.com) (MIT). Fonts: Geist and Geist Mono.

## License

[MIT](LICENSE)
