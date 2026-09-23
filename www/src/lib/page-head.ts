import { siteMetadata, siteUrl } from "@/lib/site"

interface PageHeadOptions {
  title: string
  description?: string
  canonicalPath?: string
  robots?: "index,follow" | "noindex,nofollow"
  social?: boolean
}

const socialImageUrl = siteUrl(siteMetadata.socialImage.path)

/** Per-page search and social metadata. The invariant document tags live on the root route. */
export function pageHead({
  title,
  description = siteMetadata.description,
  canonicalPath,
  robots = canonicalPath ? "index,follow" : "noindex,nofollow",
  social = Boolean(canonicalPath),
}: PageHeadOptions) {
  const canonicalUrl = canonicalPath ? siteUrl(canonicalPath) : undefined

  return {
    meta: [
      { title },
      { name: "description", content: description },
      { name: "robots", content: robots },
      ...(social && canonicalUrl
        ? [
            { property: "og:site_name", content: siteMetadata.name },
            { property: "og:type", content: "website" },
            { property: "og:locale", content: "en_US" },
            { property: "og:url", content: canonicalUrl },
            { property: "og:title", content: title },
            { property: "og:description", content: description },
            { property: "og:image", content: socialImageUrl },
            { property: "og:image:secure_url", content: socialImageUrl },
            { property: "og:image:type", content: "image/png" },
            { property: "og:image:width", content: String(siteMetadata.socialImage.width) },
            { property: "og:image:height", content: String(siteMetadata.socialImage.height) },
            { property: "og:image:alt", content: siteMetadata.socialImage.alt },
            { name: "twitter:card", content: "summary_large_image" },
            { name: "twitter:title", content: title },
            { name: "twitter:description", content: description },
            { name: "twitter:image", content: socialImageUrl },
            { name: "twitter:image:alt", content: siteMetadata.socialImage.alt },
          ]
        : []),
    ],
    links: canonicalUrl ? [{ rel: "canonical", href: canonicalUrl }] : [],
  }
}
