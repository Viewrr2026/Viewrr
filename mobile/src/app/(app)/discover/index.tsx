import { Compass } from "lucide-react-native";

import { AppHeader } from "@/components/AppHeader";
import { ComingNext } from "@/components/ComingNext";
import { Screen } from "@/components/Screen";

/**
 * Discover (client slot 2). The marketplace search surface lands in the next
 * phase; the route exists now so the tab, deep links and notification targets
 * are all real from the first build.
 */
export default function DiscoverIndex() {
  return (
    <Screen edges={["top", "left", "right"]}>
      <AppHeader title="Discover" brand />
      <ComingNext
        icon={Compass}
        title="Find creatives"
        body="Search verified creatives by specialism, location and availability, then invite them straight to a brief."
        meanwhile="Browsing and hiring is available on viewrr.co.uk while this lands in the app."
      />
    </Screen>
  );
}
