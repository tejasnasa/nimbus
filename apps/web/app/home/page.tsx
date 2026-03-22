import CreateWorkspaceCard from "@nimbus/ui/CreateWorkspaceCard";
import Navbar from "@nimbus/ui/Navbar";
import ToggleGroup from "@nimbus/ui/ToggleGroup";
import WorkspaceCard from "@nimbus/ui/WorkspaceCard";
import pic1 from "../../assets/avatars/picture1.png";
import pic2 from "../../assets/avatars/picture2.png";
import pic3 from "../../assets/avatars/picture3.png";
import pic4 from "../../assets/avatars/picture4.png";
import pic5 from "../../assets/avatars/picture5.png";
import { getAvatarForUser } from "@nimbus/utils";

const avatars = [pic1.src, pic2.src, pic3.src, pic4.src, pic5.src];

const members = [
  { avatarUrl: getAvatarForUser(1, avatars), online: true },
  { avatarUrl: getAvatarForUser(2, avatars), online: false },
  { avatarUrl: getAvatarForUser(3, avatars), online: true },
  { avatarUrl: getAvatarForUser(4, avatars), online: false },
  { avatarUrl: getAvatarForUser(5, avatars), online: true },
];

function getRandomMembers(count: number) {
  const shuffled = members.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

const workspaces = [
  {
    slugId: 1,
    name: "SIH Project",
    description: "Workspace for SIH 2025 project collaboration",
    slug: "sih-project",
    docCount: 12,
    lastUpdated: "2025-06-15T12:34:56Z",
    members: getRandomMembers(4),
  },
  {
    slugId: 2,
    name: "Design Team",
    description:
      "Workspace for the design team to collaborate on UI/UX projects",
    slug: "design-team",
    docCount: 8,
    lastUpdated: "2026-02-15T12:34:56Z",
    members: getRandomMembers(5),
  },
  {
    slugId: 3,
    name: "Dev Squad",
    description:
      "Workspace for the development squad working on the new product launch",
    slug: "dev-squad",
    docCount: 20,
    lastUpdated: "2026-03-19T12:34:56Z",
    members: getRandomMembers(3),
  },
];

export default function Home() {
  return (
    <main className="h-dvh">
      <Navbar />
      <h1 className="mx-28 my-8 text-8xl font-semibold">Workspaces</h1>
      <ToggleGroup options={["All Workspaces", "My Workspaces"]} />

      <section className="mx-28 flex flex-wrap gap-8">
        <CreateWorkspaceCard />

        {workspaces.map((ws) => (
          <WorkspaceCard key={ws.slugId} workspace={ws} />
        ))}
      </section>
    </main>
  );
}
