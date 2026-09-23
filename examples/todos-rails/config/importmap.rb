# Pin npm packages by running ./bin/importmap

pin "application"
pin "@hotwired/turbo-rails", to: "turbo.min.js"
pin "@hotwired/stimulus", to: "stimulus.min.js"
pin "@hotwired/stimulus-loading", to: "stimulus-loading.js"
pin_all_from "app/javascript/controllers", under: "controllers"
pin "astralbeam_config"

# Pinned by URL rather than vendored, because the loader imports its lazy chunks relative to itself.
pin "@astralbeam/sdk/client", to: ENV.fetch("ASTRALBEAM_SDK_URL", "https://cdn.jsdelivr.net/npm/@astralbeam/sdk@0.12.0/dist/client.js")
