import { createFileRoute } from "@tanstack/react-router"

import logo from "@/assets/astralbeam-logo-light.svg?url&no-inline"
import { blogDate, blogPosts } from "@/lib/blog"
import { pageHead } from "@/lib/page-head"

import { BlogShell } from "./-components/blog-shell"

export const Route = createFileRoute("/blog/")({
  head: () =>
    pageHead({
      title: "Blog | AstralBeam",
      description: "The latest news and articles from AstralBeam",
      canonicalPath: "/blog",
    }),
  component: BlogIndex,
})

function BlogIndex() {
  return (
    <BlogShell>
      <header className="blog-intro">
        <h1>
          <img src={logo} alt="AstralBeam" width="108" height="64" /> Blog
        </h1>
        <p>The latest news and articles from AstralBeam</p>
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
