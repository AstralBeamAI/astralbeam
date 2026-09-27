// Read once by startSiteEffects(). The landing route imports this module during SSR, so nothing
// here may touch the DOM until the browser calls in.
let reducedMotion = false

/* ============ starfield ============ */

interface Star {
  x: number
  y: number
  depth: number // 0..1, larger = closer/brighter
  twinkle: number
}

function readCssColor(styles: CSSStyleDeclaration, property: `--${string}`) {
  const value = styles.getPropertyValue(property).trim()

  if (!value || !CSS.supports("color", value)) {
    throw new Error(`Invalid ${property} brand color`)
  }

  return value
}

function initStarfield() {
  const el = document.getElementById("starfield")
  const maybeCtx = el instanceof HTMLCanvasElement ? el.getContext("2d") : null
  if (!maybeCtx) return
  // Rebind after the guard: hoisted inner functions don't see narrowing of `maybeCtx`.
  const ctx = maybeCtx
  const canvas = ctx.canvas
  const styles = getComputedStyle(document.documentElement)
  const nearColor = readCssColor(styles, "--chart-5")
  const farColor = readCssColor(styles, "--secondary-foreground")

  let width = 0
  let height = 0
  let stars: Star[] = []
  let streak: { x: number; y: number; vx: number; vy: number; life: number } | null = null
  let nextStreakAt = 4000
  let raf = 0
  let last = performance.now()

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    width = window.innerWidth
    height = window.innerHeight
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const count = Math.min(320, Math.floor((width * height) / 6500))
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      depth: Math.random() ** 1.6,
      twinkle: Math.random() * Math.PI * 2,
    }))
  }

  function draw(now: number) {
    const dt = Math.min(50, now - last)
    last = now
    ctx.clearRect(0, 0, width, height)

    const scroll = window.scrollY
    for (const s of stars) {
      // slow drift plus scroll parallax by depth
      s.x += dt * 0.002 * (0.2 + s.depth)
      if (s.x > width + 2) s.x = -2
      const y = (((s.y - scroll * s.depth * 0.25) % height) + height) % height
      s.twinkle += dt * 0.0012 * (0.5 + s.depth)
      const alpha = (0.25 + 0.55 * s.depth) * (0.72 + 0.28 * Math.sin(s.twinkle))
      const size = 0.5 + s.depth * 1.3
      ctx.globalAlpha = alpha
      ctx.fillStyle = s.depth > 0.82 ? nearColor : farColor
      ctx.fillRect(s.x, y, size, size)
    }
    ctx.globalAlpha = 1

    // occasional shooting star
    nextStreakAt -= dt
    if (!streak && nextStreakAt <= 0) {
      const fromLeft = Math.random() > 0.5
      streak = {
        x: fromLeft ? -20 : width * (0.3 + Math.random() * 0.6),
        y: height * Math.random() * 0.45,
        vx: 0.55 + Math.random() * 0.35,
        vy: 0.16 + Math.random() * 0.12,
        life: 1,
      }
      nextStreakAt = 5000 + Math.random() * 6000
    }
    if (streak) {
      streak.x += streak.vx * dt
      streak.y += streak.vy * dt
      streak.life -= dt / 1400
      if (streak.life <= 0 || streak.x > width + 60) {
        streak = null
      } else {
        const grad = ctx.createLinearGradient(
          streak.x - streak.vx * 90,
          streak.y - streak.vy * 90,
          streak.x,
          streak.y,
        )
        grad.addColorStop(0, "transparent")
        grad.addColorStop(1, nearColor)
        ctx.strokeStyle = grad
        ctx.globalAlpha = 0.7 * streak.life
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(streak.x - streak.vx * 90, streak.y - streak.vy * 90)
        ctx.lineTo(streak.x, streak.y)
        ctx.stroke()
        ctx.globalAlpha = 1
      }
    }

    raf = requestAnimationFrame(draw)
  }

  resize()
  window.addEventListener("resize", resize)

  if (reducedMotion) {
    // single static frame
    draw(performance.now())
    cancelAnimationFrame(raf)
    return
  }

  raf = requestAnimationFrame(draw)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(raf)
    } else {
      last = performance.now()
      raf = requestAnimationFrame(draw)
    }
  })
}

/* ============ scramble-in headlines ============ */

const SCRAMBLE_CHARS = "▓▒░<>/\\|=+*ASTRLBEM0123456789"

function scramble(el: HTMLElement) {
  const finalText = el.dataset.text ?? el.textContent ?? ""
  const duration = 260
  const start = performance.now()

  function frame(now: number) {
    const t = Math.min(1, (now - start) / duration)
    const settled = Math.floor(finalText.length * t)
    let out = finalText.slice(0, settled)
    for (let i = settled; i < finalText.length; i++) {
      const ch = finalText[i]
      out += ch === " " ? " " : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
    }
    el.textContent = out
    if (t < 1) requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)
}

