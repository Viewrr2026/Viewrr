const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const Module = require("node:module");
const { randomUUID } = require("node:crypto");
const ts = require("typescript");
const React = require("react");
const { create, act } = require("react-test-renderer");
global.IS_REACT_ACT_ENVIRONMENT = true;

// Real screens, hooks, validation and API adapters. Replace native services and
// HTTP at their boundaries so these tests never contact real Viewrr accounts.
function harness(
  handler,
  initialUser = { id: 8, name: "Apple Test", role: "client" },
) {
  let user = initialUser;
  let params = {};
  const calls = [];
  const navigation = [];
  const cache = new Map();
  const router = Object.fromEntries(
    ["push", "replace", "dismissTo", "back", "setParams"].map((method) => [
      method,
      (value) => {
        navigation.push({ method, value });
        if (method === "setParams") params = { ...params, ...value };
      },
    ]),
  );
  const request = (method) => async (path, payload) => {
    calls.push({ method, path, payload });
    return handler(method, path, payload);
  };
  const api = Object.fromEntries(
    ["get", "post", "patch", "delete"].map((method) => [
      method,
      request(method),
    ]),
  );
  const host = (name) => (props) =>
    React.createElement(name, props, props.children);
  const rn = {
    ...Object.fromEntries(
      [
        "View",
        "Text",
        "Pressable",
        "Switch",
        "KeyboardAvoidingView",
        "ScrollView",
        "ActivityIndicator",
        "RefreshControl",
      ].map((name) => [name, name]),
    ),
    Platform: { OS: "web" },
    StyleSheet: { create: (value) => value, hairlineWidth: 1 },
    AppState: {
      currentState: "background",
      addEventListener: () => ({ remove() {} }),
    },
    Alert: { alert() {} },
    Linking: { openURL: () => assert.fail("Unexpected website handoff") },
    FlatList: (props) =>
      React.createElement(
        "FlatList",
        props,
        props.ListHeaderComponent,
        props.data.length
          ? props.data.map((item, index) =>
              React.createElement(
                React.Fragment,
                { key: props.keyExtractor(item) },
                props.renderItem({ item, index }),
              ),
            )
          : props.ListEmptyComponent,
        props.ListFooterComponent,
      ),
  };
  const mocks = {
    "react-native": rn,
    "react-native-safe-area-context": {
      useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
    },
    "expo-modules-core": { uuid: { v4: randomUUID } },
    "expo-router": {
      useRouter: () => router,
      useLocalSearchParams: () => params,
      useFocusEffect: (callback) => React.useEffect(callback, [callback]),
    },
    "lucide-react-native": new Proxy({}, { get: (_, name) => String(name) }),
    "@/api/client": { api },
    "@/api/trust": { blockUser: () => assert.fail("Unexpected block") },
    "@/config/env": { PUBLIC_SITE_URL: "https://viewrr.test" },
    "@/session/SessionProvider": { useSession: () => ({ user }) },
    "@/components/messages/useDmUnread": { refreshDmUnread: async () => {} },
    "@/theme": {
      useTheme: () => ({ colors: {}, shadows: {} }),
      typography: {},
      radii: {},
      spacing: {},
      hitSlop: {},
      gutter: 20,
    },
    "@/components/DataState": {
      DataState: ({ resource, children }) =>
        resource.phase === "ready"
          ? children(resource.data)
          : React.createElement(
              resource.phase === "error" ? "ErrorState" : "Loading",
              { resource },
            ),
    },
  };
  for (const name of [
    "AppHeader",
    "Avatar",
    "Button",
    "EmptyState",
    "ListRow",
    "Screen",
    "StatusBadge",
    "TextField",
    "ActionSheet",
    "ReportDialog",
  ]) {
    mocks["@/components/" + name] = { [name]: host(name) };
  }
  mocks["@/components/Card"] = Object.fromEntries(
    ["Card", "CardTitle", "CardLabel", "CardBody"].map((name) => [
      name,
      host(name),
    ]),
  );
  for (const name of ["MessageComposer", "MessageBubble"])
    mocks["@/components/messages/" + name] = { [name]: host(name) };
  mocks["@/components/work/ProjectCard"] = { ProjectCard: host("ProjectCard") };
  function load(path) {
    let filename = resolve(__dirname, "..", path);
    if (!existsSync(filename))
      filename += existsSync(filename + ".tsx") ? ".tsx" : ".ts";
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = new Module(filename, module);
    mod.filename = filename;
    mod.paths = Module._nodeModulePaths(dirname(filename));
    cache.set(filename, mod);
    mod.require = (id) =>
      Object.hasOwn(mocks, id)
        ? mocks[id]
        : id.startsWith("@/")
          ? load("src/" + id.slice(2))
          : Module.prototype.require.call(mod, id);
    mod._compile(
      ts.transpileModule(readFileSync(filename, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }).outputText,
      filename,
    );
    return mod.exports;
  }
  return {
    load,
    calls,
    navigation,
    setParams: (value) => {
      params = value;
    },
    setUser: (value) => {
      user = value;
    },
  };
}
async function mount(t, h, path, props) {
  let tree;
  const Screen = h.load(path).default;
  await act(async () => {
    tree = create(React.createElement(Screen, props));
  });
  t.after(async () => {
    await act(async () => tree.unmount());
  });
  return {
    tree,
    update: async () => {
      await act(async () => tree.update(React.createElement(Screen, props)));
    },
  };
}
async function press(tree, label, type = "Button", key = "label") {
  const found = tree.root
    .findAllByType(type)
    .find((node) => node.props[key] === label);
  assert.ok(found, "Missing control " + label);
  assert.ok(!found.props.disabled, label + " is disabled");
  await act(async () => {
    await found.props.onPress();
  });
}
async function field(tree, label, value) {
  await act(async () =>
    tree.root
      .findAllByType("TextField")
      .find((node) => node.props.label === label)
      .props.onChangeText(value),
  );
}
const text = (tree) =>
  JSON.stringify(tree.toJSON(), (_key, value) =>
    React.isValidElement(value) ? undefined : value,
  );
