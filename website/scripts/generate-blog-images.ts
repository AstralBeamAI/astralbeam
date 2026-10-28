import { readdir } from "node:fs/promises"

import sharp from "sharp"

const directory = new URL("../public/blog/images/", import.meta.url)
for (const name of await readdir(directory)) {
  if (!name.endsWith(".svg")) continue
  await sharp(new URL(name, directory).pathname)
    .png({ palette: true, compressionLevel: 9, effort: 10 })
    .toFile(new URL(name.replace(/\.svg$/u, ".png"), directory).pathname)
}
