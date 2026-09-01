# Theming

The widget ships its own palette inside a shadow root, so your page styles never leak in and its styles never leak out. You retune it with a color scheme and CSS token overrides.

## Color scheme

`colorScheme` is `"light"`, `"dark"`, or `"system"` (the default), which follows the OS setting live.

```tsx
<AstralBeamChat colorScheme="dark" />
```

## Theme tokens

`theme` overrides the widget's [shadcn/ui tokens](https://ui.shadcn.com/docs/theming) per scheme; `light` is the base applied in both, and `dark` layers on top when the resolved scheme is dark.

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
- Because the shadow root cannot read your stylesheet, tokens must be passed here, not inherited.

## Widget renders

Your own widgets (see [Tools and widgets](./tools-and-widgets.md)) render in the host page's light DOM, not the shadow root.

- They inherit your page's typography and CSS custom properties automatically.
- Your own selectors match a render like any other element; target `[slot^="astralbeam-widget-"]` for all of them.
- Inherited properties are read from the mount target's parent, so rules on the target itself are missed.
- Tokens declared only in a cross-origin stylesheet cannot be read.
- The bridge pins `-webkit-text-fill-color` to `currentColor` on projected content, so your `color` rules always drive text paint.
