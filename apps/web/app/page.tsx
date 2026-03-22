"use client";

import Button from "@nimbus/ui/Button";
import Input from "@nimbus/ui/Input";
import Textarea from "@nimbus/ui/Textarea";
import AvatarGroup from "@nimbus/ui/AvatarGroup";
import AlertDialog from "@nimbus/ui/AlertDialog";

export default function Home() {
  return (
    <main className="h-dvh p-4 bg-(--background)">
      <Input placeholder="Email" />
      <Textarea placeholder="Type your message here." />
      <Button>Submit</Button>
      <AvatarGroup
        max={3}
        users={[
          {
            name: "John Doe",
            image:
              "https://pbs.twimg.com/profile_images/1897359279327227904/on8BaJfc_400x400.jpg",
          },
          {
            name: "Jane Smith",
            image:
              "https://pbs.twimg.com/profile_images/1895293611853651971/zsXl5Bjh_400x400.jpg",
            online: true,
          },
          {
            name: "Alice Johnson",
            image:
              "https://pbs.twimg.com/profile_images/1618372801353621505/VewQx0zE_400x400.jpg",
          },
          {
            name: "Bob Brown",
            image:
              "https://pbs.twimg.com/profile_images/1990733388261593088/YUExHPAQ_400x400.jpg",
          },
        ]}
      />

      <AlertDialog
        trigger={
          <Button className="bg-red-500 hover:bg-red-600">
            Delete Account
          </Button>
        }
        title="Are you absolutely sure?"
        description="This action cannot be undone. This will permanently delete your account and remove all of your data."
        onConfirm={() => console.log("deleted")}
      />
    </main>
  );
}
