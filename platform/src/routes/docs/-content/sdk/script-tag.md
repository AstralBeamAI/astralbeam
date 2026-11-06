# Script tag

Embed chat in Ruby on Rails or another server-rendered app by loading the SDK from jsDelivr. You'll need an authenticated [token endpoint](./authentication.md), a container with a height, and a module script. No package manager or bundler is required.

## Load the widget

Mount the widget into an HTML element:

```html
<div id="astralbeam-chat" style="height: 100vh"></div>
<script type="module">
  import { mountAstralBeamChat } from "https://cdn.jsdelivr.net/npm/@astralbeam/sdk@0.29.0/dist/client.js"

  mountAstralBeamChat(document.getElementById("astralbeam-chat"), {
    title: "Acme Assistant",
  })
</script>
```

Pin the exact version and keep the full `/dist/client.js` path so the widget and its lazy-loaded files use the same release. See [Configuration](./configuration.md) for customization.

**NOTE**: If your application sends a Content Security Policy, allow `https://cdn.jsdelivr.net` in `script-src` and your AstralBeam API in `connect-src`. The widget injects its stylesheet into its shadow root with a `<style>` element, so `style-src` must also allow inline styles.

## Add the token endpoint

Add the [Quickstart's backend handler](/docs/start/quickstart#3-connect-your-backend) at `/api/astralbeam/token`. Any backend language works. Keep your framework's CSRF protection. The Rails example below sends its CSRF header.

## Ruby on Rails

To embed chat in a Rails 8 app using import maps:

1. Pin the SDK by URL in `config/importmap.rb`, next to a pin for the page's own module. Avoid `bin/importmap pin`, because it vendors one file and the loader's lazy chunks would be missing.

   ```ruby
   pin "assistant"
   pin "@astralbeam/sdk/client", to: "https://cdn.jsdelivr.net/npm/@astralbeam/sdk@0.29.0/dist/client.js"
   ```

2. Mount the widget from that module in `app/javascript/assistant.js`:

   ```js
   import { mountAstralBeamChat } from "@astralbeam/sdk/client"

   const csrfToken = document.querySelector("meta[name=csrf-token]").content
   mountAstralBeamChat(document.getElementById("astralbeam-chat"), {
     fetchAstralBeamToken: { url: "/api/astralbeam/token", headers: { "X-CSRF-Token": csrfToken } },
   })
   ```

3. Render the mount point in a view and load the module with `javascript_importmap_tags "assistant"` in the layout's `<head>`.

   ```erb
   <div id="astralbeam-chat" style="height: 100vh"></div>
   ```

4. Add the route and controller from the [Rails token example](/docs/start/quickstart#3-connect-your-backend).

Sign in and send **"Say hello in one sentence."** Check that a reply streams into the widget.

Keep chat mounted in a persistent layout during navigation. Conversations save automatically. See [Saved conversations](./configuration.md#saved-conversations) for recovery.

**TIP**: The [`examples/todos-rails`](https://github.com/AstralBeamAI/astralbeam/tree/main/examples/todos-rails) app is a complete Rails 8 integration with host tools over a JSON API, a `todoCard` widget, and the tenant-user directory.
