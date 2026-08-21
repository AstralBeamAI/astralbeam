import { createChat } from "@shadcn/helpers/tanstack-ai"
import type { UIMessage } from "@tanstack/ai-client"
import type { CustomComponentDescriptor } from "../client.ts"

/**
 * Simulated tool names: until a real agent drives the chat, the scripted assistant "calls" these
 * tools and the widget reacts to their parts while rendering the transcript.
 */
export const RENDER_COMPONENT_TOOL = "render_component"
export const ASK_QUESTIONNAIRE_TOOL = "ask_questionnaire"

export interface RenderComponentInput {
  componentIndex: number
  props: Record<string, unknown>
}

interface QuestionnaireChoiceSpec {
  value: string
  label: string
  description?: string
}

export interface QuestionnaireItemSpec {
  name: string
  title: string
  description?: string
  required?: boolean
  multiple?: boolean
  choices: QuestionnaireChoiceSpec[]
  input?: { label: string; placeholder: string }
}

export interface QuestionnaireInput {
  items: QuestionnaireItemSpec[]
}

/** Marks questionnaire answers in the transcript so the fallback response can react to them. */
export const ANSWERS_PREFIX = "Here are my answers:"

export function slotNameForComponent(componentIndex: number): string {
  return `astralbeam-custom-${componentIndex}`
}

export function getMessageText(message: UIMessage): string {
  return message.parts.map((part) => part.type === "text" ? part.content : "").join("")
}

const planningItems: QuestionnaireItemSpec[] = [
  {
    name: "focus",
    title: "What should the plan optimize for?",
    description: "Choose a direction or describe your own.",
    required: true,
    choices: [
      {
        value: "deep-work",
        label: "Deep work",
        description: "Long uninterrupted blocks for the hard items.",
      },
      {
        value: "quick-wins",
        label: "Quick wins",
        description: "Clear as many small items as possible.",
      },
      { value: "balanced", label: "A balanced mix" },
    ],
    input: { label: "Something else", placeholder: "Describe another focus…" },
  },
  {
    name: "constraints",
    title: "Anything I should plan around?",
    description: "Select all that apply, or skip this question.",
    required: false,
    multiple: true,
    choices: [
      { value: "meetings", label: "Meetings on the calendar" },
      { value: "low-energy", label: "Low energy in the afternoon" },
      { value: "hard-stop", label: "A hard stop at the end of the day" },
    ],
  },
]

/**
 * Scripts the demo conversation for one widget mount. The transcript adapts to the registered
 * custom components: when the host registered at least one, the assistant "renders" the first one
 * inline through the render_component tool.
 */
export function buildConversation(customComponents: CustomComponentDescriptor[]) {
  const chat = createChat()
  chat.user("Hey! What can you do in this app?")
  chat.sleep(400)
  chat.assistant(
    "Hi! I'm the AstralBeam assistant. I'm running on a scripted conversation while the real agent is under construction, so send the queued messages to see streaming text, reasoning, tool calls, an in-chat questionnaire" +
      (customComponents.length > 0 ? ", and your app's own components rendered inline." : "."),
  )
  if (customComponents.length > 0) {
    chat.user("Show me the most important thing on my plate.")
    chat.sleep(400)
    chat.assistant(({ writer }) => {
      writer.reasoning(
        `The host app registered ${customComponents.length} custom component(s): ${
          customComponents.map((descriptor) => `"${descriptor.description}"`).join("; ")
        }. The first one fits this request, so I'll render it inline and highlight it.`,
      )
      writer
        .tool(RENDER_COMPONENT_TOOL, {
          input: {
            componentIndex: 0,
            props: { highlight: true },
          } satisfies RenderComponentInput,
        })
        .sleep(700)
        .output({ slotName: slotNameForComponent(0), rendered: true })
      writer.text(
        "Here it is — rendered by your app's own component, inside the chat but outside my styles.",
      )
    })
  }
  chat.user("Can you help me plan the rest of my day? Here are my notes.", {
    // Becomes a document part, which the widget renders with the Attachment component.
    files: [{ mediaType: "text/markdown", url: "https://astralbeam.ai/demo/day-notes.md" }],
  })
  chat.sleep(400)
  chat.assistant(({ writer }) => {
    writer.text("Happy to. Two quick questions first:")
    writer
      .tool(ASK_QUESTIONNAIRE_TOOL, {
        input: { items: planningItems } satisfies QuestionnaireInput,
      })
      .output({ status: "collecting answers" })
  })
  const connection = chat.transport({
    delayMs: 25,
    // Questionnaire answers and free-form input both fall outside the script, so the scripted
    // transport routes them here instead of throwing.
    fallback: ({ writer, messages }) => {
      const lastMessage = messages[messages.length - 1]
      const lastText = lastMessage ? getMessageText(lastMessage) : ""
      if (lastText.startsWith(ANSWERS_PREFIX)) {
        writer.reasoning("The user answered the planning questionnaire; I'll summarize a plan.")
        writer.text(
          "Noted! Start with one focused block on the top item, batch the small stuff into a single sweep afterwards, and keep the last hour free as a buffer. That's the whole scripted demo — a real agent takes over this seat soon.",
        )
      } else {
        writer.text(
          "I'm still a scripted demo, so I can't answer free-form questions yet — a real model will take over this seat soon.",
        )
      }
    },
  })
  return { chat, connection }
}
