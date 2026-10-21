// Thin fetch wrapper over the Pichci REST API. The MCP server is a proxy: the
// backend stays the source of truth and re-exports ./context after every write.
const BASE = (process.env.MISE_API_URL ?? 'http://localhost:5080').replace(/\/+$/, '')
const API_KEY = process.env.MISE_API_KEY
// Whose diary, goal and weight the tools touch (person id from DIARY_PEOPLE order);
// unset = person 1. Sous sets it per signed-in person.
const PERSON = process.env.MISE_PERSON?.trim()

export async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  // FormData goes through as-is (fetch sets the multipart boundary header itself).
  const isForm = body instanceof FormData
  const headers: Record<string, string> = {
    ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    ...(API_KEY ? { 'X-Api-Key': API_KEY } : {}),
    ...(PERSON ? { 'X-Person': PERSON } : {}),
  }
  let res: Response
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    })
  } catch (e) {
    throw new Error(
      `Nie mogę połączyć się z Pichci pod ${BASE} — czy aplikacja działa (docker compose up)? (${(e as Error).message})`,
    )
  }
  const text = await res.text()
  if (res.status === 401) {
    throw new Error(
      `Pichci API 401: zapisy wymagają klucza API — ustaw zmienną środowiskową MISE_API_KEY (tę samą co w .env aplikacji). ${text}`,
    )
  }
  if (!res.ok) throw new Error(`Pichci API ${res.status} ${res.statusText}: ${text}`)
  return (text ? JSON.parse(text) : undefined) as T
}

export const get = <T>(path: string) => call<T>('GET', path)
export const post = <T>(path: string, body?: unknown) => call<T>('POST', path, body)
export const put = <T>(path: string, body?: unknown) => call<T>('PUT', path, body)
export const patch = <T>(path: string, body?: unknown) => call<T>('PATCH', path, body)
export const del = <T>(path: string) => call<T>('DELETE', path)