const me = { id: 8, name: "Apple Test", role: "client" };
const wol = {
  id: 42,
  name: "WOL productions",
  role: "freelancer",
  avatar: "wol.png",
};
const brief = {
  id: 71,
  clientId: 99,
  clientName: "Nova Interiors",
  title: "Fashion show",
  category: "Videography, Photography",
  description:
    "Film the fashion show and photograph the models during our London launch event.",
  location: "London",
  remote: 0,
  budgetMin: 1250,
  budgetMax: 1551,
  budgetType: "project",
  status: "open",
  isActive: true,
  applicationCount: 0,
};
function project(id, status = "active", paymentStatus = "unpaid") {
  return {
    project: {
      id,
      title: "Project " + id,
      status,
      paymentStatus,
      clientId: 8,
      freelancerId: 42,
      planningStatus: "planning_required",
    },
    client: me,
    freelancer: wol,
  };
}

test("WOL conversation uses account identity for header, composer, profile and send destination", async (t) => {
  const h = harness(async (method, path, payload) => {
    if (path === "/api/profiles/by-user/42") return { user: wol };
    if (path === "/api/profiles/42")
      return { user: { id: 91, name: "Umair Ahmad" } };
    if (path.endsWith("/messages")) {
      if (method === "post") return { id: 12, ...payload };
      return { items: [], hasMore: false, nextCursor: null };
    }
    if (path === "/api/messages/read") return { markedRead: 0 };
    throw new Error("Unexpected " + path);
  });
  h.setParams({ conversationId: "42" });
  const { tree } = await mount(
    t,
    h,
    "src/app/(app)/messages/[conversationId].tsx",
  );
  assert.match(text(tree), /WOL productions/);
  assert.doesNotMatch(text(tree), /Umair Ahmad/);
  assert.equal(
    h.calls.filter((call) => call.path === "/api/profiles/42").length,
    0,
  );
  const composer = tree.root.findByType("MessageComposer");
  assert.equal(composer.props.placeholder, "Message WOL");
  await act(async () => {
    await composer.props.onSend("Hi WOL");
  });
  assert.equal(
    h.calls.find(
      (call) => call.method === "post" && call.path === "/api/messages",
    ).payload.toId,
    42,
  );
  await press(
    tree,
    "View WOL productions's profile",
    "Pressable",
    "accessibilityLabel",
  );
  assert.deepEqual(h.navigation.at(-1).value.params, {
    profileId: "42",
    idKind: "user",
  });
});

