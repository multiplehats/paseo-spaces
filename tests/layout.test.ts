import assert from "node:assert/strict";
import test from "node:test";
import {
  addSpace,
  assign,
  defaultLayout,
  LayoutError,
  LayoutSchema,
  removalTarget,
  removeSpace,
  renameSpace,
  spaceFor,
  stepFrom,
} from "../shared/layout";

const three = () =>
  LayoutSchema.parse({
    spaces: [
      { id: "s1", name: "Main" },
      { id: "s2", name: "Clients" },
      { id: "s3", name: "Infra" },
    ],
    assignments: { "remote:github.com/acme/web": "s2", "host:srv:/x": "s3", ghost: "s9" },
  });

test("Data: the default layout is one Space called Main", () => {
  assert.deepEqual(defaultLayout(), { spaces: [{ id: "s1", name: "Main" }], assignments: {} });
});

test("Data: unassigned projects and dangling assignments belong to the first Space", () => {
  const layout = three();
  assert.equal(spaceFor(layout, "remote:github.com/acme/web"), "s2");
  assert.equal(spaceFor(layout, "never-seen"), "s1");
  assert.equal(spaceFor(layout, "ghost"), "s1");
});

test("Data: Space ids must be unique, and at least one Space must exist", () => {
  assert.throws(() =>
    LayoutSchema.parse({
      spaces: [
        { id: "a", name: "A" },
        { id: "a", name: "B" },
      ],
    }),
  );
  assert.throws(() => LayoutSchema.parse({ spaces: [] }));
});

test("Data: new Spaces take the lowest free id and are numbered after the count", () => {
  const first = addSpace(three());
  assert.equal(first.id, "s4");
  assert.equal(first.layout.spaces.at(-1)?.name, "Space 4");
  const second = addSpace(first.layout);
  assert.equal(second.id, "s5");
  assert.equal(second.layout.spaces.at(-1)?.name, "Space 5");
  const taken = LayoutSchema.parse({ spaces: [{ id: "s1", name: "Space 2" }] });
  assert.equal(addSpace(taken).layout.spaces.at(-1)?.name, "Space 3", "skips a taken name");
  assert.equal(addSpace(three(), "  Side projects ").layout.spaces.at(-1)?.name, "Side projects");
});

test("Data: names are trimmed, 1 to 60 characters", () => {
  assert.equal(renameSpace(three(), "s2", "  Agency  ").spaces[1].name, "Agency");
  assert.throws(() => renameSpace(three(), "s2", "   "), LayoutError);
  assert.throws(() => renameSpace(three(), "s2", "x".repeat(61)), LayoutError);
  assert.throws(() => renameSpace(three(), "nope", "Name"), LayoutError);
});

test("Data: removing a Space moves its projects to the first remaining Space", () => {
  const { layout, target } = removeSpace(three(), "s2");
  assert.equal(target, "s1");
  assert.deepEqual(
    layout.spaces.map((space) => space.id),
    ["s1", "s3"],
  );
  assert.equal(layout.assignments["remote:github.com/acme/web"], "s1");
  assert.equal(layout.assignments["host:srv:/x"], "s3");
  assert.equal(
    removalTarget(three(), "s1").name,
    "Clients",
    "removing the first moves to the next",
  );
});

test("Data: the last Space cannot be removed", () => {
  assert.throws(() => removeSpace(defaultLayout(), "s1"), /Keep at least one space/);
});

test("Data: assigning needs a project key and an existing Space", () => {
  assert.equal(assign(three(), "k", "s3").assignments.k, "s3");
  assert.throws(() => assign(three(), "", "s3"), LayoutError);
  assert.throws(() => assign(three(), "k", "s9"), LayoutError);
});

test("Keyboard: stepping stops at the first and last Space", () => {
  assert.equal(stepFrom(three(), "s1", -1), "s1");
  assert.equal(stepFrom(three(), "s1", 1), "s2");
  assert.equal(stepFrom(three(), "s3", 1), "s3");
  assert.equal(stepFrom(three(), "gone", 1), "s2", "an unknown current Space counts as the first");
});
