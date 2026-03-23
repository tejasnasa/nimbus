import Button from "@nimbus/ui/Button";
import Input from "@nimbus/ui/Input";
import Textarea from "@nimbus/ui/Textarea";
import Cloud from "@nimbus/ui/icons/Cloud";
import AlertDialog from "@nimbus/ui/AlertDialog";

export default function Home() {
  return (
    <main className="h-dvh p-4 bg-(--background)">
      <Cloud />

      <Input placeholder="Email" />
      <Textarea placeholder="Type your message here." />
      <Button loading={true}>Submit</Button>
      <AlertDialog
        trigger={<Button>Create Workspace Wrapper</Button>}
      >
        {({ close }) => (
          <div
            className="
                        relative z-50 w-full max-w-120 rounded-xl border border-(--border) bg-(--card) p-3 shadow-lg animate-in fade-in zoom-in-95
                      "
          >
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold text-(--foreground) m-4">
                Create Workspace
              </h2>
            </div>
            <form action="">
              <div className="flex flex-col text-left m-4">
                <label htmlFor="title" className="m-1 text-sm">
                  Title
                </label>
                <Input
                  placeholder="Tejas's Workspace"
                  id="title"
                  className="w-full"
                ></Input>
              </div>
              <div className="flex flex-col text-left m-4">
                <label htmlFor="description" className="m-1 text-sm">
                  Description
                </label>
                <Textarea
                  placeholder="Describe your workspace..."
                  id="description"
                  className="w-full"
                ></Textarea>
              </div>

              <div className="m-4 flex justify-end gap-2">
                <Button
                  onClick={close}
                  type="button"
                  className="bg-transparent hover:bg-white/10 border border-(--border) hover:border-white/10 hover:cursor-pointer"
                  size="sm"
                >
                  Cancel
                </Button>

                <Button
                  onClick={close}
                  type="button"
                  size="sm"
                  className="hover:cursor-pointer"
                >
                  Continue
                </Button>
              </div>
            </form>
          </div>
        )}
      </AlertDialog>
    </main>
  );
}
