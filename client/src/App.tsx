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
import NotFound from "@/pages/not-found";
import Terms from "@/pages/Terms";
import Privacy from "@/pages/Privacy";
import Briefs from "@/pages/Briefs";
import PostBrief from "@/pages/PostBrief";
import Workspace from "@/pages/Workspace";
import AdminPanel from "@/pages/AdminPanel";
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
              <Route path="/terms" component={Terms} />
              <Route path="/privacy" component={Privacy} />
              <Route path="/briefs" component={Briefs} />
              <Route path="/briefs/new" component={PostBrief} />
              <Route path="/workspace" component={Workspace} />
              <Route path="/admin" component={AdminPanel} />
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