/* ============ HUD chrome ============ */

/* Below 820px the primary links live in a dropdown panel instead of the bar. */
export function startMenu() {
  const toggle = document.querySelector<HTMLButtonElement>("[data-menu]")
  const nav = document.getElementById("hud-nav")
  if (!toggle || !nav) return
  const controller = new AbortController()
  const { signal } = controller

  function setOpen(open: boolean) {
    nav?.toggleAttribute("data-open", open)
    toggle?.setAttribute("aria-expanded", String(open))
    toggle?.setAttribute("aria-label", open ? "Close menu" : "Open menu")
  }

  toggle.addEventListener(
    "click",
    (event) => {
      event.stopPropagation()
      setOpen(!nav.hasAttribute("data-open"))
    },
    { signal },
  )

  // Any tap outside, or on one of the links, dismisses the panel.
  document.addEventListener("click", () => setOpen(false), { signal })
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && nav.hasAttribute("data-open")) {
        setOpen(false)
        toggle.focus()
      }
    },
    { signal },
  )

  return () => controller.abort()
}

/* ============ scroll reveals ============ */

function initReveals() {
  const revealEls = document.querySelectorAll<HTMLElement>(".reveal")

  if (reducedMotion) {
    revealEls.forEach((el) => el.classList.add("in-view"))
    return
  }

  const scrambled = new WeakSet<HTMLElement>()
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const el = entry.target
        if (!(el instanceof HTMLElement)) continue
        el.classList.add("in-view")
        if (el.classList.contains("scramble") && !scrambled.has(el)) {
          scrambled.add(el)
          const delay = parseFloat(getComputedStyle(el).getPropertyValue("--reveal-delay")) || 0
          setTimeout(() => scramble(el), delay * 1000)
        }
        io.unobserve(el)
      }
    },
    { threshold: 0.25, rootMargin: "0px 0px -8% 0px" },
  )

  revealEls.forEach((el) => {
    io.observe(el)
    if (el.getBoundingClientRect().top >= window.innerHeight) el.classList.add("reveal-pending")
  })
}

/* ============ terminal typing ============ */

/* Each step's snippet types itself in the first time it scrolls into view. */
function initTerminals() {
  for (const terminal of document.querySelectorAll<HTMLElement>("[data-terminal]")) {
    const lines = Array.from(terminal.querySelectorAll<HTMLElement>(".t-line"))

    if (reducedMotion) {
      lines.forEach((l) => l.classList.add("typed"))
      continue
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()

        let delay = 200
        for (const line of lines) {
          const isCmd = line.dataset.type === "cmd"
          setTimeout(() => line.classList.add("typed"), delay)
          delay += isCmd ? 650 : 110
        }
      },
      { threshold: 0.35 },
    )

    io.observe(terminal)
    if (terminal.getBoundingClientRect().top >= window.innerHeight)
      terminal.classList.add("is-typing")
  }
}

/* ============ agent sidebar prototype ============ */

