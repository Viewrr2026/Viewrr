// ── Static mock data for demo accounts (no backend needed) ───────────────────
// Demo user IDs: 1 = Alex Taylor (client), 2 = Marcus Reid (freelancer), 3 = Sophia Chen (freelancer)

export const DEMO_USER_IDS = new Set([1, 2, 3]);

// ── Mock projects ─────────────────────────────────────────────────────────────
export const MOCK_PROJECTS = [
  {
    project: {
      id: 101,
      title: "Brand Campaign — Summer 2026",
      description: "A series of short-form brand films for Taylor & Co.'s summer product launch. Three hero spots + social cutdowns.",
      clientId: 1,
      freelancerId: 2,
      status: "active",
      currentStage: 2,
      createdAt: "2026-04-01T10:00:00.000Z",
    },
    client: {
      id: 1,
      name: "Alex Taylor",
      email: "alex@business.co",
      role: "client",
      avatar: "https://i.pravatar.cc/150?img=32",
      location: "London, UK",
      bio: "Marketing Director at Taylor & Co.",
      createdAt: "2026-01-01",
    },
    freelancer: {
      id: 2,
      name: "Marcus Reid",
      email: "marcus@viewrr.co",
      role: "freelancer",
      avatar: "https://i.pravatar.cc/150?img=11",
      location: "London, UK",
      bio: "Award-winning cinematographer with 8 years shooting brand films.",
      createdAt: "2026-01-01",
    },
    updates: [
      {
        update: { id: 1001, projectId: 101, stage: 0, note: "Brief received and approved. Shoot dates confirmed for 22–24 April.", createdAt: "2026-04-02T09:00:00.000Z" },
        author: { id: 2, name: "Marcus Reid", avatar: "https://i.pravatar.cc/150?img=11" },
      },
      {
        update: { id: 1002, projectId: 101, stage: 1, note: "Storyboards shared via Google Drive. Awaiting final feedback before we lock.", createdAt: "2026-04-08T14:30:00.000Z" },
        author: { id: 2, name: "Marcus Reid", avatar: "https://i.pravatar.cc/150?img=11" },
      },
      {
        update: { id: 1003, projectId: 101, stage: 1, note: "Storyboards look brilliant — just one tweak on the opening shot. Will send notes by EOD.", createdAt: "2026-04-09T10:00:00.000Z" },
        author: { id: 1, name: "Alex Taylor", avatar: "https://i.pravatar.cc/150?img=32" },
      },
      {
        update: { id: 1004, projectId: 101, stage: 2, note: "Shoot day 1 complete. Got some incredible golden-hour footage. Day 2 tomorrow.", createdAt: "2026-04-15T19:45:00.000Z" },
        author: { id: 2, name: "Marcus Reid", avatar: "https://i.pravatar.cc/150?img=11" },
      },
    ],
  },
  {
    project: {
      id: 102,
      title: "Company Highlight Reel — Q1",
      description: "Post-production and colour grade on 45 minutes of corporate footage from the Q1 team offsite.",
      clientId: 1,
      freelancerId: 3,
      status: "active",
      currentStage: 3,
      createdAt: "2026-03-15T10:00:00.000Z",
    },
    client: {
      id: 1,
      name: "Alex Taylor",
      email: "alex@business.co",
      role: "client",
      avatar: "https://i.pravatar.cc/150?img=32",
      location: "London, UK",
      bio: "Marketing Director at Taylor & Co.",
      createdAt: "2026-01-01",
    },
    freelancer: {
      id: 3,
      name: "Sophia Chen",
      email: "sophia@viewrr.co",
      role: "freelancer",
      avatar: "https://i.pravatar.cc/150?img=47",
      location: "Manchester, UK",
      bio: "Post-production specialist and colour grader. Netflix, BBC, global ad agencies.",
      createdAt: "2026-01-01",
    },
    updates: [
      {
        update: { id: 2001, projectId: 102, stage: 0, note: "All rushes received via WeTransfer. Starting the assembly cut now.", createdAt: "2026-03-16T11:00:00.000Z" },
        author: { id: 3, name: "Sophia Chen", avatar: "https://i.pravatar.cc/150?img=47" },
      },
      {
        update: { id: 2002, projectId: 102, stage: 1, note: "Assembly cut done — 4 min 30 sec. Tight, punchy, and on-brand. Sending the Vimeo link now.", createdAt: "2026-03-22T16:00:00.000Z" },
        author: { id: 3, name: "Sophia Chen", avatar: "https://i.pravatar.cc/150?img=47" },
      },
      {
        update: { id: 2003, projectId: 102, stage: 2, note: "Loved the cut! A few timing tweaks on the CEO section and one colour note — will detail in the shared doc.", createdAt: "2026-03-24T09:30:00.000Z" },
        author: { id: 1, name: "Alex Taylor", avatar: "https://i.pravatar.cc/150?img=32" },
      },
      {
        update: { id: 2004, projectId: 102, stage: 3, note: "Revisions applied. Colour grade locked. First delivery uploaded — please review at full resolution.", createdAt: "2026-04-10T17:00:00.000Z" },
        author: { id: 3, name: "Sophia Chen", avatar: "https://i.pravatar.cc/150?img=47" },
      },
    ],
  },
  {
    project: {
      id: 103,
      title: "Product Launch — Social Content Pack",
      description: "Photography and short-form video for a new product line. 20 stills + 5 reels optimised for Instagram and TikTok.",
      clientId: 1,
      freelancerId: 2,
      status: "completed",
      currentStage: 5,
      createdAt: "2026-02-01T10:00:00.000Z",
    },
    client: {
      id: 1,
      name: "Alex Taylor",
      email: "alex@business.co",
      role: "client",
      avatar: "https://i.pravatar.cc/150?img=32",
      location: "London, UK",
      bio: "Marketing Director at Taylor & Co.",
      createdAt: "2026-01-01",
    },
    freelancer: {
      id: 2,
      name: "Marcus Reid",
      email: "marcus@viewrr.co",
      role: "freelancer",
      avatar: "https://i.pravatar.cc/150?img=11",
      location: "London, UK",
      bio: "Award-winning cinematographer with 8 years shooting brand films.",
      createdAt: "2026-01-01",
    },
    updates: [
      {
        update: { id: 3001, projectId: 103, stage: 5, note: "All finals delivered — 20 retouched stills and 5 reels in a shared Dropbox folder. Great project!", createdAt: "2026-03-10T15:00:00.000Z" },
        author: { id: 2, name: "Marcus Reid", avatar: "https://i.pravatar.cc/150?img=11" },
      },
      {
        update: { id: 3002, projectId: 103, stage: 5, note: "Everything looks amazing — the team absolutely loved it. Looking forward to the next one!", createdAt: "2026-03-11T09:00:00.000Z" },
        author: { id: 1, name: "Alex Taylor", avatar: "https://i.pravatar.cc/150?img=32" },
      },
    ],
  },
];

