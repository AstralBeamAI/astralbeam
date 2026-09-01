import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/widget/components/ui/questionnaire"
import type { QuestionnaireAnswer, QuestionnaireItemSpec } from "../lib/types.ts"

// Collects submitted answers as the structured tool output the agent receives.
function collectAnswers(items: QuestionnaireItemSpec[], formData: FormData): QuestionnaireAnswer[] {
  return items.map((item) => {
    const values = formData.getAll(item.name).map(String).filter((value) => value.length > 0)
    const labels = values.map(
      (value) => item.choices.find((choice) => choice.value === value)?.label ?? value,
    )
    return { name: item.name, question: item.title, answers: labels }
  })
}

export function InlineQuestionnaire(
  { items, onAnswers }: {
    items: QuestionnaireItemSpec[]
    onAnswers: (answers: QuestionnaireAnswer[]) => void
  },
) {
  return (
    <Questionnaire
      className="rounded-xl border bg-card p-4"
      items={items}
      onSubmit={(event) => {
        event.preventDefault()
        onAnswers(collectAnswers(items, new FormData(event.currentTarget)))
      }}
    >
      <QuestionnaireProgress />
      {items.map((item) => (
        <QuestionnaireItem
          key={item.name}
          name={item.name}
          required={item.required ?? false}
          multiple={item.multiple ?? false}
        >
          <QuestionnaireTitle>{item.title}</QuestionnaireTitle>
          {item.description && (
            <QuestionnaireDescription>{item.description}</QuestionnaireDescription>
          )}
          <QuestionnaireChoices>
            {item.choices.map((choice) => (
              <QuestionnaireChoice key={choice.value} value={choice.value}>
                <span className="font-medium">{choice.label}</span>
                {choice.description && (
                  <span className="text-muted-foreground">{choice.description}</span>
                )}
              </QuestionnaireChoice>
            ))}
            {item.input && (
              <QuestionnaireInput
                aria-label={item.input.label}
                placeholder={item.input.placeholder}
              />
            )}
          </QuestionnaireChoices>
          <QuestionnaireError />
        </QuestionnaireItem>
      ))}
      <QuestionnaireActions>
        <QuestionnairePrevious />
        <QuestionnaireSkip />
        <QuestionnaireNext />
        <QuestionnaireSubmit>Send answers</QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  )
}
