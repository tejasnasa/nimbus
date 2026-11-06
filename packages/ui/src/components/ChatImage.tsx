/**
 * @module ui/components/ChatImage
 * @description Thumbnail of an image attached to a chat message. Renders a
 * size-limited Cloudinary derivative and links to the full-size original, which
 * opens in a new tab.
 *
 * @important Only the thumbnail URL is rewritten, and only when it has
 *            Cloudinary's `/upload/` segment; any other URL is shown as given.
 *            The link always points at the untouched original.
 */

/** Cloudinary transformation for the in-chat thumbnail. */
const THUMBNAIL_TRANSFORMATION = "c_limit,w_480,h_320,q_auto,f_auto";

/**
 * Derives the thumbnail URL for a Cloudinary delivery URL.
 *
 * @param url - The message's `imageUrl`.
 * @returns The URL with a downscaling transformation inserted, or `url`
 *          unchanged when it has no `/upload/` segment.
 */
export function chatImageThumbnailUrl(url: string): string {
  return url.replace("/upload/", `/upload/${THUMBNAIL_TRANSFORMATION}/`);
}

/**
 * Message image thumbnail that opens full size.
 *
 * @param props.url - Full-size image URL.
 * @param props.alignEnd - Right-aligns the thumbnail (own messages).
 */
export default function ChatImage({
  url,
  alignEnd = false,
}: {
  url: string;
  alignEnd?: boolean;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="chat-image-link"
      className={`block mb-1 w-fit max-w-[85%] overflow-hidden rounded-xl border border-(--border) ${alignEnd ? "ml-auto" : ""}`}
    >
      <img
        src={chatImageThumbnailUrl(url)}
        alt="Attached image"
        loading="lazy"
        className="block max-h-48 w-auto object-cover"
      />
    </a>
  );
}
