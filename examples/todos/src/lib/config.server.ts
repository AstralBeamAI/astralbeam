import process from "node:process"

export const API_KEY_ENV = "ASTRALBEAM_API_KEY"
export const API_KEY = process.env[API_KEY_ENV]
