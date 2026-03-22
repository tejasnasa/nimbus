function hashUserId(userId: string | number): number {
  const str = String(userId);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getAvatarForUser(
  userId: string | number | undefined,
  avatars: string[],
): string {
  if (!userId) return avatars[0]!;
  return avatars[hashUserId(userId) % avatars.length] ?? avatars[0]!;
}
