# Normies Art - Project Plan

## What This Is
A community tools web app for Normies NFT holders (normies.art).
Users enter any token ID (0-9999) and interact with their Normie.

## API
Base URL: https://api.normies.art
- GET /normie/:id/image.svg
- GET /normie/:id/image.png
- GET /normie/:id/traits
- GET /normie/:id/pixels
- GET /normie/:id/canvas/info
- GET /normie/:id/metadata
- GET /history/normie/:id/versions
- GET /history/normie/:id/version/:version/image.svg

## Features (in order)
- [ ] Token ID input + load Normie (SVG display + traits)
- [ ] Color theme effects on the pixel bitmap
- [ ] Canvas version flipbook / timeline viewer
- [ ] More TBD

## Stack
- Vite + React (plain JavaScript)
- Hosted on Vercel
- No backend — all API calls direct to api.normies.art
