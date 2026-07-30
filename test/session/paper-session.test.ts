import assert from "node:assert/strict";
import test from "node:test";
import { PaperSessionCoordinator } from "../../src/session/paper-session";

test("paper switch aborts old work and rejects its late result", () => {
  const sessions = new PaperSessionCoordinator();
  const first = sessions.begin({
    libraryID: 1,
    attachmentID: 10,
    attachmentKey: "AAAAAAAA",
    parentItemKey: "BBBBBBBB",
    sourceFingerprint: "first",
  });
  const second = sessions.begin({
    libraryID: 1,
    attachmentID: 11,
    attachmentKey: "CCCCCCCC",
    parentItemKey: "DDDDDDDD",
    sourceFingerprint: "second",
  });

  assert.equal(first.signal.aborted, true);
  assert.equal(sessions.canCommit(first.token), false);
  assert.equal(sessions.canCommit(second.token), true);
});

test("manual refresh changes generation even when paper identity is unchanged", () => {
  const sessions = new PaperSessionCoordinator();
  const identity = {
    libraryID: 1,
    attachmentID: 10,
    attachmentKey: "AAAAAAAA",
    parentItemKey: "BBBBBBBB",
    sourceFingerprint: "same-md",
  };

  const first = sessions.begin(identity);
  const refreshed = sessions.begin(identity);

  assert.equal(refreshed.token.generation, first.token.generation + 1);
  assert.equal(sessions.canCommit(first.token), false);
  assert.equal(sessions.canCommit(refreshed.token), true);
});

test("shutdown aborts active work and prevents every later commit", () => {
  const sessions = new PaperSessionCoordinator();
  const active = sessions.begin({
    libraryID: 1,
    attachmentID: 10,
    attachmentKey: "AAAAAAAA",
    parentItemKey: "BBBBBBBB",
    sourceFingerprint: "same-md",
  });

  sessions.dispose();

  assert.equal(active.signal.aborted, true);
  assert.equal(sessions.canCommit(active.token), false);
});
