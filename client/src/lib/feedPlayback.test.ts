import { test } from "node:test";
import assert from "node:assert/strict";
import { createFeedPlaybackCoordinator } from "./feedPlayback.ts";

test("only the most visible eligible video plays; the old video stops first", () => {
  const playback = createFeedPlaybackCoordinator();
  const calls: string[] = [];
  const first = playback.register(active => calls.push(`first:${active}`));
  const second = playback.register(active => calls.push(`second:${active}`));
  first.setAutoplay(true);
  second.setAutoplay(true);
  first.setVisibility(0.5);
  assert.deepEqual(calls, []);
  first.setVisibility(0.75);
  second.setVisibility(0.75);
  assert.deepEqual(calls, ["first:true"]);
  second.setVisibility(1);
  assert.deepEqual(calls, ["first:true", "first:false", "second:true"]);
  second.setVisibility(0);
  assert.deepEqual(calls.slice(-2), ["second:false", "first:true"]);
});

test("manual pause survives scrolling and returning to the tab", () => {
  const playback = createFeedPlaybackCoordinator();
  const calls: boolean[] = [];
  const video = playback.register(active => calls.push(active));
  video.setAutoplay(true);
  video.setVisibility(1);
  video.pause();
  video.setVisibility(0);
  video.setVisibility(1);
  playback.setPageVisible(false);
  playback.setPageVisible(true);
  assert.deepEqual(calls, [true, false]);
  assert.equal(video.play(), true);
  assert.deepEqual(calls, [true, false, true]);
});

test("reduced motion or data saving allows manual playback but never background playback", () => {
  const playback = createFeedPlaybackCoordinator();
  const calls: boolean[] = [];
  const video = playback.register(active => calls.push(active));
  video.setVisibility(1);
  assert.deepEqual(calls, []);
  assert.equal(video.play(), true);
  playback.setPageVisible(false);
  assert.deepEqual(calls, [true, false]);
  assert.equal(video.play(), false);
  playback.setPageVisible(true);
  assert.deepEqual(calls, [true, false]);
  video.play();
  video.setVisibility(0);
  video.setVisibility(1);
  assert.deepEqual(calls, [true, false, true, false]);
});

test("manual playback takes priority until the video leaves the screen", () => {
  const playback = createFeedPlaybackCoordinator();
  const calls: string[] = [];
  const first = playback.register(active => calls.push(`first:${active}`));
  const second = playback.register(active => calls.push(`second:${active}`));
  first.setAutoplay(true);
  first.setVisibility(1);
  second.setVisibility(0.3);
  second.play();
  first.setVisibility(0.9);
  assert.deepEqual(calls, ["first:true", "first:false", "second:true"]);
  second.setVisibility(0);
  assert.deepEqual(calls.slice(-2), ["second:false", "first:true"]);
});

test("removing a playing card stops it and allows the next visible card to play", () => {
  const playback = createFeedPlaybackCoordinator();
  const calls: string[] = [];
  const first = playback.register(active => calls.push(`first:${active}`));
  const second = playback.register(active => calls.push(`second:${active}`));
  first.setAutoplay(true);
  first.setVisibility(1);
  second.setAutoplay(true);
  second.setVisibility(0.8);
  first.remove();
  assert.deepEqual(calls, ["first:true", "first:false", "second:true"]);
  second.remove();
  playback.setPageVisible(false);
  playback.setPageVisible(true);
  assert.deepEqual(calls.slice(-1), ["second:false"]);
});
