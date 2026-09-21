import process from "node:process"

export const API_KEY = process.env["ASTRALBEAM_API_KEY"]
export const ORGANIZATION_ID = process.env["ASTRALBEAM_ORGANIZATION_ID"]
export const OPERATOR_EMAIL = process.env["ASTRALBEAM_OPERATOR_EMAIL"]
export const IS_PRODUCTION = process.env["NODE_ENV"] === "production"