function initAgentDemo() {
  const panel = document.getElementById("agent-demo")
  if (!panel) return
  const replayButton = panel.querySelector<HTMLButtonElement>("[data-replay]")
  const thread = panel.querySelector<HTMLElement>("[data-thread]")
  if (!thread) return
  const feed = thread

  // The transcript ships in the HTML. Playback mounts one message at a time so
  // hidden messages do not reserve space in the scrolling panel.
  const scripted = Array.from(feed.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  )
  const answers = new Map<HTMLElement, string>()
  for (const stream of feed.querySelectorAll<HTMLElement>("[data-stream]")) {
    answers.set(stream, (stream.textContent ?? "").trim().replace(/\s+/gu, " "))
  }

  // A replay cancels any previous playback before starting again.
  let intro = 0

  // Pauses in ms. The intro should read like a conversation happening in real
  // time rather than a transcript being dumped into the panel.
  const PACE = {
    open: 1250,
    beforeUser: 1480,
    beforeAgent: 1250,
    afterMessage: 760,
    tool: 630,
    betweenTools: 290,
    widget: 490,
  }

  function wait(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
  }

  function nextFrame() {
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  }

  function scrollToEnd() {
    feed.scrollTop = feed.scrollHeight
  }

  function clear(message: HTMLElement) {
    message.classList.remove("shown")
    message.querySelectorAll(".agent-tool").forEach((tool) => {
      tool.classList.remove("running", "done")
    })
    message.querySelectorAll(".agent-widget").forEach((widget) => widget.classList.remove("shown"))
    message.querySelectorAll<HTMLElement>("[data-stream]").forEach((stream) => {
      stream.classList.remove("streaming")
      stream.textContent = ""
    })
  }

  function finish(message: HTMLElement) {
    message.classList.add("shown")
    message.querySelectorAll(".agent-tool").forEach((tool) => tool.classList.add("running", "done"))
    message.querySelectorAll(".agent-widget").forEach((widget) => widget.classList.add("shown"))
    message.querySelectorAll<HTMLElement>("[data-stream]").forEach((stream) => {
      stream.classList.remove("streaming")
      stream.textContent = answers.get(stream) ?? ""
    })
  }

  function reset() {
    if (!reducedMotion) panel?.classList.add("is-playing")
    feed.replaceChildren()
    scripted.forEach(clear)
    feed.scrollTop = 0
  }

  function completeScripted() {
    feed.querySelectorAll(".agent-thinking").forEach((marker) => marker.remove())
    for (const message of scripted) {
      if (!message.isConnected) feed.append(message)
      finish(message)
    }
    scrollToEnd()
  }

  async function mount(message: HTMLElement) {
    feed.append(message)
    scrollToEnd()
    // One frame with the message in flow at opacity 0, so the reveal transitions.
    await nextFrame()
    message.classList.add("shown")
    scrollToEnd()
  }

  function streamText(stream: HTMLElement, text: string, alive: () => boolean) {
    return new Promise<void>((resolve) => {
      stream.classList.add("streaming")
      let shown = 0
      function frame() {
        if (!alive()) return resolve()
        // Roughly a character and a half per frame reads like a real token stream.
        shown = Math.min(text.length, shown + 1.65)
        stream.textContent = text.slice(0, Math.floor(shown))
        scrollToEnd()
        if (shown < text.length) {
          requestAnimationFrame(frame)
        } else {
          setTimeout(() => stream.classList.remove("streaming"), 900)
          resolve()
        }
      }
      requestAnimationFrame(frame)
    })
  }

  /* Stands in for the wait before the model's first token, the way the real
     sidebar shows its shimmering "Thinking…" marker. */
  function createThinking() {
    const marker = document.createElement("article")
    marker.className = "agent-msg is-agent agent-thinking mono"
    marker.setAttribute("role", "status")
    const dot = document.createElement("i")
    dot.className = "thinking-dot"
    dot.setAttribute("aria-hidden", "true")
    const label = document.createElement("span")
    label.className = "thinking-label"
    label.textContent = "Thinking\u2026"
    marker.append(dot, label)
    return marker
  }

  async function think(ms: number, alive: () => boolean) {
    const marker = createThinking()
    await mount(marker)
    if (alive()) await wait(ms)
    marker.remove()
  }

  async function playMessage(message: HTMLElement, alive: () => boolean) {
    await mount(message)
    if (!alive()) return

    for (const tool of message.querySelectorAll<HTMLElement>("[data-tool]")) {
      tool.classList.add("running")
      scrollToEnd()
      await wait(PACE.tool)
      if (!alive()) return
      tool.classList.add("done")
      await wait(PACE.betweenTools)
      if (!alive()) return
    }

    const widget = message.querySelector<HTMLElement>("[data-widget]")
    if (widget) {
      widget.classList.add("shown")
      scrollToEnd()
      await wait(PACE.widget)
      if (!alive()) return
    }

    const stream = message.querySelector<HTMLElement>("[data-stream]")
    if (stream) await streamText(stream, answers.get(stream) ?? "", alive)
  }

  async function play() {
    const id = ++intro
    const alive = () => id === intro
    reset()
    for (const [index, message] of scripted.entries()) {
      const isUser = message.classList.contains("is-user")
      if (isUser) {
        await wait(index === 0 ? PACE.open : PACE.beforeUser)
      } else {
        await think(PACE.beforeAgent, alive)
      }
      if (!alive()) return
      await playMessage(message, alive)
      if (!alive()) return
      await wait(PACE.afterMessage)
      if (!alive()) return
    }
  }

  replayButton?.addEventListener("click", () => {
    if (reducedMotion) {
      intro += 1
      reset()
      completeScripted()
      return
    }
    void play()
  })

  if (reducedMotion) {
    completeScripted()
    return
  }

  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      io.disconnect()
      // Zero means a replay has not already started playback.
      if (intro === 0) void play()
    },
    { threshold: 0.3 },
  )

  io.observe(panel)
  reset()
}

function init() {
  initStarfield()
  initReveals()
  initTerminals()
  initAgentDemo()
}

export function startSiteEffects() {
  reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

  // WebKit runs module scripts before pending stylesheets finish loading, unlike Chromium and
  // Firefox, so on a cold Safari load the brand colors read from computed styles can still be
  // empty. That throws in initStarfield() before the reveals are wired up and leaves the page
  // blank. https://github.com/whatwg/html/issues/3890
  const stylesheet = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]')
  if (stylesheet && !stylesheet.sheet) {
    stylesheet.addEventListener("load", init, { once: true })
  } else {
    init()
  }
}
