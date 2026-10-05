export const SUPPORT_MESSAGE_MAX_LENGTH = 5000
export const SUPPORT_ATTACHMENTS_MAX_COUNT = 5
// Leaves headroom under the 40 MB message limits of Resend and SES after base64 encoding.
export const SUPPORT_ATTACHMENTS_MAX_BYTES = 10 * 1024 * 1024
