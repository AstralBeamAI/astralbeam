import { useHydrated } from "@tanstack/react-router"

export type LocalDateTimeProps = {
  value: Date | string
  dateStyle: "short" | "medium"
}

/** A time in the reader's locale and time zone, which only the browser knows until hydration. */
export function LocalDateTime({ value, dateStyle }: LocalDateTimeProps) {
  const isHydrated = useHydrated()
  const date = new Date(value)
  return (
    <time dateTime={date.toISOString()}>
      {isHydrated ? date.toLocaleString(undefined, { dateStyle, timeStyle: "short" }) : null}
    </time>
  )
}
