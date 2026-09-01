import process from "node:process"

export const API_KEY_ID_ENV = "ASTRALBEAM_API_KEY_ID"
export const API_KEY_ENV = "ASTRALBEAM_API_KEY"
export const API_KEY_ID = process.env[API_KEY_ID_ENV]
export const API_KEY = process.env[API_KEY_ENV]
