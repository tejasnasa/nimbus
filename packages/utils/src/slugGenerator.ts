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
