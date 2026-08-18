function ensureServerEnv(key: string) {
  const value = process.env[key]
  if (value) return value
  throw new Error(`'${key}' enviroment variable is not set`)
}

export const DATABASE_URL = ensureServerEnv("DATABASE_URL")