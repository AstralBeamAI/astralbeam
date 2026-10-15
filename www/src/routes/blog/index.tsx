import { createFileRoute } from "@tanstack/react-router"

import { blogDate, blogPosts } from "@/lib/blog"
import { pageHead } from "@/lib/page-head"

import { BlogShell } from "./-components/blog-shell"

export const Route = createFileRoute("/blog/")({
  head: () =>
    pageHead({
      title: "Blog | AstralBeam",
      description:
        "Notes on building useful agents and the interfaces people use to work with them.",
      canonicalPath: "/blog",
    }),
  component: BlogIndex,
})

function BlogIndex() {
  return (
    <BlogShell>
      <header className="blog-intro">
        <p className="blog-eyebrow">The AstralBeam blog</p>
        <h1>
          Notes on building
          <br />
          with agents.
        </h1>
        <p>Ideas, details, and lessons from the interface between people and AI.</p>
      </header>
      <section className="blog-posts" aria-label="Latest articles">
        {blogPosts.map((post) => (
          <article className="blog-card" key={post.slug}>
            <a className="blog-card-image" href={post.path} tabIndex={-1} aria-hidden="true">
              <img src={post.image.replace(/\.png$/u, ".svg")} alt="" width="1200" height="630" />
            </a>
            <div>
              <p className="blog-meta">
                <time dateTime={post.date}>{blogDate(post.date)}</time>
                <span>·</span>
                {post.minutes} min read
              </p>
              <h2>
                <a href={post.path}>{post.title}</a>
              </h2>
              <p>{post.description}</p>
              <a className="blog-read" href={post.path}>
                Read the story <span aria-hidden="true">↗</span>
              </a>
            </div>
          </article>
        ))}
      </section>
    </BlogShell>
  )
}
