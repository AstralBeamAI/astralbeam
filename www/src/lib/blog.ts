import type { MDXProps } from "mdx/types"
import type { ComponentType } from "react"

interface PostMetadata {
  title: string
  description: string
  date: string
  author: string
  image: string
  imageAlt: string
}

export const blogModules = import.meta.glob<{
  default: ComponentType<MDXProps>
  frontmatter: PostMetadata
  readingTime: { minutes: number }
}>("../content/blog/*.md", {
  eager: true,
})

export const blogPosts = Object.entries(blogModules)
  .map(([file, { frontmatter, readingTime }]) => {
    const slug = file.slice(file.lastIndexOf("/") + 1, -3)
    return {
      ...frontmatter,
      slug,
      path: `/blog/${slug}`,
      minutes: Math.max(1, Math.ceil(readingTime.minutes)),
    }
  })
  .sort((a, b) => b.date.localeCompare(a.date))

export function blogDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}
