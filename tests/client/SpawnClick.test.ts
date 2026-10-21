import {
  needsSpawnPrompt,
  shouldSendSpawnIntent,
} from "../../src/client/SpawnClick";

const freeLand = { isLand: true, hasOwner: false, isRandomSpawn: false };

describe("spawn click", () => {
  test("spawns during the spawn phase", () => {
    expect(
      shouldSendSpawnIntent({
        ...freeLand,
        inSpawnPhase: true,
        hasSpawned: false,
      }),
    ).toBe(true);
  });

  test("a player who missed the spawn phase still spawns on a land click", () => {
    expect(
      shouldSendSpawnIntent({
        ...freeLand,
        inSpawnPhase: false,
        hasSpawned: false,
      }),
    ).toBe(true);
  });

  test("a spawned player's land click is not a spawn (it moves the camp)", () => {
    expect(
      shouldSendSpawnIntent({
        ...freeLand,
        inSpawnPhase: false,
        hasSpawned: true,
      }),
    ).toBe(false);
  });

  test("spectators, owned tiles, water and random-spawn games never send a spawn", () => {
    expect(
      shouldSendSpawnIntent({
        ...freeLand,
        inSpawnPhase: false,
        hasSpawned: null,
      }),
    ).toBe(false);
    expect(
      shouldSendSpawnIntent({
        ...freeLand,
        hasOwner: true,
        inSpawnPhase: true,
        hasSpawned: false,
      }),
    ).toBe(false);
    expect(
      shouldSendSpawnIntent({
        ...freeLand,
        isLand: false,
        inSpawnPhase: true,
        hasSpawned: false,
      }),
    ).toBe(false);
    expect(
      shouldSendSpawnIntent({
        ...freeLand,
        isRandomSpawn: true,
        inSpawnPhase: true,
        hasSpawned: false,
      }),
    ).toBe(false);
  });

  test("the spawn prompt stays up until the player has a tribe", () => {
    expect(
      needsSpawnPrompt({
        inSpawnPhase: false,
        isRandomSpawn: false,
        hasSpawned: false,
      }),
    ).toBe(true);
    expect(
      needsSpawnPrompt({
        inSpawnPhase: false,
        isRandomSpawn: false,
        hasSpawned: true,
      }),
    ).toBe(false);
    expect(
      needsSpawnPrompt({
        inSpawnPhase: false,
        isRandomSpawn: false,
        hasSpawned: null,
      }),
    ).toBe(false);
  });
});
