// Builds each changed project at the merge base and at HEAD, then upserts the PR metrics comment.
// Without PR_NUMBER or an open PR for the branch, the table is only printed.
const PROJECTS = ["examples/linearity-react", "examples/todos", "cli", "platform", "sdk", "www"]
// These consume `sdk/dist` through file dependencies, so an SDK change changes their builds.
const SDK_CONSUMERS = new Set(["examples/linearity-react", "examples/todos", "cli", "platform"])
const SHARED_INPUTS = new Set(["tsconfig.base.json", "scripts/count-lines.ts"])
const MARKER = "<!-- astralbeam-pr-metrics -->"
const METRICS = ["Source lines", "Generated lines", "Test lines", "Build size"]

type Metrics = Record<string, Record<string, string>>

async function run(args: string[], cwd: string): Promise<{ ok: boolean; output: string }> {
  const { code, stdout, stderr } = await new Deno.Command(args[0]!, {
    args: args.slice(1),
    cwd,
  }).output()
  const decoder = new TextDecoder()
  return { ok: code === 0, output: decoder.decode(stdout) + decoder.decode(stderr) }
}

async function git(...args: string[]): Promise<string> {
  const { ok, output } = await run(["git", ...args], root)
  if (!ok) throw new Error(`git ${args.join(" ")} failed:\n${output}`)
  return output.trim()
}

/** Installs and builds each project, then counts it with HEAD's script so both sides share rules. */
async function measure(label: string, checkout: string, projects: string[]): Promise<Metrics> {
  const step = async (args: string[], cwd: string) => {
    const result = await run(args, `${checkout}/${cwd}`)
    console.log(`${label}: ${cwd} ${args.join(" ")} ${result.ok ? "passed" : "failed"}`)
    if (!result.ok) console.log(result.output.slice(-4000))
    return result
  }
  const needsSdk = projects.some((project) => project === "sdk" || SDK_CONSUMERS.has(project))
  const sdkBuilt =
    !needsSdk ||
    ((await step(["deno", "install", "--frozen"], "sdk")).ok &&
      (await step(["deno", "task", "build"], "sdk")).ok)
  const metrics: Metrics = {}
  for (const project of projects) {
    const built =
      (project === "sdk" || (await step(["deno", "install", "--frozen"], project)).ok) &&
      (project === "sdk"
        ? sdkBuilt
        : sdkBuilt && (await step(["deno", "task", "build"], project)).ok)
    const counts = await run(
      ["deno", "run", "--allow-read", "--allow-env", "--allow-run=git", countLines],
      `${checkout}/${project}`,
    )
    metrics[project] = {}
    for (const line of counts.output.split("\n")) {
      const match =
        /^(Source lines|Generated lines|Test lines|Build size) ?(\([^)]*\))?: (.*)$/.exec(line)
      if (!match) continue
      const [, metric, output, value] = match
      metrics[project]![metric!] = metric !== "Build size" ? value! : formatSize(value!, built)
      if (output) metrics[project]![`${metric} label`] = output
    }
  }
  return metrics
}

function formatSize(value: string, built: boolean): string {
  if (value.endsWith(" MB")) return built ? value : "Unavailable (build failed)"
  return value === "not built" && !built ? "Unavailable (build failed)" : "N/A"
}

function delta(base: string | undefined, head: string | undefined): string {
  if (base === "N/A" && head === "N/A") return "N/A"
  const [before, after] = [Number.parseFloat(base ?? ""), Number.parseFloat(head ?? "")]
  if (Number.isNaN(before) || Number.isNaN(after)) return "Unavailable"
  if (before === after) return "0"
  const unit = head!.endsWith(" MB") ? " MB" : ""
  const difference = unit ? (after - before).toFixed(1) : String(after - before)
  return `${after > before ? "+" : ""}${difference}${unit}`
}

