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

/* Resolves once the snippet has finished typing, so the agent demo beside it can
   start streaming only after the code it illustrates is on screen. */
function initTerminal() {
  const terminal = document.getElementById("terminal")
  if (!terminal) return Promise.resolve()
  const lines = Array.from(terminal.querySelectorAll<HTMLElement>(".t-line"))

  if (reducedMotion) {
    lines.forEach((l) => l.classList.add("typed"))
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
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
        setTimeout(resolve, delay + 250)
      },
      { threshold: 0.35 },
    )

    io.observe(terminal)
  })
}

/* ============ agent sidebar prototype ============ */

/* Canned replies for anything the visitor types. Hardcoded stand-in until the
   real sidebar SDK can be embedded here. */
const DEMO_REPLIES: Array<{ tool?: [string, string]; text: string }> = [
  {
    tool: ["lookupOrder", "4830"],
    text: "Order 4830 shipped this morning. Tracking is already in her inbox.",
  },
  { tool: ["refund", "$9.00"], text: "Refunded the shipping fee too, since the delay was on us." },
  { text: "Two similar tickets came in this week. Want me to group them into one thread?" },
  {
    tool: ["addNote", "account"],
    text: "Done. I left a note on the account so the next agent has the context.",
  },
  { text: "Her plan renews on the 14th. I can pause it if she would rather wait." },
  {
    text:
      "I only see the last four digits of the card, so payment details are out of scope for me.",
  },
  { tool: ["draftEmail", "reply"], text: "Drafted a reply for you to approve before it goes out." },
  { text: "Nothing else is outstanding on this account right now." },
  {
    tool: ["lookupOrder", "4830"],
    text: "That one ships from the Ohio warehouse, so delivery lands Thursday.",
  },
  {
    tool: ["escalate", "payments"],
    text: "Escalated to the payments team and linked this conversation for them.",
  },
]

function initAgentDemo(codeReady: Promise<void>) {
  const panel = document.getElementById("agent-demo")
  if (!panel) return
  const composer = panel.querySelector<HTMLFormElement>("[data-composer]")
  const input = panel.querySelector<HTMLInputElement>("[data-input]")
  const replayButton = panel.querySelector<HTMLButtonElement>("[data-replay]")
  const thread = panel.querySelector<HTMLElement>("[data-thread]")
  if (!thread || !composer || !input) return
  const feed = thread

  // The scripted transcript ships in the HTML so the panel is not empty without
  // JavaScript. Playback detaches it and mounts one message at a time: leaving
  // the hidden messages in flow would reserve their height, and scrolling the
  // thread to the newest message would then start below the visible ones.
  const scripted = Array.from(feed.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  )
  const answers = new Map<HTMLElement, string>()
  for (const stream of feed.querySelectorAll<HTMLElement>("[data-stream]")) {
    answers.set(stream, (stream.textContent ?? "").trim().replace(/\s+/gu, " "))
  }

  // Bumped by a replay or a visitor message so an in-flight intro can tell that
  // it has been superseded. Visitor replies are never cancelled.
  let intro = 0
  const always = () => true

  // Pauses in ms. The intro should read like a conversation happening in real
  // time rather than a transcript being dumped into the panel.
  const PACE = {
    open: 450,
    beforeUser: 1250,
    beforeAgent: 750,
    afterMessage: 650,
    tool: 520,
    betweenTools: 240,
    widget: 400,
    visitorReply: 900,
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
    feed.replaceChildren()
    scripted.forEach(clear)
    feed.scrollTop = 0
  }

  /* Jump the intro to its end without touching anything the visitor has sent. */
  function completeScripted() {
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
        // A few characters per frame reads like a real token stream.
        shown = Math.min(text.length, shown + 2)
        stream.textContent = text.slice(0, shown)
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
      await wait(index === 0 ? PACE.open : isUser ? PACE.beforeUser : PACE.beforeAgent)
      if (!alive()) return
      await playMessage(message, alive)
      if (!alive()) return
      await wait(PACE.afterMessage)
      if (!alive()) return
    }
  }

  function createUserMessage(text: string) {
    const message = document.createElement("article")
    message.className = "agent-msg is-user"
    const body = document.createElement("p")
    body.textContent = text
    message.append(body)
    return message
  }

  function createAgentMessage(reply: (typeof DEMO_REPLIES)[number]) {
    const message = document.createElement("article")
    message.className = "agent-msg is-agent"

    if (reply.tool) {
      const [name, argument] = reply.tool
      const tools = document.createElement("ul")
      tools.className = "agent-tools mono"
      const item = document.createElement("li")
      item.className = "agent-tool"
      item.dataset.tool = ""
      const dot = document.createElement("i")
      dot.className = "tool-dot"
      dot.setAttribute("aria-hidden", "true")
      const toolName = document.createElement("span")
      toolName.className = "tool-name"
      toolName.textContent = name
      const detail = document.createElement("b")
      detail.textContent = argument
      item.append(dot, toolName, detail)
      tools.append(item)
      message.append(tools)
    }

    const stream = document.createElement("p")
    stream.className = "agent-stream"
    stream.dataset.stream = ""
    message.append(stream)
    answers.set(stream, reply.text)
    return message
  }

  composer.addEventListener("submit", (event) => {
    event.preventDefault()
    const text = input.value.trim()
    if (!text) return
    input.value = ""

    // Supersede the intro and land it at its end, so the transcript above the
    // visitor's message is never left half-revealed.
    intro += 1
    completeScripted()

    const reply = DEMO_REPLIES[Math.floor(Math.random() * DEMO_REPLIES.length)]
    if (!reply) return
    const userMessage = createUserMessage(text)
    const agentMessage = createAgentMessage(reply)

    if (reducedMotion) {
      feed.append(userMessage, agentMessage)
      finish(userMessage)
      finish(agentMessage)
      scrollToEnd()
      return
    }

    void (async () => {
      await mount(userMessage)
      await wait(PACE.visitorReply)
      await playMessage(agentMessage, always)
    })()
  })

  replayButton?.addEventListener("click", () => {
    input.value = ""
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

  reset()
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      io.disconnect()
      void codeReady.then(() => {
        // A zero here means nothing has interrupted the intro while the snippet
        // was typing, so it is still safe to start it.
        if (intro === 0) void play()
      })
    },
    { threshold: 0.3 },
  )

  io.observe(panel)
}

initStarfield()
initReveals()
initAgentDemo(initTerminal())
