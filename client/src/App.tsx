import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/components/AuthProvider";
import Navbar from "@/components/Navbar";
import Landing from "@/pages/Landing";
import Marketplace from "@/pages/Marketplace";
import ProfilePage from "@/pages/ProfilePage";
import AISearch from "@/pages/AISearch";
import Dashboard from "@/pages/Dashboard";
import Feed from "@/pages/Feed";
import ProViewr from "@/pages/ProViewr";
import YourWork from "@/pages/YourWork";
import PayoutsEarnings from "@/pages/PayoutsEarnings";
import NotFound from "@/pages/not-found";
import Terms from "@/pages/Terms";
import Privacy from "@/pages/Privacy";
import CommunityGuidelines from "@/pages/CommunityGuidelines";
import Briefs from "@/pages/Briefs";
import PostBrief from "@/pages/PostBrief";
import Workspace from "@/pages/Workspace";
import AdminPanel from "@/pages/AdminPanel";
import FounderDashboard from "@/pages/admin/FounderDashboard";
import FounderMarketplace from "@/pages/admin/FounderMarketplace";
import FounderProjects from "@/pages/admin/FounderProjects";
import FounderCommunity from "@/pages/admin/FounderCommunity";
import FounderInsights from "@/pages/admin/FounderInsights";
import FounderSupport from "@/pages/admin/FounderSupport";
import FounderSettings from "@/pages/admin/FounderSettings";
import FounderAccreditation from "@/pages/admin/FounderAccreditation";
import FounderFinance from "@/pages/admin/FounderFinance";
import FounderProSubscriptions from "@/pages/admin/FounderProSubscriptions";
import FounderCreatives from "@/pages/admin/FounderCreatives";
import FounderClients from "@/pages/admin/FounderClients";
import AgencyJoin from "@/pages/AgencyJoin";
import AgencyProfile from "@/pages/AgencyProfile";
import AgencyHQ from "@/pages/AgencyHQ";
import Invoice from "@/pages/Invoice";
import NotificationPreferences from "@/pages/NotificationPreferences";
import HelpCentre from "@/pages/HelpCentre";
import ResetPassword from "@/pages/ResetPassword";
import RetainerBuilder from "@/pages/RetainerBuilder";
import RetainerWorkspace from "@/pages/RetainerWorkspace";
import CookieBanner from "@/components/CookieBanner";
import GetNoticedBanner from "@/components/GetNoticedBanner";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <Router hook={useHashLocation}>
            {/* Navbar rendered once here — present on every page */}
            <Navbar />
            <GetNoticedBanner />
            <Switch>
              <Route path="/" component={Landing} />
              <Route path="/marketplace" component={Marketplace} />
              <Route path="/profile/:id" component={ProfilePage} />
              <Route path="/ai-search" component={AISearch} />
              <Route path="/dashboard" component={Dashboard} />
              <Route path="/feed" component={Feed} />
              <Route path="/pro" component={ProViewr} />
              <Route path="/your-work" component={YourWork} />
              <Route path="/payouts" component={PayoutsEarnings} />
              <Route path="/terms" component={Terms} />
              <Route path="/privacy" component={Privacy} />
              <Route path="/community-guidelines" component={CommunityGuidelines} />
              <Route path="/briefs" component={Briefs} />
              <Route path="/briefs/new" component={PostBrief} />
              <Route path="/workspace" component={Workspace} />
              <Route path="/admin" component={AdminPanel} />
              <Route path="/founder" component={FounderDashboard} />
              <Route path="/founder/marketplace" component={FounderMarketplace} />
              <Route path="/founder/projects" component={FounderProjects} />
              <Route path="/founder/community" component={FounderCommunity} />
              <Route path="/founder/insights" component={FounderInsights} />
              <Route path="/founder/support" component={FounderSupport} />
              <Route path="/founder/settings" component={FounderSettings} />
              <Route path="/founder/accreditation" component={FounderAccreditation} />
              <Route path="/founder/finance" component={FounderFinance} />
              <Route path="/founder/pro" component={FounderProSubscriptions} />
              <Route path="/founder/users/creatives" component={FounderCreatives} />
              <Route path="/founder/users/clients" component={FounderClients} />
              <Route path="/join/:code" component={AgencyJoin} />
              <Route path="/agency/:slug" component={AgencyProfile} />
              <Route path="/agency-hq" component={AgencyHQ} />
              <Route path="/invoice/:projectId" component={Invoice} />
              <Route path="/settings/notifications" component={NotificationPreferences} />
              <Route path="/reset-password" component={ResetPassword} />
              <Route path="/help" component={HelpCentre} />
              <Route path="/help/:category" component={HelpCentre} />
              <Route path="/retainer/new" component={RetainerBuilder} />
              <Route path="/retainer/new/:templateId" component={RetainerBuilder} />
              <Route path="/retainer/:publicId" component={RetainerWorkspace} />
              <Route component={NotFound} />
            </Switch>
          </Router>
          <CookieBanner />
          <Toaster />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