test("route changes discard late identity replies and client accounts use the inbox identity", async (t) => {
  let resolveOld;
  const old = new Promise((resolve) => {
    resolveOld = resolve;
  });
  const h = harness(async (_, path) => {
    if (path === "/api/profiles/by-user/42") return old;
    if (path === "/api/profiles/by-user/8")
      return { user: { id: 91, name: "Wrong person" } };
    if (path === "/api/conversations")
      return {
        items: [
          { otherUserId: 8, name: "Apple Test", avatar: null, headline: null },
        ],
      };
    if (path.endsWith("/messages")) return { items: [], hasMore: false };
    return {};
  }, wol);
  h.setParams({ conversationId: "42" });
  const { tree, update } = await mount(
    t,
    h,
    "src/app/(app)/messages/[conversationId].tsx",
  );
  h.setParams({ conversationId: "8" });
  await update();
  assert.match(text(tree), /Apple Test/);
  await act(async () => resolveOld({ user: wol }));
  assert.doesNotMatch(text(tree), /WOL productions|Wrong person/);
  const identity = tree.root
    .findAllByType("Pressable")
    .filter(
      (node) => node.props.accessibilityLabel === "View Apple Test's profile",
    );
  assert.ok(identity.length);
  assert.ok(identity.every((node) => node.props.disabled));
});

test("Briefs board shows other clients' briefs, category matches and location search", async (t) => {
  const h = harness(async (_, path) => {
    assert.equal(path, "/api/briefs");
    return [brief];
  });
  const { tree } = await mount(t, h, "src/app/(app)/briefs/index.tsx");
  assert.equal(tree.root.findAllByType("ListRow").length, 1);
  assert.equal(h.calls[0].payload.query.clientId, undefined);
  await press(tree, "Photography", "Pressable", "accessibilityLabel");
  await field(tree, "Search briefs", "London");
  assert.equal(tree.root.findAllByType("ListRow").length, 1);
  await press(tree, "My briefs", "Pressable", "accessibilityLabel");
  assert.equal(tree.root.findAllByType("ListRow").length, 0);
  await press(tree, "Post a Brief");
  assert.equal(h.navigation.at(-1).value, "/(app)/briefs/new");
});

test("board pagination includes briefs beyond page one and prevents a repeated-page loop", async () => {
  const first = Array.from({ length: 200 }, (_, i) => ({
    ...brief,
    id: i + 1,
  }));
  const h = harness(async (_, path, options) =>
    options.query.offset ? [{ ...brief, id: 201 }] : first,
  );
  const rows = await h.load("src/api/briefBoard.ts").loadBriefBoard();
  assert.equal(rows.length, 201);
  assert.deepEqual(
    h.calls.map((call) => call.payload.query.offset),
    [0, 200],
  );
  const repeated = harness(async () => first);
  await assert.rejects(
    repeated.load("src/api/briefBoard.ts").loadBriefBoard(),
    /completely/,
  );
});

test("posting a brief preserves input after failure and sends the web payload without actor IDs", async (t) => {
  let fails = true;
  const h = harness(async (method, path, payload) => {
    assert.equal(method, "post");
    assert.equal(path, "/api/briefs");
    if (fails) throw new Error("Try again later");
    return { ...brief, ...payload, id: 72 };
  });
  const { tree } = await mount(t, h, "src/app/(app)/briefs/new.tsx");
  await field(tree, "Brief title", "Launch filming");
  await field(tree, "Description", brief.description);
  await field(tree, "Location", "London");
  await field(tree, "Minimum budget (£, optional)", "1,250.50");
  await press(tree, "Photography", "Pressable", "accessibilityLabel");
  await press(tree, "Post a Brief");
  assert.match(text(tree), /Try again later/);
  assert.equal(
    tree.root
      .findAllByType("TextField")
      .find((node) => node.props.label === "Brief title").props.value,
    "Launch filming",
  );
  assert.equal(h.navigation.length, 0);
  fails = false;
  await press(tree, "Post a Brief");
  assert.equal(h.calls.at(-1).payload.budgetMin, 1250.5);
  assert.equal(h.calls.at(-1).payload.category, "Photography");
  assert.equal("clientId" in h.calls.at(-1).payload, false);
  assert.equal(h.navigation.at(-1).value.params.briefId, "72");
});

test("creative can express interest natively once and shares the proposed GBP amount", async (t) => {
  const h = harness(async (method, path) => {
    assert.equal(method, "post");
    assert.equal(path, "/api/interests");
    return { id: 3 };
  }, wol);
  const { ApplyToBrief } = h.load("src/components/work/ApplyToBrief.tsx");
  let tree;
  let refreshed = 0;
  await act(async () => {
    tree = create(
      React.createElement(ApplyToBrief, {
        briefId: 71,
        onSent: () => refreshed++,
      }),
    );
  });
  t.after(async () => {
    await act(async () => tree.unmount());
  });
  await press(tree, "Express Interest");
  await field(tree, "Cover note", "I can film and photograph your launch.");
  await field(tree, "Proposed price (£, optional)", "1250.50");
  await press(tree, "Send interest");
  assert.equal(h.calls[0].payload.proposedPricePence, 125050);
  assert.equal(h.calls[0].payload.briefId, 71);
  assert.equal("freelancerId" in h.calls[0].payload, false);
  assert.equal(refreshed, 1);
  assert.equal(
    tree.root
      .findAllByType("Button")
      .filter((node) => node.props.label === "Send interest").length,
    0,
  );
});

