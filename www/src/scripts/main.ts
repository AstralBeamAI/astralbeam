const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

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

  revealEls.forEach((el) => io.observe(el))
}

/* ============ terminal typing ============ */

function initTerminal() {
  const terminal = document.getElementById("terminal")
  if (!terminal) return
  const lines = Array.from(terminal.querySelectorAll<HTMLElement>(".t-line"))

  if (reducedMotion) {
    lines.forEach((l) => l.classList.add("typed"))
    return
  }

  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()

      let delay = 300
      for (const line of lines) {
        const isCmd = line.dataset.type === "cmd"
        setTimeout(() => line.classList.add("typed"), delay)
        delay += isCmd ? 650 : 120
      }
    },
    { threshold: 0.35 },
  )

  io.observe(terminal)
}

/* ============ agent sidebar prototype ============ */

/* Hardcoded stand-in for the shipped sidebar: replay one turn (user message,
   tool calls, streamed answer) the first time the panel scrolls into view. */
function initAgentDemo() {
  const panel = document.getElementById("agent-demo")
  if (!panel) return
  const steps = Array.from(panel.querySelectorAll<HTMLElement>("[data-step]"))
  const tools = Array.from(panel.querySelectorAll<HTMLElement>("[data-tool]"))
  const stream = panel.querySelector<HTMLElement>("[data-stream]")
  const answer = stream?.textContent?.trim() ?? ""

  if (stream) stream.textContent = answer

  if (reducedMotion) {
    steps.forEach((step) => step.classList.add("shown"))
    tools.forEach((tool) => tool.classList.add("running", "done"))
    return
  }

  if (stream) stream.textContent = ""

  function streamAnswer() {
    if (!stream) return
    // Rebind after the guard: the hoisted frame callback doesn't see narrowing.
    const target = stream
    target.classList.add("streaming")
    // Reveal a few characters per frame so the answer lands in about a second,
    // matching the cadence of a real token stream.
    let shown = 0
    function frame() {
      shown = Math.min(answer.length, shown + 2)
      target.textContent = answer.slice(0, shown)
      if (shown < answer.length) {
        requestAnimationFrame(frame)
      } else {
        setTimeout(() => target.classList.remove("streaming"), 1200)
      }
    }
    requestAnimationFrame(frame)
  }

  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()

      let delay = 250
      steps.forEach((step) => {
        setTimeout(() => step.classList.add("shown"), delay)
        delay += 500
      })
      tools.forEach((tool) => {
        setTimeout(() => tool.classList.add("running"), delay)
        delay += 450
        setTimeout(() => tool.classList.add("done"), delay)
        delay += 120
      })
      setTimeout(streamAnswer, delay + 200)
    },
    { threshold: 0.35 },
  )

  io.observe(panel)
}

initStarfield()
initReveals()
initTerminal()
initAgentDemo()
