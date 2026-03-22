import CreateWorkspaceCard from "@nimbus/ui/CreateWorkspaceCard";
import Navbar from "@nimbus/ui/Navbar";
import ToggleGroup from "@nimbus/ui/ToggleGroup";
import WorkspaceCard from "@nimbus/ui/WorkspaceCard";

const avatars = [
  "https://pbs.twimg.com/profile_images/1895293611853651971/zsXl5Bjh_400x400.jpg",
  "https://pbs.twimg.com/profile_images/1897359279327227904/on8BaJfc_400x400.jpg",
  "https://pbs.twimg.com/profile_images/1990733388261593088/YUExHPAQ_400x400.jpg",
  "https://pbs.twimg.com/profile_images/1618372801353621505/VewQx0zE_400x400.jpg",
];

function getRandomMembers(count: number) {
  return Array.from({ length: count }).map(() => ({
    avatarUrl: avatars[Math.floor(Math.random() * avatars.length)],
    online: Math.random() > 0.5,
  }));
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
  {
    slugId: 4,
    name: "Marketing",
    description:
      "Workspace for the marketing team to plan campaigns and strategies",
    slug: "marketing",
    docCount: 5,
    lastUpdated: "2025-02-21T12:34:56Z",
    members: getRandomMembers(6),
  },
  {
    slugId: 5,
    name: "SIH Project",
    description: "Workspace for SIH 2025 project collaboration",
    slug: "sih-project",
    docCount: 12,
    lastUpdated: "2025-06-15T12:34:56Z",
    members: getRandomMembers(4),
  },
  {
    slugId: 6,
    name: "Design Team",
    description:
      "Workspace for the design team to collaborate on UI/UX projects",
    slug: "design-team",
    docCount: 8,
    lastUpdated: "2026-02-15T12:34:56Z",
    members: getRandomMembers(5),
  },
  {
    slugId: 7,
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
          <WorkspaceCard
            key={ws.slugId}
            slugId={ws.slugId}
            name={ws.name}
            description={ws.description}
            lastUpdated={ws.lastUpdated}
            slug={ws.slug}
            docCount={ws.docCount}
            members={ws.members}
          />
        ))}
      </section>
    </main>
  );
}
