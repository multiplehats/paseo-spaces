import assert from "node:assert/strict";
import test from "node:test";
import {
  addSpace,
  assign,
  defaultLayout,
  LayoutError,
  LayoutSchema,
  moveSpace,
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

const order = (layout: { spaces: { id: string }[] }) => layout.spaces.map((space) => space.id);

test("Data: a Space moves along the list, stopping at either end", () => {
  assert.deepEqual(order(moveSpace(three(), "s3", -1)), ["s1", "s3", "s2"]);
  assert.deepEqual(order(moveSpace(three(), "s2", 1)), ["s1", "s3", "s2"]);
  assert.deepEqual(order(moveSpace(three(), "s3", -5)), ["s3", "s1", "s2"]);
  const same = three();
  assert.equal(moveSpace(same, "s1", -1), same, "already first");
  assert.equal(moveSpace(same, "s3", 1), same, "already last");
  assert.throws(() => moveSpace(three(), "nope", 1), LayoutError);
});

test("Data: reordering leaves every project in its Space, unsorted ones too", () => {
  const moved = moveSpace(three(), "s1", 1);
  assert.deepEqual(order(moved), ["s2", "s1", "s3"]);
  assert.equal(spaceFor(moved, "never-seen"), "s1", "unsorted projects stay in Main");
  assert.equal(spaceFor(moved, "ghost"), "s1");
  assert.equal(spaceFor(moved, "remote:github.com/acme/web"), "s2");
  assert.deepEqual(LayoutSchema.parse(moved), moved, "the reordered layout can be stored");

  const again = moveSpace(moved, "s3", -2);
  assert.equal(spaceFor(again, "never-seen"), "s1", "and stay there through later moves");
  const back = moveSpace(moved, "s1", -1);
  assert.equal(back.home, undefined, "back on top, nothing extra is kept");
  assert.deepEqual(back, three());
});

test("Data: removing the Space unsorted projects are in moves them with the rest", () => {
  const moved = moveSpace(three(), "s1", 2);
  const { layout, target } = removeSpace(moved, "s1");
  assert.equal(target, "s2");
  assert.equal(spaceFor(layout, "never-seen"), "s2");
  assert.equal(layout.home, undefined);
  const kept = removeSpace(moved, "s3").layout;
  assert.equal(spaceFor(kept, "never-seen"), "s1", "removing another Space changes nothing");
});
