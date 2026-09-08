/**
 * Converts a workspace name into a URL-safe slug.
 *
 * Lowercases, strips accents and apostrophes, replaces non-alphanumeric runs
 * with hyphens, trims edge hyphens, and caps the result at 30 characters.
 * The slug is combined with an auto-increment `slugId` in the DB to form the
 * unique `/workspace/[id]` route param.
 *
 * @param name - Raw workspace display name.
 * @returns URL-safe slug, e.g. `"Ada's Dev Lounge!"` → `"ada-s-dev-lounge"`.
 */
export const generateSlug = (name: string): string => {
  return (
    name
      .toLowerCase()
      .trim()
      // remove accents
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      // remove apostrophes completely
      .replace(/['’]/g, "")
      // replace non-alphanumeric with hyphen
      .replace(/[^a-z0-9]+/g, "-")
      // collapse multiple hyphens
      .replace(/-+/g, "-")
      // trim hyphens from ends
      .replace(/^-|-$/g, "")
      .slice(0, 30)
  );
};
