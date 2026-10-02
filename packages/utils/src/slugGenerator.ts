/**
 * Converts a workspace name into a URL-safe slug.
 *
 * Lowercases, strips accents and apostrophes, replaces non-alphanumeric runs
 * with hyphens, caps the result at 30 characters, then trims any hyphens the
 * cap left at either end.
 * The slug is combined with an auto-increment `slugId` in the DB to form the
 * unique `/workspace/[id]` route param.
 *
 * @param name - Raw workspace display name.
 * @returns URL-safe slug, e.g. `"Ada's Dev Lounge!"` → `"adas-dev-lounge"`.
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
      .slice(0, 30)
      // the cap can land on a separator, so trim after slicing, never before
      .replace(/^-+|-+$/g, "")
  );
};
