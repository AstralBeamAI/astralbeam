export interface RenderWidgetInput {
  /** Key into the `widgets` object passed at mount. */
  widget: string
  props?: Record<string, unknown>
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

/** One submitted questionnaire answer, part of the tool output the agent sees. */
export interface QuestionnaireAnswer {
  name: string
  question: string
  answers: string[]
}