test("one-off creation searches connections, sends once on double tap, and opens Sent", async (t) => {
  let finish;
  const sending = new Promise((resolve) => {
    finish = resolve;
  });
  const h = harness(async (method, path) => {
    if (path === "/api/users/search") return [wol];
    if (method === "post" && path === "/api/invitations") return sending;
    throw new Error("Unexpected " + path);
  });
  const { tree } = await mount(t, h, "src/app/(app)/work/new.tsx");
  await press(tree, "Create one-off project");
  await field(tree, "Project title", "App Store Review");
  await field(tree, "Provisional estimate (£)", "1,250.50");
  await press(tree, "Choose connection");
  await field(tree, "Find a connection", "WOL");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 280));
  });
  const row = tree.root.findByType("ListRow");
  assert.equal(row.props.title, "WOL productions");
  await act(async () => row.props.onPress());
  const button = tree.root
    .findAllByType("Button")
    .find((node) => node.props.label === "Send invitation");
  await act(async () => {
    button.props.onPress();
    button.props.onPress();
  });
  const writes = h.calls.filter((call) => call.method === "post");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].payload, {
    title: "App Store Review",
    budget: "1250.50",
    isRetainer: 0,
    startStage: 0,
    recipientId: 42,
  });
  await act(async () => finish({ id: 9 }));
  assert.equal(h.navigation.at(-1).method, "dismissTo");
  assert.equal(h.navigation.at(-1).value.params.invitations, "sent");
});

test("accepting Received invitation refreshes projects and keeps completed unpaid work in Completed", async (t) => {
  let accepted = false;
  const invitation = {
    id: 5,
    senderId: 42,
    recipientId: 8,
    senderName: wol.name,
    recipientName: me.name,
    title: "Launch",
    budget: "1250.50",
    status: "pending",
  };
  const h = harness(async (method, path) => {
    if (path === "/api/projects")
      return [project(1, "completed"), ...(accepted ? [project(2)] : [])];
    if (path === "/api/invitations")
      return [
        { ...invitation, status: accepted ? "accepted" : "pending" },
        {
          ...invitation,
          id: 6,
          senderId: 8,
          recipientId: 42,
          title: "Sent project",
        },
      ];
    if (path === "/api/custom-retainer-invitations") return [];
    if (method === "patch" && path === "/api/invitations/5/accept") {
      accepted = true;
      return { project: project(2).project };
    }
    throw new Error("Unexpected " + path);
  });
  const { tree } = await mount(t, h, "src/app/(app)/work/index.tsx");
  assert.equal(tree.root.findAllByType("ProjectCard").length, 1);
  await press(tree, "Accept invitation");
  assert.equal(tree.root.findAllByType("ProjectCard").length, 2);
  assert.equal(
    tree.root
      .findAllByType("Button")
      .filter((node) => node.props.label === "Accept invitation").length,
    0,
  );
  await press(tree, "Completed, 1", "Pressable", "accessibilityLabel");
  assert.equal(tree.root.findAllByType("ProjectCard").length, 1);
  assert.equal(tree.root.findByType("ProjectCard").props.item.project.id, 1);
  await press(tree, "Sent", "Pressable", "accessibilityLabel");
  assert.match(text(tree), /Sent project/);
  await press(tree, "Create Project");
  assert.equal(h.navigation.at(-1).value, "/(app)/work/new");
});

test("invitation load failure is an error, not a false empty inbox", async (t) => {
  const h = harness(async (_, path) => {
    if (path === "/api/invitations") throw new Error("Offline");
    return [];
  });
  const { tree } = await mount(t, h, "src/app/(app)/work/index.tsx");
  assert.equal(tree.root.findAllByType("ErrorState").length, 1);
  assert.doesNotMatch(text(tree), /No invitations received yet/);
});

