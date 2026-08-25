import process from "node:process"

export const CHAT_AUTH_SECRET_ENV = "ASTRALBEAM_CHAT_AUTH_SECRET"
export const CHAT_AUTH_SECRET = process.env[CHAT_AUTH_SECRET_ENV]
