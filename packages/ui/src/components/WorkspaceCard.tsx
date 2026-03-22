import Link from "next/link";
import AvatarGroup from "./AvatarGroup";
import { timeAgo } from "@nimbus/utils";
import Clock from "./icons/Clock";
import Document from "./icons/Document";

interface WorkspaceCardProps {
  slugId: number;
  name: string;
  description?: string;
  slug: string;
  docCount: number;
  lastUpdated?: string;
  members: {
    avatarUrl: string;
    online?: boolean;
  }[];
}

export default function WorkspaceCard(props: WorkspaceCardProps) {
  return (
    <Link
      href={`/workspace/${props.slugId}/${props.slug}`}
      className="w-[22%] p-6 bg-(--card) rounded-lg flex flex-col justify-between hover:shadow-lg hover:border-(--primary) hover:-translate-y-0.5 transition-all duration-200"
    >
      <div>
        <h2 className="text-3xl mb-2">{props.name}</h2>
        <p className="text-sm text-(--muted-foreground) mb-8">
          {props.description}
        </p>
      </div>

      <div>
        <AvatarGroup
          users={
            props.members?.map((member) => ({
              image: member.avatarUrl,
              online: member.online,
            })) || []
          }
        />
        <div className="text-sm text-(--muted-foreground) mt-8 flex items-center">
          <Document />
          <div className="ml-2">
            {props.docCount} {props.docCount === 1 ? "document" : "documents"}
          </div>
        </div>
        <div className="text-sm text-(--muted-foreground) flex items-center mt-2">
          <Clock />
          <span className="ml-2">{timeAgo(props.lastUpdated)}</span>
        </div>
      </div>
    </Link>
  );
}
