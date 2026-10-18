import { createFileRoute, notFound } from "@tanstack/react-router"

import { blogDate, blogModules, blogPosts } from "@/lib/blog"
import { pageHead } from "@/lib/page-head"
import { siteMetadata, siteUrl } from "@/lib/site"

import { BlogShell } from "./-components/blog-shell"
import { markdownComponents } from "./-components/markdown"

export const Route = createFileRoute("/blog/$slug")({
  codeSplitGroupings: [["loader", "component"]],
  // Reject missing posts before loading split chunks so the static 404 can hydrate.
  // https://tanstack.com/router/latest/docs/framework/react/guide/not-found-errors
  beforeLoad: ({ params }) => {
    const files = Object.keys(import.meta.glob("../../content/blog/*.md"))
    if (!files.includes(`../../content/blog/${params.slug}.md`)) throw notFound()
  },
  loader: ({ params }) => {
    const post = blogPosts.find((entry) => entry.slug === params.slug)
    if (!post) throw notFound()
    return post
  },
  head: ({ loaderData: post }) => {
    if (!post) return pageHead({ title: "Post not found | AstralBeam" })
    return {
      ...pageHead({
        title: `${post.title} | AstralBeam`,
        description: post.description,
        canonicalPath: post.path,
        type: "article",
        image: { path: post.image, width: 1200, height: 630, alt: post.imageAlt },
        publishedTime: post.date,
      }),
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: post.title,
            description: post.description,
            datePublished: post.date,
            image: siteUrl(post.image),
            mainEntityOfPage: siteUrl(post.path),
            author: { "@type": "Organization", name: post.author, url: siteMetadata.origin },
            publisher: { "@id": `${siteUrl("/")}#organization` },
          }).replaceAll("<", "\\u003c"),
        },
      ],
    }
  },
  component: BlogPost,
})

function BlogPost() {
  const post = Route.useLoaderData()
  const Content = blogModules[`../content/blog/${post.slug}.md`]!.default
  return (
    <BlogShell>
      <article className="blog-article">
        <header className="blog-article-header">
          <a className="blog-back" href="/blog">
            ← All articles
          </a>
          <p className="blog-eyebrow">Design & engineering</p>
          <h1>{post.title}</h1>
          <p className="blog-deck">{post.description}</p>
          <p className="blog-meta">
            {post.author}
            <span>·</span>
            <time dateTime={post.date}>{blogDate(post.date)}</time>
            <span>·</span>
            {post.minutes} min read
          </p>
        </header>
        <img
          className="blog-cover"
          src={post.image.replace(/\.png$/u, ".svg")}
          alt={post.imageAlt}
          width="1200"
          height="630"
          fetchPriority="high"
        />
        <div className="blog-prose">
          <Content components={markdownComponents} />
        </div>
        <a className="blog-back blog-end" href="/blog">
          ← Back to the blog
        </a>
      </article>
    </BlogShell>
  )
}
