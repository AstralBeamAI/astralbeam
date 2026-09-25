# Pin npm packages by running ./bin/importmap

pin "todos"
pin "tenant_users"
pin "astralbeam_config"

# Pinned by URL rather than vendored, because the loader imports its lazy chunks relative to itself.
pin "@astralbeam/sdk/client", to: ENV.fetch("ASTRALBEAM_SDK_URL", "https://cdn.jsdelivr.net/npm/@astralbeam/sdk@0.13.1/dist/client.js")