// ── Mock feed posts ───────────────────────────────────────────────────────────
export const MOCK_POSTS = [
  {
    post: {
      id: 201,
      userId: 2,
      caption: "Golden hour on location for a brand campaign. These are the moments that make it all worth it. 🎬",
      mediaUrl: "https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=800&q=80",
      mediaType: "image",
      tags: JSON.stringify(["BrandFilm", "GoldenHour", "Videography"]),
      likeCount: 47,
      commentCount: 6,
      createdAt: "2026-04-15T20:00:00.000Z",
    },
    user: {
      id: 2,
      name: "Marcus Reid",
      email: "marcus@viewrr.co",
      role: "freelancer",
      avatar: "https://i.pravatar.cc/150?img=11",
      location: "London, UK",
      bio: "Award-winning cinematographer.",
      createdAt: "2026-01-01",
    },
    liked: false,
  },
  {
    post: {
      id: 202,
      userId: 3,
      caption: "Finished a big colour grade project today — 45 minutes of corporate footage transformed into something really cinematic. The Rec.709 to S-Log3 roundtrip workflow is a game changer.",
      mediaUrl: "https://images.unsplash.com/photo-1536240478700-b869ad10e128?w=800&q=80",
      mediaType: "image",
      tags: JSON.stringify(["ColourGrade", "PostProduction", "DaVinciResolve"]),
      likeCount: 31,
      commentCount: 4,
      createdAt: "2026-04-14T16:30:00.000Z",
    },
    user: {
      id: 3,
      name: "Sophia Chen",
      email: "sophia@viewrr.co",
      role: "freelancer",
      avatar: "https://i.pravatar.cc/150?img=47",
      location: "Manchester, UK",
      bio: "Post-production specialist and colour grader.",
      createdAt: "2026-01-01",
    },
    liked: false,
  },
  {
    post: {
      id: 203,
      userId: 2,
      caption: "Drone reel from last week's coastal shoot. The light was unreal — we had about 20 minutes before the fog rolled in. Every second counted.",
      mediaUrl: "https://images.unsplash.com/photo-1473968512647-3e447244af8f?w=800&q=80",
      mediaType: "image",
      tags: JSON.stringify(["Drone", "Aerial", "Documentary"]),
      likeCount: 89,
      commentCount: 12,
      createdAt: "2026-04-12T11:00:00.000Z",
    },
    user: {
      id: 2,
      name: "Marcus Reid",
      email: "marcus@viewrr.co",
      role: "freelancer",
      avatar: "https://i.pravatar.cc/150?img=11",
      location: "London, UK",
      bio: "Award-winning cinematographer.",
      createdAt: "2026-01-01",
    },
    liked: false,
  },
  {
    post: {
      id: 204,
      userId: 3,
      caption: "Just wrapped on the Q1 highlight reel for a lovely client. Simple brief, but the footage was beautiful — just needed the edit to get out of its own way.",
      mediaUrl: "https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?w=800&q=80",
      mediaType: "image",
      tags: JSON.stringify(["Editing", "CorporateFilm", "PostProduction"]),
      likeCount: 24,
      commentCount: 3,
      createdAt: "2026-04-11T14:00:00.000Z",
    },
    user: {
      id: 3,
      name: "Sophia Chen",
      email: "sophia@viewrr.co",
      role: "freelancer",
      avatar: "https://i.pravatar.cc/150?img=47",
      location: "Manchester, UK",
      bio: "Post-production specialist and colour grader.",
      createdAt: "2026-01-01",
    },
    liked: false,
  },
  {
    post: {
      id: 205,
      userId: 2,
      caption: "Behind the lens on a fashion shoot in East London. New Sigma 85mm Art glass — the bokeh is absolutely stunning. If you're a brand looking for a summer campaign photographer, my diary is open.",
      mediaUrl: "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=800&q=80",
      mediaType: "image",
      tags: JSON.stringify(["FashionPhotography", "London", "BehindTheLens"]),
      likeCount: 63,
      commentCount: 9,
      createdAt: "2026-04-09T09:15:00.000Z",
    },
    user: {
      id: 2,
      name: "Marcus Reid",
      email: "marcus@viewrr.co",
      role: "freelancer",
      avatar: "https://i.pravatar.cc/150?img=11",
      location: "London, UK",
      bio: "Award-winning cinematographer.",
      createdAt: "2026-01-01",
    },
    liked: false,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns mock projects for a given user ID */
export function getMockProjects(userId: number) {
  return MOCK_PROJECTS.filter(
    p => p.project.clientId === userId || p.project.freelancerId === userId
  );
}

/** Returns mock feed posts (all posts, same for everyone) */
export function getMockPosts(viewerUserId?: number) {
  return MOCK_POSTS;
}
