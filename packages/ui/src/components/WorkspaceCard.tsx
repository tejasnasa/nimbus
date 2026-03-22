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
      id={props.slugId.toString()}
      href={`/workspace/${props.slugId}/${props.slug}`}
      className="w-[23%] p-6 bg-(--card) rounded-lg flex flex-col justify-between hover:shadow-lg hover:border-(--primary) hover:-translate-y-0.5 transition-all duration-200"
    >
      <div>
        <div className="flex justify-between mb-1">
          <h2 className="text-3xl">{props.name}</h2>
          <div className="text-sm text-(--muted-foreground) flex items-start m-1.5">
            <Document />
            <div className="ml-1">{props.docCount}</div>
          </div>
        </div>

        <div className="text-sm text-(--muted-foreground) flex items-center mb-6">
          <Clock />
          <span className="ml-2">{timeAgo(props.lastUpdated)}</span>
        </div>
        <AvatarGroup
          users={
            props.members?.map((member) => ({
              image: member.avatarUrl,
              online: member.online,
            })) || []
          }
        />
      </div>

      <div>
        <p className="text-sm text-(--muted-foreground) mt-4">
          {props.description}
        </p>
      </div>
    </Link>
  );
}
