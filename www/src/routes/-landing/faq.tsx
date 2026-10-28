import { siteMetadata } from "@/lib/site"

const docs = siteMetadata.links.docs

const comparisons = [
  {
    name: "OpenAI ChatKit",
    href: "https://developers.openai.com/api/docs/guides/chatkit",
    offering:
      "Embeddable chat UI. Its recommended path for new apps connects to your own agent backend.",
    difference: "We provide the chat UI and a managed agent backend together.",
  },
  {
    name: "ElevenAgents",
    href: "https://elevenlabs.io/docs/eleven-agents/overview",
    offering:
      "Agents for voice and multimodal conversations, with web widgets, phone integrations, and model choice.",
    difference:
      "We focus on agentic chat inside your web app, with tools, UI widgets, files, and per-customer usage limits.",
  },
  {
    name: "CopilotKit",
    href: "https://docs.copilotkit.ai/quickstart",
    offering: "Chat components and an agent runtime, plus optional cloud services.",
    difference:
      "We offer an opinionated frontend and managed backend, so you can focus on connecting the agent to your product.",
  },
  {
    name: "assistant-ui",
    href: "https://www.assistant-ui.com/docs/architecture",
    offering:
      "Customizable chat components, backend integrations, and hosted conversation history.",
    difference: "We also run the agent loop and handle files and per-customer usage limits.",
  },
  {
    name: "Mastra",
    href: "https://mastra.ai/docs",
    offering: "A TypeScript framework for building agents and workflows.",
    difference:
      "We provide the embedded chat experience and managed backend, reducing what you need to build and operate.",
  },
]

const questions = [
  {
    question: "Why not build it myself?",
    answer: (
      <>
        You have to patch together a lot of tools. It&apos;s error-prone, and you might end up
        building something sub-optimal or something that blows up your LLM bills. It&apos;s a moving
        target: models are changing, protocols are evolving, and best practices are changing.
        Developers should be able to focus on their product rather than keeping up with all this.
        That&apos;s why we made AstralBeam open source. We encourage you to try{" "}
        <a href={`${docs}/self-hosting`}>self-hosting it</a> before building your own.
      </>
    ),
  },
  {
    question: "How is AstralBeam different from other tools and services?",
    answer: (
      <>
        <p>
          There are tons of backend frameworks, but we feel you shouldn&apos;t need to manage the
          backend for your agents at all. The UI/UX of an agent is also hard to get right, so
          we&apos;re offering an opinionated solution to both.
        </p>
        <div
          className="faq-comparison"
          role="region"
          aria-label="Comparison with other tools and services"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Tool / service</th>
                <th scope="col">What it provides</th>
                <th scope="col">How AstralBeam compares</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map(({ name, href, offering, difference }) => (
                <tr key={name}>
                  <th scope="row">
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {name}
                    </a>
                  </th>
                  <td>{offering}</td>
                  <td>{difference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    ),
  },
  {
    question: "How do I get started?",
    answer: (
      <>
        AstralBeam provides the chat UI and agent backend, including conversation history and file
        handling. You add a server endpoint to identify your users, define the tools that connect to
        your app, and keep your business logic and permission checks. See the{" "}
        <a href={`${docs}/start/quickstart`}>quickstart</a>.
      </>
    ),
  },
  {
    question: "Will it work with our existing authentication and permissions?",
    answer: (
      <>
        Yes. Your server uses your existing session to identify the user and customer account, then
        issues a short-lived chat token. Your API key stays on the server. Actions go through your
        app&apos;s own authorization checks. Read the{" "}
        <a href={`${docs}/sdk/security`}>security model</a>.
      </>
    ),
  },
  {
    question: "Does it work outside React?",
    answer: (
      <>
        Yes. Use the React component, mount the widget with JavaScript in another framework, or load
        it with a script tag in a server-rendered app. Your token endpoint can be written in any
        language with a JWT library. See the{" "}
        <a href={`${docs}/sdk/script-tag`}>script-tag integration</a>.
      </>
    ),
  },
  {
    question: "Can I customize the chat UI?",
    answer: (
      <>
        Customize the widget&apos;s colors, typography, copy, and components, and render your own
        widgets inside replies. For full control, use the{" "}
        <a href={`${docs}/sdk/headless`}>headless SDK</a> to build your own chat interface on the
        same authentication, transport, and conversation state.
      </>
    ),
  },
  {
    question: "Can I use my own models and provider keys?",
    answer: (
      <>
        Yes. Bring your own keys for OpenAI, Anthropic, Google Gemini, xAI, or OpenRouter, then
        choose the models each agent can use. Model providers bill you directly. See{" "}
        <a href={`${docs}/dashboard/models`}>model configuration</a>.
      </>
    ),
  },
  {
    question: "Can the agent analyze files and create downloadable reports?",
    answer: (
      <>
        Yes. Users can upload supported documents, images, and data files. Connect a sandbox
        provider to let the agent run code, analyze spreadsheets, and publish charts or reports.
        Published files remain available from the conversation after the sandbox shuts down. See{" "}
        <a href={`${docs}/sdk/sandbox`}>sandboxes and artifacts</a>.
      </>
    ),
  },
  {
    question: "Can I set usage limits for each customer?",
    answer: (
      <>
        Yes. Set token or model-spend allowances per customer, user, or conversation, with fixed or
        rolling reset windows. Apply different allowances based on the plans in your app. Usage
        controls are available today. Stripe billing integration is in progress. See{" "}
        <a href={`${docs}/dashboard/usage-limits`}>usage limits</a>.
      </>
    ),
  },
  {
    question: "Can I self-host AstralBeam?",
    answer: (
      <>
        Yes. Use AstralBeam Cloud, have us manage it on your infrastructure, or operate it yourself.
        The platform is open source under AGPL-3.0, and the SDK is MIT licensed. Self-hosting has no
        AstralBeam platform or storage fees. You cover your infrastructure and providers. Read the{" "}
        <a href={`${docs}/self-hosting`}>self-hosting guide</a>.
      </>
    ),
  },
  {
    question: "What will I pay for?",
    answer: (
      <>
        Cloud pricing includes a usage-based platform fee and conversation and file storage. Your
        model, sandbox, and other provider charges are as-is. Monthly free credits cover AstralBeam
        fees for most customers just trying it out. See <a href="#pricing">pricing</a> for the rates
        and hosting options.
      </>
    ),
  },
]

export function Faq() {
  return (
    <section className="section faq" id="faq" aria-labelledby="faq-title">
      <div className="section-head">
        <p className="eyebrow">FAQ</p>
        <h2 className="display section-title" id="faq-title">
          FREQUENTLY ASKED QUESTIONS
        </h2>
      </div>

      <div className="faq-list">
        {questions.map(({ question, answer }) => (
          <details className="faq-item" key={question}>
            <summary>{question}</summary>
            <div className="faq-answer">{answer}</div>
          </details>
        ))}
      </div>
    </section>
  )
}
