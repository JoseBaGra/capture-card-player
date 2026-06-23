<h1 align="center">
  <img src="public/favicon.svg" width="100" alt="App Icon"> 
  <div align="center">Capture Card Play</div>
</h1>

<p align="center">
  A lightweight web application that lets you view and listen to a connected capture card directly in your browser.
</p>

## Features

- **Live Video Preview:** Stream high-definition video feeds directly onto the canvas.
- **Audio Playback:** Native audio pass-through configured without echo cancellation or noise suppression to ensure pure, uncompressed audio.
- **Vite Ecosystem:** Highly optimized development server and lightning-fast production asset builds.
- **Client-Side Security:** Zero server processing—your media streams never leave your device.

## Tech Stack

- **Build Tool & Dev Server:** [Vite](https://vite.dev/) — Provides an ultra-fast development environment using native ESM and bundles optimized static assets for production.
- **Core API:** [Web MediaDevices API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices) (`getUserMedia`) — Handles low-level browser interaction to access, list, and request permissions for hardware video and audio inputs.
- **Styling:** [SCSS (Sass)](https://sass-lang.com/) — Utilizes CSS nesting, variables, and modern preprocessor architecture for scalable component styling.
- **Frontend Framework:** Vanilla HTML5, JavaScript (ES6+) — Clean, native client-side execution with zero external framework dependencies (No React, Vue, or Angular required).

## Prerequisites

Before you begin, make sure you have the following installed:

- **[Node.js](https://nodejs.org/)** (v24.10.1 or higher)
- **[pnpm](https://pnpm.io/installation)** Recommended but usable with NPM.

## Getting Started

### Install dependencies

```bash
pnpm install
```

### Run in development

For development, running as a web app is recommended — it has faster build times and a quicker feedback loop:

```bash
pnpm dev
```

### Build

```bash
pnpm build
```

The output will generate inside a /dist directory, which can be thrown onto any static hosting provider.

## File Structure

```text
├── public/
│   └── favicon.svg      # App icon asset
├── src/
│   ├── styles/
│   │   └── main.scss    # Base SASS Styles
│   ├── capture-stage    # All the capture and MediaDevices handling
│   ├── main.ts          # Core application logic
├── index.html           # Main application shell
├── package.json         # NPM scripts, project dependencies, and sass package
└── index.html
```

## Notes

This application uses the browser's MediaDevices API to access video and audio streams from supported capture devices. All processing is performed locally in your browser.

## License

MIT License.
