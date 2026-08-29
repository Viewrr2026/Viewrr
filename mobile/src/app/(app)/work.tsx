import { PlaceholderPanel } from "@/components/PlaceholderPanel";
import { Screen } from "@/components/Screen";

export default function Work() {
  return (
    <Screen edges={["top", "left", "right"]}>
      <PlaceholderPanel
        title="Your work"
        body="Projects, stages and approvals appear here once native auth is approved."
      />
    </Screen>
  );
}
