import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Building2, Users, AlertTriangle, CheckCircle, ArrowLeft } from "lucide-react";

export default function AgencyJoin() {
  const { code } = useParams<{ code: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [confirmed, setConfirmed] = useState(false);
  const [warningShown, setWarningShown] = useState(false);
  const [joined, setJoined] = useState(false);

  // Fetch agency info from invite code
  const { data, isLoading, isError } = useQuery({
    queryKey: ["/api/agencies/join", code],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/agencies/join/${code}`);
      return res.json();
    },
    retry: false,
  });

  const joinMutation = useMutation({
    mutationFn: async () => {
      if (!user || !data?.agency) throw new Error("Not ready");
      const res = await apiRequest("POST", `/api/agencies/${data.agency.id}/join`, { userId: user.id });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to join agency");
      }
      return res.json();
    },
    onSuccess: () => {
      setJoined(true);
      qc.invalidateQueries({ queryKey: ["/api/agencies/membership", user?.id] });
      toast({ title: "Request sent", description: "The agency owner will approve your membership." });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't join", description: e.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground text-sm animate-pulse">Loading invite...</div>
      </div>
    );
  }

  if (isError || !data?.agency) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <AlertTriangle size={28} className="text-destructive" />
          </div>
          <h2 className="font-bold text-lg">Invalid invite link</h2>
          <p className="text-sm text-muted-foreground">This link is no longer valid or has expired. Ask the agency owner for a new link.</p>
          <Button variant="outline" onClick={() => navigate("/")} className="rounded-full">
            <ArrowLeft size={14} className="mr-2" /> Go home
          </Button>
        </div>
      </div>
    );
  }

  const { agency, ownerName } = data;
  const specialisms: string[] = (() => { try { return JSON.parse(agency.specialisms || "[]"); } catch { return []; } })();

  if (joined) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <CheckCircle size={28} className="text-primary" />
          </div>
          <h2 className="font-bold text-lg">Request sent!</h2>
          <p className="text-sm text-muted-foreground">{ownerName} will review your request and approve your membership. You'll be notified once you're approved.</p>
          <Button onClick={() => navigate("/dashboard")} className="rounded-full bg-primary hover:bg-primary/90 text-white">
            Go to dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-16">
      <div className="max-w-sm w-full space-y-6">

        {/* Agency card */}
        <div className="rounded-2xl border border-border bg-card p-6 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            {agency.logo
              ? <img src={agency.logo} alt={agency.name} className="w-full h-full rounded-2xl object-cover" />
              : <Building2 size={28} className="text-primary" />
            }
          </div>
          <div>
            <h1 className="font-bold text-xl">{agency.name}</h1>
            {ownerName && <p className="text-xs text-muted-foreground mt-0.5">Run by {ownerName}</p>}
          </div>
          {agency.bio && <p className="text-sm text-muted-foreground leading-relaxed">{agency.bio}</p>}
          {specialisms.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-center">
              {specialisms.map((s: string) => (
                <span key={s} className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">{s}</span>
              ))}
            </div>
          )}
          {agency.location && (
            <p className="text-xs text-muted-foreground">{agency.location}</p>
          )}
        </div>

        {/* Not logged in */}
        {!user && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">You need a Viewrr freelancer account to join this agency.</p>
            <Button onClick={() => navigate("/")} className="w-full rounded-full bg-primary hover:bg-primary/90 text-white">
              Sign up or sign in
            </Button>
          </div>
        )}

        {/* Logged in but not a freelancer */}
        {user && user.role !== "freelancer" && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">Only freelancer accounts can join agencies.</p>
          </div>
        )}

        {/* Freelancer — show warning + confirm */}
        {user && user.role === "freelancer" && (
          <div className="space-y-4">
            {!warningShown ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">Before you join</p>
                    <p className="text-xs text-amber-700 dark:text-amber-500 mt-1 leading-relaxed">
                      Joining <strong>{agency.name}</strong> will tie your Viewrr profile to this agency. You will not be able to join a different agency unless the owner removes you. Your profile remains your own.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 rounded-full text-xs"
                    onClick={() => navigate("/")}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 rounded-full text-xs bg-primary hover:bg-primary/90 text-white"
                    onClick={() => setWarningShown(true)}
                  >
                    I understand — continue
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-center text-muted-foreground">
                  Ready to join <strong>{agency.name}</strong>?
                </p>
                <Button
                  className="w-full rounded-full bg-primary hover:bg-primary/90 text-white"
                  disabled={joinMutation.isPending}
                  onClick={() => joinMutation.mutate()}
                >
                  {joinMutation.isPending ? "Sending request…" : `Join ${agency.name}`}
                </Button>
                <button
                  className="w-full text-xs text-muted-foreground hover:text-foreground text-center py-1 transition-colors"
                  onClick={() => navigate("/")}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