const root = (await run(["git", "rev-parse", "--show-toplevel"], ".")).output.trim()
const countLines = `${root}/scripts/count-lines.ts`
const target = Deno.env.get("BASE_REF") || "main"
const headSha = await git("rev-parse", "HEAD")
if (await git("status", "--porcelain")) console.warn("Uncommitted changes are not measured.")
await git("fetch", "--quiet", "origin", target)
const baseSha = await git("rev-parse", `origin/${target}`)
const mergeBase = await git("merge-base", baseSha, headSha)
const changed = (await git("diff", "--name-only", mergeBase, headSha)).split("\n")
const sharedChanged = changed.some((path) => SHARED_INPUTS.has(path))
const sdkChanged = changed.some((path) => path.startsWith("sdk/"))
const projects = PROJECTS.filter(
  (project) =>
    sharedChanged ||
    changed.some((path) => path.startsWith(`${project}/`)) ||
    (sdkChanged && SDK_CONSUMERS.has(project)),
)

// HEAD builds in its own checkout too, so it never rewrites the `sdk/dist` a running suite serves.
const baseCheckout = await Deno.makeTempDir({ prefix: "pr-metrics-base-" })
const headCheckout = await Deno.makeTempDir({ prefix: "pr-metrics-head-" })
await git("worktree", "add", "--detach", baseCheckout, mergeBase)
await git("worktree", "add", "--detach", headCheckout, headSha)
let base: Metrics
let head: Metrics
try {
  ;[base, head] = await Promise.all([
    measure("base", baseCheckout, projects),
    measure("head", headCheckout, projects),
  ])
} finally {
  await git("worktree", "remove", "--force", baseCheckout)
  await git("worktree", "remove", "--force", headCheckout)
}

const rows = projects.flatMap((project) =>
  METRICS.map((metric) => {
    const label = head[project]?.[`${metric} label`] ?? base[project]?.[`${metric} label`]
    const name = `\`${project}\` ${metric}${label ? ` ${label}` : ""}`
    const [before, after] = [base[project]?.[metric], head[project]?.[metric]]
    return `| ${name} | ${before ?? "Unavailable"} | ${after ?? "Unavailable"} | ${delta(before, after)} |`
  }),
)
const body = [
  `| Metric ${MARKER} | Base | Head | Delta |`,
  "| --- | --- | --- | --- |",
  ...(rows.length > 0 ? rows : ["| No project changed | | | |"]),
  `<!-- target: ${target}, base: ${baseSha}, merge-base: ${mergeBase}, head: ${headSha} -->`,
].join("\n")
console.log(`\n${body}`)

const pr =
  Deno.env.get("PR_NUMBER") ||
  (await run(["gh", "pr", "view", "--json", "number", "--jq", ".number"], root)).output.trim()
// gh fills `{owner}/{repo}` from the checkout's remote. https://cli.github.com/manual/gh_api
const repository = "{owner}/{repo}"
if (/^\d+$/.test(pr)) {
  const bodyFile = await Deno.makeTempFile({ suffix: ".md" })
  await Deno.writeTextFile(bodyFile, body)
  const existing = await run(
    [
      "gh",
      "api",
      "--paginate",
      `repos/${repository}/issues/${pr}/comments`,
      "--jq",
      `.[] | select(.body | contains("${MARKER}")) | .id`,
    ],
    root,
  )
  if (!existing.ok) throw new Error(`Could not list PR comments:\n${existing.output}`)
  const id = existing.output.trim().split("\n")[0]
  const write = id
    ? ["-X", "PATCH", `repos/${repository}/issues/comments/${id}`]
    : ["-X", "POST", `repos/${repository}/issues/${pr}/comments`]
  const result = await run(
    ["gh", "api", ...write, "-F", `body=@${bodyFile}`, "--jq", ".html_url"],
    root,
  )
  if (!result.ok) throw new Error(`Could not write the metrics comment:\n${result.output}`)
  console.log(`Metrics comment: ${result.output.trim()}`)
}
