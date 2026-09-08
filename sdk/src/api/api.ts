import { DEFAULT_API_URL } from "../lib/constants.ts"
import type { AstralBeamApiError as AstralBeamApiErrorBody } from "./generated/api.ts"

export type { AstralBeamApiErrorBody }

export interface ApiRequestOptions extends RequestInit {
  apiUrl?: string | undefined
  fetchClient?: typeof globalThis.fetch
}

export type ApiKeyOptions = ApiRequestOptions & { apiKey: string; astralBeamToken?: never }
export type JwtOptions = ApiRequestOptions & { astralBeamToken: string; apiKey?: never }
export type ApiOptions = ApiKeyOptions | JwtOptions
export type FileOptions = ApiRequestOptions & { apiKey?: never; astralBeamToken?: never }

export interface AstralBeamApiError extends Error {
  name: "AstralBeamApiError"
  status: number
  headers: Headers
  body?: AstralBeamApiErrorBody
}

export function isAstralBeamApiError(error: unknown): error is AstralBeamApiError {
  return error instanceof Error && error.name === "AstralBeamApiError" &&
    "status" in error && typeof error.status === "number"
}

export function resolveApiUrl(path: string, apiUrl = DEFAULT_API_URL): string {
  return `${apiUrl.replace(/\/+$/, "")}${path.replace(/^\/api(?=\/)/, "")}`
}

function isApiErrorBody(value: unknown, status: number): value is AstralBeamApiErrorBody {
  if (!value || typeof value !== "object") return false
  const body = value as AstralBeamApiErrorBody
  return body.status === status && typeof body.type === "string" &&
    typeof body.title === "string" && typeof body.detail === "string" &&
    (body.issues === undefined ||
      (Array.isArray(body.issues) &&
        body.issues.every((issue) =>
          issue && typeof issue.path === "string" && typeof issue.message === "string"
        )))
}

async function apiResponse(path: string, options: ApiOptions | FileOptions): Promise<Response> {
  const { apiUrl, apiKey, astralBeamToken, fetchClient = globalThis.fetch, ...init } = options
  const headers = new Headers(init.headers)
  headers.delete("authorization")
  headers.delete("x-api-key")
  if (apiKey) headers.set("x-api-key", apiKey)
  if (astralBeamToken) headers.set("authorization", `Bearer ${astralBeamToken}`)
  const response = await fetchClient(resolveApiUrl(path, apiUrl), {
    ...init,
    headers,
    redirect: "error",
  })
  if (response.ok) return response
  const value: unknown = await response.json().catch((error: unknown) => {
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  })
  const body = isApiErrorBody(value, response.status) ? value : undefined
  throw Object.assign(
    new Error(body?.detail ?? `AstralBeam API returned HTTP ${response.status}`),
    {
      name: "AstralBeamApiError" as const,
      status: response.status,
      headers: response.headers,
      body,
    },
  )
}

export async function astralBeamApiFetch<T>(path: string, options: ApiOptions): Promise<T> {
  return await (await apiResponse(path, options)).json()
}

export function astralBeamJwtFetch<T>(path: string, options: JwtOptions): Promise<T> {
  return astralBeamApiFetch<T>(path, options)
}

export function astralBeamChatFetch<_T>(path: string, options: JwtOptions): Promise<Response> {
  return apiResponse(path, options)
}

export function astralBeamFileFetch<_T>(
  path: string,
  options: FileOptions = {},
): Promise<Response> {
  return apiResponse(path, options)
}
