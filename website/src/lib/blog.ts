import frontMatter from "front-matter"

interface PostMetadata {
  title: string
  description: string
  date: string
  author: string
  image: string
  imageAlt: string
}

const sources = import.meta.glob<string>("../content/blog/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
})

export const blogPosts = Object.entries(sources)
  .map(([file, source]) => {
    const { attributes, body } = frontMatter<PostMetadata>(source)
    const slug = file.slice(file.lastIndexOf("/") + 1, -3)
    return {
      ...attributes,
      slug,
      path: `/blog/${slug}`,
      body,
      minutes: Math.max(1, Math.ceil(body.split(/\s+/u).length / 220)),
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
