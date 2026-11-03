import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import process from "node:process"

import { APP_HANDLE, APP_NAME } from "./constants"

export function getDataDirectory(): string {
  if (process.env.ASTRALBEAM_DATA_DIR) return resolve(process.env.ASTRALBEAM_DATA_DIR)
  const home = homedir()
  if (process.platform === "win32")
    return join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), APP_NAME)
  const xdg = process.env.XDG_DATA_HOME
  if (xdg && isAbsolute(xdg)) return join(xdg, APP_HANDLE)
  return process.platform === "darwin"
    ? join(home, "Library", "Application Support", APP_NAME)
    : join(home, ".local", "share", APP_HANDLE)
}
