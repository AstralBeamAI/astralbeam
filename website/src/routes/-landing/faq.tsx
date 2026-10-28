import { siteMetadata } from "@/lib/site"

const docs = siteMetadata.links.docs

const questions = [
  {
    question: "What is AstralBeam?",
    answer: (
      <>
        AstralBeam is an open-source platform for adding an AI agent to your app. It provides an
        embeddable chat UI and an agent backend so users can ask questions, use your app&apos;s
        tools, and work with files. You can use AstralBeam Cloud or self-host it.
      </>
    ),
  },
  {
    question: "Who is AstralBeam for?",
    answer: (
      <>
        AstralBeam is for developers and product teams building SaaS and multi-tenant apps who want
        to add an AI assistant to their product. You connect the agent to your app&apos;s data and
        actions while keeping your existing authentication and permission checks.
      </>
    ),
  },
  {
    question: "Why choose AstralBeam instead of building an agent myself?",
    answer: (
      <>
        AstralBeam brings the chat UI, model calls, tool orchestration, conversation history, and
        file handling together, so your team can focus on your product instead of assembling and
        maintaining that infrastructure. It is open source, supports your own model provider keys,
        and can run on your infrastructure. Try the{" "}
        <a href={`${docs}/start/quickstart`}>quickstart</a> or{" "}
        <a href={`${docs}/self-hosting`}>self-host it</a>.
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
            <p className="faq-answer">{answer}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
