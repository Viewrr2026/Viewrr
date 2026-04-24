import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Bookmark, MessageSquare, User, Send, Settings, LogOut, Star, TrendingUp, Briefcase } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import FreelancerCard from "@/components/FreelancerCard";
import { useAuth } from "@/components/AuthProvider";
import { Link } from "wouter";
import type { ProfileWithUser } from "../../../server/storage";

function NotLoggedIn() {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex flex-col items-center justify-center py-28 px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
          <User size={28} className="text-primary" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Sign in to access your dashboard</h2>
        <p className="text-muted-foreground mb-6 max-w-sm">
          Save creatives, manage messages, and track your projects all in one place.
        </p>
        <Button asChild className="bg-primary hover:bg-primary/90 text-white">
          <Link href="/">Go to home</Link>
        </Button>
      </div>
    </div>
  );
}

function MessageThread({ userId, otherId, otherName, otherAvatar }: { userId: number; otherId: number; otherName: string; otherAvatar?: string }) {
  const [text, setText] = useState("");
  
  const { data: messages = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/messages", userId, otherId],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/messages/${otherId}/${userId}`);
        if (!res.ok) return [];
        return res.json();
      } catch {
        return [];
      }
    },
    refetchInterval: 5000,
  });

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", "/api/messages", { fromId: userId, toId: otherId, content });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages", userId, otherId] });
      setText("");
    },
  });

  return (
    <div className="flex flex-col h-[480px]">
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <Avatar className="w-8 h-8">
          <AvatarImage src={otherAvatar} />
          <AvatarFallback className="bg-primary text-white text-xs">{otherName.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="font-semibold text-sm">{otherName}</span>
      </div>

      <ScrollArea className="flex-1 p-4">
        {isLoading ? (
          <div className="text-center text-muted-foreground text-sm py-4">Loading...</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-8">No messages yet. Say hello!</div>
        ) : (
          <div className="space-y-3">
            {messages.map((m: any) => (
              <div key={m.id} className={`flex ${m.fromId === userId ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-xs px-4 py-2.5 rounded-2xl text-sm leading-relaxed
                  ${m.fromId === userId
                    ? "bg-primary text-white rounded-tr-sm"
                    : "bg-secondary text-foreground rounded-tl-sm"
                  }`}>
                  {m.content}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <form
        onSubmit={e => { e.preventDefault(); if (text.trim()) sendMutation.mutate(text); }}
        className="flex gap-2 p-4 border-t border-border"
      >
        <Input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 rounded-full"
          data-testid="input-chat-message"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!text.trim() || sendMutation.isPending}
          className="rounded-full bg-primary hover:bg-primary/90 text-white flex-shrink-0"
          data-testid="btn-send-chat"
        >
          <Send size={15} />
        </Button>
      </form>
    </div>
  );
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [activeConv, setActiveConv] = useState<{ id: number; name: string; avatar?: string } | null>(null);

  const { data: savedProfiles = [] } = useQuery<ProfileWithUser[]>({
    queryKey: ["/api/saved", user?.id],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/saved/${user!.id}`);
        if (!res.ok) return [];
        return res.json();
      } catch {
        return [];
      }
    },
    enabled: !!user,
  });

  const { data: conversations = [] } = useQuery<any[]>({
    queryKey: ["/api/messages/conversations", user?.id],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/messages/${user!.id}/conversations`);
        if (!res.ok) return [];
        return res.json();
      } catch {
        return [];
      }
    },
    enabled: !!user,
    refetchInterval: 8000,
  });

  if (!user) return <NotLoggedIn />;

  const isFreelancer = user.role === "freelancer";

  return (
    <div className="min-h-screen bg-background">

      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Welcome header */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-center gap-4">
            <Avatar className="w-14 h-14">
              <AvatarImage src={user.avatar || undefined} />
              <AvatarFallback className="bg-primary text-white text-lg">
                {(user.name || '?').slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-2xl font-bold">Welcome back, {(user.name || 'there').split(" ")[0]}</h1>
              <p className="text-muted-foreground text-sm capitalize">{user.role} account • {user.location || "Location not set"}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={logout} className="gap-2 text-muted-foreground">
            <LogOut size={14} /> Sign out
          </Button>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {isFreelancer ? [
            { label: "Profile views", value: "—", icon: TrendingUp },
            { label: "Messages", value: String(conversations.length), icon: MessageSquare },
            { label: "Saved by clients", value: "—", icon: Bookmark },
            { label: "Projects", value: "—", icon: Briefcase },
          ] : [
            { label: "Saved creatives", value: String(savedProfiles.length), icon: Bookmark },
            { label: "Messages", value: String(conversations.length), icon: MessageSquare },
            { label: "Projects posted", value: "0", icon: Briefcase },
            { label: "Avg response time", value: "<1h", icon: Star },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">{label}</span>
                <Icon size={16} className="text-primary" />
              </div>
              <p className="text-2xl font-bold">{value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <Tabs defaultValue={isFreelancer ? "messages" : "saved"}>
          <TabsList>
            {!isFreelancer && <TabsTrigger value="saved" className="gap-2"><Bookmark size={14} /> Saved ({savedProfiles.length})</TabsTrigger>}
            <TabsTrigger value="messages" className="gap-2"><MessageSquare size={14} /> Messages ({conversations.length})</TabsTrigger>
            <TabsTrigger value="profile" className="gap-2"><User size={14} /> Profile</TabsTrigger>
          </TabsList>

          {/* Saved */}
          {!isFreelancer && (
            <TabsContent value="saved" className="mt-6">
              {savedProfiles.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <Bookmark size={32} className="mx-auto mb-4 opacity-40" />
                  <h3 className="font-semibold text-foreground mb-2">No saved creatives yet</h3>
                  <p className="text-sm mb-4">Browse talent and save the ones you love.</p>
                  <Button asChild className="bg-primary hover:bg-primary/90 text-white">
                    <Link href="/marketplace">Browse marketplace</Link>
                  </Button>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                  {savedProfiles.map(pw => (
                    <FreelancerCard key={pw.profile.id} pw={pw} savedInit={true} />
                  ))}
                </div>
              )}
            </TabsContent>
          )}

          {/* Messages */}
          <TabsContent value="messages" className="mt-6">
            {conversations.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <MessageSquare size={32} className="mx-auto mb-4 opacity-40" />
                <h3 className="font-semibold text-foreground mb-2">No conversations yet</h3>
                <p className="text-sm">Find a creative and start a conversation.</p>
              </div>
            ) : (
              <div className="grid md:grid-cols-[280px,1fr] gap-4">
                {/* Conversation list */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  {conversations.map((c: any) => (
                    <button
                      key={c.otherId}
                      onClick={() => setActiveConv({ id: c.otherId, name: c.otherName, avatar: c.otherAvatar })}
                      className={`w-full flex items-center gap-3 p-4 border-b border-border last:border-b-0 text-left transition-colors
                        ${activeConv?.id === c.otherId ? "bg-primary/10" : "hover:bg-secondary/50"}`}
                      data-testid={`conversation-${c.otherId}`}
                    >
                      <Avatar className="w-9 h-9 flex-shrink-0">
                        <AvatarImage src={c.otherAvatar} />
                        <AvatarFallback className="bg-primary text-white text-xs">{c.otherName.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">{c.otherName}</span>
                          {c.unread > 0 && (
                            <Badge className="bg-primary text-white text-xs">{c.unread}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{c.lastMessage}</p>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Thread */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  {activeConv ? (
                    <MessageThread userId={user.id} otherId={activeConv.id} otherName={activeConv.name} otherAvatar={activeConv.avatar} />
                  ) : (
                    <div className="flex items-center justify-center h-full py-20 text-muted-foreground text-sm">
                      Select a conversation to read
                    </div>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Profile */}
          <TabsContent value="profile" className="mt-6">
            <div className="bg-card border border-border rounded-2xl p-6 max-w-lg">
              <h3 className="font-semibold mb-5">Account details</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Name</label>
                  <p className="font-medium mt-0.5">{user.name}</p>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Email</label>
                  <p className="font-medium mt-0.5">{user.email}</p>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Role</label>
                  <p className="font-medium capitalize mt-0.5">{user.role}</p>
                </div>
                {user.bio && (
                  <div>
                    <label className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Bio</label>
                    <p className="text-sm text-muted-foreground mt-0.5">{user.bio}</p>
                  </div>
                )}
              </div>
              <Button variant="outline" className="mt-6 gap-2">
                <Settings size={14} /> Edit profile
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
