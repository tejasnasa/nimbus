import pic1 from "../assets/avatars/picture1.png";
import pic2 from "../assets/avatars/picture2.png";
import pic3 from "../assets/avatars/picture3.png";
import pic4 from "../assets/avatars/picture4.png";
import pic5 from "../assets/avatars/picture5.png";

const avatars = [pic1, pic2, pic3, pic4, pic5];

function hashUserId(userId: string | number): number {
  const str = String(userId);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getAvatarForUser(userId: string | number | undefined): string {
  if (!userId) return avatars[0]!.src;
  return avatars[hashUserId(userId) % avatars.length]!.src ?? avatars[0]!.src;
}
