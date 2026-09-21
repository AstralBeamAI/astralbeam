import process from "node:process"

export const API_KEY = process.env["ASTRALBEAM_API_KEY"]
export const IS_PRODUCTION = process.env["NODE_ENV"] === "production"
