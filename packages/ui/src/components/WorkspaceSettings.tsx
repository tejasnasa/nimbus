import SettingTabs from "./SettingTabs";

export default function WorkspaceSettings() {
  return (
    <div className=" relative z-50 w-200 h-150 rounded-xl border border-(--border) bg-(--card) shadow-lg animate-in fade-in zoom-in-95 p-5">
      <h1 className="text-5xl m-2 mb-8">Settings</h1>
      <SettingTabs
        tabs={[
          {
            label: "General",
            content: "hello",
          },
          {
            label: "Members",
            content: "List of Members",
          },
          {
            label: "Documents",
            content: "List of Documents"
          },
          {
            label: "Permissions",
            content: "Delete"
          }
        ]}
      />
    </div>
  );
}
