export type DramaCueID =
  | "age_ready"
  | "age_up"
  | "first_city"
  | "first_farm"
  | "first_outpost"
  | "first_resource_flow"
  | "threat_spotted";

export type DramaCueTone = "age" | "danger" | "economy" | "settlement";

export interface DramaSnapshot {
  age: number;
  canAdvanceAge: boolean;
  cityCount: number;
  farmCount: number;
  outpostCount: number;
  pipelineGoldPerSecond: bigint;
  threatLeaderID: string | null;
  isThreatLeader: boolean;
}

export interface DramaCueMeta {
  titleKey: string;
  detailKey: string;
  icon: string;
  tone: DramaCueTone;
}

const onceOnlyCues = new Set<DramaCueID>([
  "age_ready",
  "first_city",
  "first_farm",
  "first_outpost",
  "first_resource_flow",
  "threat_spotted",
]);

export function isRepeatableDramaCue(cue: DramaCueID): boolean {
  return !onceOnlyCues.has(cue);
}

export function collectDramaCues(
  previous: DramaSnapshot | null,
  next: DramaSnapshot,
  seen: ReadonlySet<DramaCueID>,
): DramaCueID[] {
  const cues: DramaCueID[] = [];

  if (previous !== null && next.age > previous.age) {
    cues.push("age_up");
  }

  addOnce(cues, seen, "first_city", next.cityCount > 0);
  addOnce(cues, seen, "first_farm", next.farmCount > 0);
  addOnce(cues, seen, "first_outpost", next.outpostCount > 0);
  addOnce(cues, seen, "first_resource_flow", next.pipelineGoldPerSecond > 0n);
  addOnce(
    cues,
    seen,
    "age_ready",
    next.canAdvanceAge &&
      (previous === null || previous.canAdvanceAge !== next.canAdvanceAge),
  );
  addOnce(
    cues,
    seen,
    "threat_spotted",
    playerCanRespondToThreat(next) &&
      next.threatLeaderID !== null &&
      !next.isThreatLeader &&
      (previous === null ||
        previous.threatLeaderID !== next.threatLeaderID ||
        previous.isThreatLeader !== next.isThreatLeader),
  );

  return cues;
}

function playerCanRespondToThreat(snapshot: DramaSnapshot): boolean {
  return snapshot.age > 0 || snapshot.canAdvanceAge || snapshot.cityCount > 0;
}

export function dramaCueMeta(cue: DramaCueID): DramaCueMeta {
  switch (cue) {
    case "age_ready":
      return meta(cue, "age", "^");
    case "age_up":
      return meta(cue, "age", "*");
    case "first_city":
      return meta(cue, "settlement", "#");
    case "first_farm":
      return meta(cue, "economy", "+");
    case "first_outpost":
      return meta(cue, "economy", "$");
    case "first_resource_flow":
      return meta(cue, "economy", ">");
    case "threat_spotted":
      return meta(cue, "danger", "!");
  }
}

function addOnce(
  cues: DramaCueID[],
  seen: ReadonlySet<DramaCueID>,
  cue: DramaCueID,
  condition: boolean,
): void {
  if (condition && !seen.has(cue)) {
    cues.push(cue);
  }
}

function meta(cue: DramaCueID, tone: DramaCueTone, icon: string): DramaCueMeta {
  return {
    titleKey: `control_panel.deed_${cue}`,
    detailKey: `control_panel.deed_${cue}_detail`,
    icon,
    tone,
  };
}
