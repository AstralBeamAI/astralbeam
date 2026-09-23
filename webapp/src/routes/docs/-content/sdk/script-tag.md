# Script tag

The SDK's `client` entry is a self-contained ES module, so any server-rendered application can load it from jsDelivr without npm or a bundler. Let's add the chat sidebar with a script tag, send the token request through your framework's CSRF protection, and wire it into a Ruby on Rails app.

## Load the widget

Let's give the widget a container with a definite height and mount it from a module script:

```html
<div id="astralbeam-chat" style="height: 100vh"></div>
<script type="module">
  import { mountAstralBeamChat } from "https://cdn.jsdelivr.net/npm/@astralbeam/sdk@0.12.0/dist/client.js"

  mountAstralBeamChat(document.getElementById("astralbeam-chat"), {
    title: "Acme Assistant",
    fetchAstralBeamToken: { url: "/astralbeam/token" },
  })
</script>
```

- Use `type="module"`. The 3 KB loader imports the chat chunk lazily, relative to its own URL.
- Import the full `/dist/client.js` path. The bare package URL has no browser entry.
- Pin an exact version. A range such as `@0` lets jsDelivr's cache serve the loader and its chunks from different releases, which fails with a 404 after each release.
- Every option in [Configuration](./configuration.md) works the same, and the returned handle has the same `update`, `reset`, `stop`, and `unmount` methods.
- `mountAstralBeamTenantUserList` and `mountAstralBeamTenantList` load from the same URL. See [Tenant directories](./listings.md).

**NOTE**: If your application sends a Content Security Policy, allow `https://cdn.jsdelivr.net` in `script-src` and your AstralBeam API in `connect-src`. The widget injects its stylesheet into its shadow root with a `<style>` element, so `style-src` must also allow inline styles.

## Add the token endpoint

The widget calls your server for a short-lived token before it chats. Your backend signs that token with your API key, in any language with a JWT library. [Authentication](./authentication.md) describes the endpoint's rules and the token format, with a Ruby example.

Frameworks with CSRF protection reject the widget's `POST` without a CSRF token. Let's send it as a standard `RequestInit` header, here read from the `<meta name="csrf-token">` tag that Rails and Laravel render:

```js
const csrfToken = document.querySelector("meta[name=csrf-token]").content

mountAstralBeamChat(element, {
  fetchAstralBeamToken: { url: "/astralbeam/token", headers: { "X-CSRF-Token": csrfToken } },
})
```

## Ruby on Rails

Rails 8 loads JavaScript through import maps and attaches behavior with Stimulus. Let's wire the widget into both:

1. Pin the SDK by URL in `config/importmap.rb`. Avoid `bin/importmap pin`, because it vendors one file and the loader's lazy chunks would be missing.

   ```ruby
   pin "@astralbeam/sdk/client", to: "https://cdn.jsdelivr.net/npm/@astralbeam/sdk@0.12.0/dist/client.js"
   ```

2. Mount the widget from a Stimulus controller in `app/javascript/controllers/astralbeam_chat_controller.js`:

   ```js
   import { Controller } from "@hotwired/stimulus"
   import { mountAstralBeamChat } from "@astralbeam/sdk/client"

   export default class extends Controller {
     connect() {
       const csrfToken = document.querySelector("meta[name=csrf-token]").content
       this.chat = mountAstralBeamChat(this.element, {
         fetchAstralBeamToken: { url: "/astralbeam/token", headers: { "X-CSRF-Token": csrfToken } },
       })
     }

     disconnect() {
       this.chat.unmount()
     }
   }
   ```

3. Render the mount point in a view. It needs an `id` and `data-turbo-permanent` so Turbo's morphing page refreshes leave the widget and its transcript alone.

   ```erb
   <div id="astralbeam-chat" data-controller="astralbeam-chat" data-turbo-permanent style="height: 100vh"></div>
   ```

4. Add `post "astralbeam/token" => "astral_beam_tokens#create"` to `config/routes.rb` and a controller that mints the token as shown in [Authentication](./authentication.md).

- Tools that change server data can call your controllers with `fetch` and then refresh the page with `Turbo.visit(location.href, { action: "replace" })`. With `turbo_refreshes_with method: :morph` in the layout, the chat keeps its transcript.
- Widgets render into the mount point's light DOM, so your stylesheet styles them. Name your CSS custom properties distinctly, because the widget's own tokens such as `--card` and `--border` shadow same-named variables inside the conversation.

**TIP**: The [`examples/todos-rails`](https://github.com/AstralBeamAI/astralbeam/tree/main/examples/todos-rails) app is a complete Rails 8 integration with host tools over a JSON API, a `todoCard` widget, and the tenant-user directory.
