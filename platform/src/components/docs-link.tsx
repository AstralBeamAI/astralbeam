import { BookOpenTextIcon } from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"
import type { ComponentProps } from "react"
import { cn } from "cn"

export function DocsLink(props: ComponentProps<typeof Link>) {
  const target = props.target ?? "_blank"
  return (
    <Link
      {...props}
      to={props.href ?? props.to ?? "."}
      target={target}
      rel={props.rel ?? "noopener noreferrer"}
      preload={props.preload ?? false}
      className={cn(
        "font-medium text-primary underline underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        props.className,
      )}
    >
      {(state) => (
        <>
          <BookOpenTextIcon aria-hidden="true" weight="regular" className="me-1 inline size-4" />
          {typeof props.children === "function" ? props.children(state) : props.children}
          {target === "_blank" && <span className="sr-only"> (opens in a new tab)</span>}
        </>
      )}
    </Link>
  )
}
