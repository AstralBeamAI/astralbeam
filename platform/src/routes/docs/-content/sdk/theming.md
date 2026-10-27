# Theming

Set the widget's color scheme and theme tokens to match your application. Its shadow root isolates component styles from your page. Host-rendered widgets use your application's styles.

## Color scheme

`colorScheme` is `"light"`, `"dark"`, or `"system"` (the default), which follows the OS setting live.

<!-- ::start:tabs variant="files" -->

```tsx title="React"
<AstralBeamChat colorScheme="dark" />
```

```js title="JavaScript"
chat.update({ colorScheme: "dark" })
```

<!-- ::end:tabs -->

## Theme tokens

`theme` overrides the widget's [shadcn/ui tokens](https://ui.shadcn.com/docs/theming) per scheme. `light` is the base applied in both, and `dark` layers on top when the resolved scheme is dark.

```tsx
<AstralBeamChat
  theme={{
    light: { "--primary": "oklch(0.55 0.2 260)", "--radius": "0.5rem" },
    dark: { "--primary": "oklch(0.7 0.15 260)" },
  }}
/>
```

- Keys are CSS custom property names (`--background`, `--primary`, `--radius`, `--font-sans`, ...).
- Values apply immediately on prop or `update` changes.
- The widget defines its own palette, so pass overrides through `theme` instead of relying on inherited host tokens.

## Custom CSS

Use `customCss` for layout changes inside the shadow root. For example, increase the composer's height:

```tsx
<AstralBeamChat customCss={`textarea { min-height: 5rem; }`} />
```

Change the React prop or call `chat.update({ customCss })` to apply styles without resetting chat. Set it to `undefined` to restore SDK styles. Use trusted application CSS, not uncompiled Tailwind or user input. Prefer `theme` for colors and fonts. [Directories](./listings.md) accept the same option.

## Widget renders

Your own widgets (see [Tools and widgets](./tools-and-widgets.md)) render in the host page's light DOM, not the shadow root.

- They inherit your page's typography and CSS custom properties automatically.
- Your own selectors match a render like any other element. Target `[slot^="astralbeam-widget-"]` for all of them.
- Inherited properties are read from the mount target's parent, so rules on the target itself are missed.
- Tokens declared only in a cross-origin stylesheet cannot be read.
