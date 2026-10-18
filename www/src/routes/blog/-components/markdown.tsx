import type { MDXComponents } from "mdx/types"
import { isValidElement } from "react"
import type { ComponentProps } from "react"
import { defaultUrlTransform } from "react-markdown"

import { siteMetadata } from "@/lib/site"

import { FailureDemo } from "./failure-demo"

export const markdownComponents = {
  a({ href, title, children }: ComponentProps<"a">) {
    href = href && defaultUrlTransform(href)
    const external =
      href &&
      /^(?:https?:)?\/\//i.test(href) &&
      new URL(href, siteMetadata.origin).origin !== siteMetadata.origin
    return (
      <a
        href={href}
        title={title}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </a>
    )
  },
  pre({ children }: ComponentProps<"pre">) {
    if (
      isValidElement<ComponentProps<"code">>(children) &&
      children.props.className === "language-demo" &&
      typeof children.props.children === "string"
    ) {
      return <FailureDemo kind={children.props.children.trim()} />
    }
    return <pre>{children}</pre>
  },
  img({ src, alt }: ComponentProps<"img">) {
    return (
      <img src={src && defaultUrlTransform(src)} alt={alt ?? ""} loading="lazy" decoding="async" />
    )
  },
} satisfies MDXComponents
