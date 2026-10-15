import { siteMetadata, siteUrl } from "@/lib/site"

interface PageHeadOptions {
  title: string
  description?: string
  canonicalPath?: string
  robots?: "index,follow" | "noindex,nofollow"
  social?: boolean
  type?: "website" | "article"
  image?: { path: string; width: number; height: number; alt: string }
  publishedTime?: string
}

/** Per-page search and social metadata. The invariant document tags live on the root route. */
export function pageHead({
  title,
  description = siteMetadata.description,
  canonicalPath,
  robots = canonicalPath ? "index,follow" : "noindex,nofollow",
  social = Boolean(canonicalPath),
  type = "website",
  image = siteMetadata.socialImage,
  publishedTime,
}: PageHeadOptions) {
  const canonicalUrl = canonicalPath ? siteUrl(canonicalPath) : undefined
  const socialImageUrl = siteUrl(image.path)

  return {
    meta: [
      { title },
      { name: "description", content: description },
      { name: "robots", content: robots },
      ...(social && canonicalUrl
        ? [
            { property: "og:site_name", content: siteMetadata.name },
            { property: "og:type", content: type },
            { property: "og:locale", content: "en_US" },
            { property: "og:url", content: canonicalUrl },
            { property: "og:title", content: title },
            { property: "og:description", content: description },
            { property: "og:image", content: socialImageUrl },
            { property: "og:image:secure_url", content: socialImageUrl },
            { property: "og:image:type", content: "image/png" },
            { property: "og:image:width", content: String(image.width) },
            { property: "og:image:height", content: String(image.height) },
            { property: "og:image:alt", content: image.alt },
            { name: "twitter:card", content: "summary_large_image" },
            { name: "twitter:title", content: title },
            { name: "twitter:description", content: description },
            { name: "twitter:image", content: socialImageUrl },
            { name: "twitter:image:alt", content: image.alt },
            ...(publishedTime
              ? [{ property: "article:published_time", content: publishedTime }]
              : []),
          ]
        : []),
    ],
    links: canonicalUrl ? [{ rel: "canonical", href: canonicalUrl }] : [],
  }
}