test("money and retainer validation preserve stable IDs and enforce date gaps", () => {
  const h = harness(() => {});
  const { gbpToPence } = h.load("src/lib/workInputs.ts");
  assert.equal(gbpToPence("£1,234.56"), 123456);
  for (const invalid of ["-1", "1.999", "1,25", "Infinity"])
    assert.throws(() => gbpToPence(invalid));
  const { draftFrom, planFrom } = h.load("src/lib/retainerDraft.ts");
  const plan = {
    title: "Monthly films",
    startDate: "2026-11-01",
    endDate: "2026-11-30",
    gapsAcknowledged: false,
    cycles: [
      {
        id: randomUUID(),
        name: "November",
        startDate: "2026-11-01",
        endDate: "2026-11-30",
        amountPence: 125050,
        revisionAllowance: 2,
        paymentDays: 5,
        deliverables: [
          { id: randomUUID(), name: "Film", quantity: 1, brief: "Launch edit" },
        ],
      },
    ],
  };
  assert.deepEqual(planFrom(draftFrom(plan)), plan);
  const draft = draftFrom(plan);
  draft.cycles[0].endDate = "2026-11-29";
  assert.throws(() => planFrom(draft), /acknowledge/);
  draft.gapsAcknowledged = true;
  assert.equal(planFrom(draft).cycles[0].id, plan.cycles[0].id);
  draft.cycles[0].startDate = "2026-11-31";
  assert.throws(() => planFrom(draft), /valid dates/);
});

test("retainer review binds acceptance to the displayed version and retains the screen on conflict", async (t) => {
  let conflict = true;
  const plan = {
    title: "November retainer",
    startDate: "2026-11-01",
    endDate: "2026-11-30",
    gapsAcknowledged: false,
    cycles: [],
  };
  const h = harness(async (method, path) => {
    if (method === "get")
      return {
        status: "awaiting_client_acceptance",
        latestVersion: 4,
        latestPlan: plan,
        pending: { plan, version: 4, proposedBy: 42 },
        clientId: 8,
        freelancerId: 42,
      };
    if (conflict)
      throw new Error("Proposal changed. Reload the latest version.");
    return {};
  });
  h.setParams({ agreementId: "agreement-7" });
  const { tree } = await mount(
    t,
    h,
    "src/app/(app)/work/proposal/[agreementId].tsx",
  );
  await press(tree, "Accept this version");
  assert.match(text(tree), /Proposal changed/);
  assert.equal(h.navigation.length, 0);
  conflict = false;
  await press(tree, "Accept this version");
  assert.deepEqual(h.calls.at(-1), {
    method: "post",
    path: "/api/custom-retainers/agreement-7/review",
    payload: { version: 4, action: "accept", feedback: "" },
  });
  assert.equal(h.navigation.at(-1).value, "/(app)/work");
});

test("native retainer builder sends the reviewed cycle and deliverable terms to a connection", async t => {
  const h = harness(async (method, path) => {
    if (path === "/api/custom-retainers/config") return { enabled: true };
    if (path === "/api/users/search") return [wol];
    if (method === "post" && path === "/api/custom-retainers") return { publicId: "new-retainer" };
    throw new Error("Unexpected " + path);
  });
  const { tree } = await mount(t, h, "src/app/(app)/work/new-retainer.tsx");
  for (const [label, value] of [
    ["Retainer title", "Monthly launch films"], ["Start date", "2026-11-01"], ["End date", "2026-11-30"],
    ["Cycle name", "November"], ["Cycle start date", "2026-11-01"], ["Cycle end date", "2026-11-30"],
    ["Cycle price (£)", "1250.50"], ["Deliverable name", "Launch film"], ["Quantity", "2"],
    ["Individual briefs (optional, one per line)", "Main film\nSocial cutdown"],
  ]) await field(tree, label, value);
  await press(tree, "Review proposal");
  assert.match(text(tree), /£1,250.50/);
  assert.match(text(tree), /verified payment/);
  await field(tree, "Find a connection", "WOL");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 280)); });
  await act(async () => tree.root.findByType("ListRow").props.onPress());
  await press(tree, "Send for review and acceptance");
  const request = h.calls.find(call => call.method === "post");
  assert.equal(request.payload.recipientId, 42);
  assert.equal(request.payload.plan.cycles[0].amountPence, 125050);
  assert.deepEqual(request.payload.plan.cycles[0].deliverables[0].itemBriefs, ["Main film", "Social cutdown"]);
  assert.equal(request.payload.plan.cycles[0].deliverables[0].quantity, 2);
  assert.equal(request.payload.plan.cycles[0].paymentDays, 5);
  assert.equal(request.payload.plan.cycles[0].revisionAllowance, 2);
  assert.match(request.payload.plan.cycles[0].id, /^[0-9a-f-]{36}$/);
  assert.equal(h.navigation.at(-1).value.params.invitations, "sent");
});
