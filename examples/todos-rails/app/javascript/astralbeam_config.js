// Rails rejects a POST without the CSRF token, and the widget's token request is a POST.
export function csrfToken() {
  return document.querySelector("meta[name=csrf-token]").content
}

export function tokenRequest() {
  return { url: "/astralbeam/token", headers: { "X-CSRF-Token": csrfToken() } }
}

// Wires the page's Theme and Custom theme buttons, reporting each change as widget options.
export function bindAppearanceButtons(onChange) {
  const app = document.getElementById("app")
  const themeButton = document.getElementById("theme")
  const customThemeButton = document.getElementById("custom-theme")
  const state = { colorScheme: "system", customTheme: true }
  const apply = () => {
    app.dataset.colorScheme = state.colorScheme
    themeButton.textContent = `Theme: ${state.colorScheme}`
    customThemeButton.textContent = `Custom theme: ${state.customTheme ? "on" : "off"}`
    onChange({ colorScheme: state.colorScheme, theme: state.customTheme ? WIDGET_THEME : undefined })
  }
  themeButton.addEventListener("click", () => {
    const schemes = ["system", "light", "dark"]
    state.colorScheme = schemes[(schemes.indexOf(state.colorScheme) + 1) % schemes.length]
    apply()
  })
  customThemeButton.addEventListener("click", () => {
    state.customTheme = !state.customTheme
    apply()
  })
  apply()
}

const WIDGET_THEME = {
  light: {
    "--radius": "0.5rem",
    "--font-sans": 'Georgia, "Times New Roman", serif',
    "--font-heading": 'Georgia, "Times New Roman", serif',
    "--background": "#faf6ef",
    "--foreground": "#3d2f1e",
    "--card": "#fdf9f0",
    "--card-foreground": "#3d2f1e",
    "--popover": "#fdf9f0",
    "--popover-foreground": "#3d2f1e",
    "--primary": "#b4762a",
    "--primary-foreground": "#ffffff",
    "--secondary": "#f3e8d3",
    "--secondary-foreground": "#3d2f1e",
    "--muted": "#f3e8d3",
    "--muted-foreground": "#8a7355",
    "--accent": "#e9d9bb",
    "--accent-foreground": "#3d2f1e",
    "--destructive": "#a03c2e",
    "--border": "#c9b892",
    "--input": "#c9b892",
    "--ring": "#b4762a"
  },
  dark: {
    "--background": "#201a11",
    "--foreground": "#ede3cf",
    "--card": "#2b2416",
    "--card-foreground": "#ede3cf",
    "--popover": "#2b2416",
    "--popover-foreground": "#ede3cf",
    "--primary": "#d99a45",
    "--primary-foreground": "#201a11",
    "--secondary": "#3a3020",
    "--secondary-foreground": "#ede3cf",
    "--muted": "#3a3020",
    "--muted-foreground": "#b3a184",
    "--accent": "#4a3d28",
    "--accent-foreground": "#ede3cf",
    "--destructive": "#e2694e",
    "--border": "#6b5a3e",
    "--input": "#6b5a3e",
    "--ring": "#d99a45"
  }
}
