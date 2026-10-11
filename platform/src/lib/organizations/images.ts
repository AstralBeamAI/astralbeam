export function avatarFileUrl(organizationId: string, id: string): string {
  return `/api/files/organizations/${organizationId}/avatars/${id}`
}
export function logoFileUrl(organizationId: string, id: string): string {
  return `/api/files/organizations/${organizationId}/logos/${id}`
}
