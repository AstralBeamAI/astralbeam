# Third-party licenses and notices

Third-party components and materials included in this repository or in AstralBeam distributions remain subject to the applicable licenses and notices provided by their respective owners. AstralBeam's licenses do not replace those terms.

This curated inventory covers known third-party material intentionally copied, generated, or bundled into maintained source and release outputs. It is not a software bill of materials. Components with adjacent license or notice files are not repeated here, and an omission does not imply AstralBeam ownership or relicensing or alter the applicable third-party terms.

Project manifests and lockfiles identify additional dependencies. Every distribution must be reviewed against its actual contents and preserve all required license and notice material. Common license texts are stored under [`LICENSES`](LICENSES/), and each `webapp` build generates client and server `THIRD_PARTY_LICENSES.md` reports from its bundle graphs.

## MIT

Common license text: [MIT License](LICENSES/MIT.txt).

- [Create TanStack App / TanStack CLI](https://github.com/TanStack/cli)-derived portions of `webapp`, including its router, routes, generated route tree, and build configuration — Copyright (c) 2021-present Tanner Linsley
- [shadcn/ui](https://github.com/shadcn-ui/ui)-generated or adapted source, configuration, and styles under `webapp`, including the imported `shadcn/tailwind.css` — Copyright (c) 2023 shadcn
- [Emailcn](https://github.com/shadcn-labs/emailcn)-derived React Email layouts under `webapp/src/emails`, adapted from commit `7979f3be5fb0e7f689b810a24d48c2c75c40ed06` — Copyright (c) 2026 Shadcn Labs
- [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) output included in `webapp` — Copyright (c) Tailwind Labs, Inc.
- [`tw-animate-css`](https://github.com/Wombosvideo/tw-animate-css) styles imported by `webapp/src/styles.css` — Copyright (c) 2025 Wombosvideo

## OFL-1.1

Common license text: [SIL Open Font License 1.1](LICENSES/OFL-1.1.txt).

- `@fontsource/anton` font files in `www` — Copyright 2020 The Anton Project Authors (https://github.com/googlefonts/AntonFont.git)
- `@fontsource/jetbrains-mono` font files in `www` — Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) JetBrainsMono-Italic[wght].ttf: Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)
- `@fontsource-variable/space-grotesk` font files in `www` — Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk)
- `@fontsource-variable/inter` font files in `webapp` — Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter) Inter-Italic[opsz,wght].ttf: Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)
- `@fontsource-variable/manrope` font files in `webapp` — Copyright 2019 The Manrope Project Authors (https://github.com/sharanda/manrope)
