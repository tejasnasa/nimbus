/** Chat message DTO returned by REST endpoints and broadcast over sockets.
 *  Extends the DB shape with denormalized author fields (`name`, `image`)
 *  so clients can render messages without extra lookups. */
export interface Message {
    id: string;
    content: string;
    userId: string;
    workspaceId: string;
    createdAt: Date;
    /** Author display name (joined from User). */
    name: string;
    /** Author avatar URL (joined from User). */
    image?: string;
}
