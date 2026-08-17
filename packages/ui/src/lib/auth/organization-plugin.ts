// shadcn command: `vp run @astralbeam/ui#ui add @better-auth-ui/organization`
// Local edits: Re-exports the core-only plugin because AstralBeam does not expose Better Auth UI organization-management routes.

export { organizationPlugin } from "@better-auth-ui/core/plugins"
