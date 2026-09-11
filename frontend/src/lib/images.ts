// Mirrors the backend whitelist (RecipeImageStore).
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp'
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024

/** Original URLs stay available to the detail/gallery views and API consumers. */
export function recipeCardImage(url: string): string {
  return url.startsWith('/api/images/') ? `${url}/card-v1.webp` : url
}
