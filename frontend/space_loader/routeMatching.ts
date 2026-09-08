export function normalizeRoutePattern(pattern: string): string {
  return pattern
    .split('/')
    .filter(Boolean)
    .map(segment => {
      const bracketParam = segment.match(/^\[([^/\]]+)\]$/)
      return bracketParam ? `:${bracketParam[1]}` : segment
    })
    .join('/')
}

export function matchRoutePattern(urlPath: string, pattern: string): Record<string, string> | null {
  const urlParts = urlPath.split('/').filter(Boolean)
  const patternParts = normalizeRoutePattern(pattern).split('/').filter(Boolean)
  if (urlParts.length !== patternParts.length) return null

  const params: Record<string, string> = {}
  for (let i = 0; i < patternParts.length; i++) {
    const routePart = patternParts[i]!
    const urlPart = urlParts[i]!
    if (routePart.startsWith(':')) {
      params[routePart.slice(1)] = decodeURIComponent(urlPart)
    } else if (routePart !== urlPart) {
      return null
    }
  }

  return params
}
