import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    client: 'src/client.ts',
    server: 'src/server.ts',
    react: 'src/react.ts',
    vue: 'src/vue.ts',
  },
  // The client, react, and vue entries run in browsers, so avoid Node-only output assumptions.
  platform: 'neutral',
  dts: true,
})
