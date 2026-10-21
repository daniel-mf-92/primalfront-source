import fs from "fs";
import path from "path";

// The game scales to zero when idle; only the KEDA HTTP interceptor wakes it. On
// 2026-10-21 a deploy re-applied a tunnel config aimed at primalfront-svc and the
// site returned 502 until it was pointed back at the interceptor.
const CONFIG = path.join(__dirname, "..", "k8s", "cloudflared-configmap.yaml");
// k8s/ is deploy-only and left out of the public source copy.
const hasConfig = fs.existsSync(CONFIG);
const config = hasConfig ? fs.readFileSync(CONFIG, "utf8") : "";

describe.skipIf(!hasConfig)("tunnel routing", () => {
  test("every public hostname goes through the KEDA interceptor", () => {
    const services = [...config.matchAll(/service:\s*(\S+)/g)].map((m) => m[1]);
    const origins = services.filter((s) => s.startsWith("http://"));
    expect(origins.length).toBeGreaterThan(0);
    for (const origin of origins) {
      expect(origin).toBe("http://10.43.189.36:8080");
    }
  });
});

// Marta, 2026-10-21 (option A, "keep it warm"): the game server never scales to
// zero, because the first visitor after a quiet spell used to wait 15-20 s or
// hit a Cloudflare 524 while the hub node re-pulled the image. The manifest
// is deploy-only too, so this guard is skipped in the public source copy.
const SCALER = path.join(__dirname, "..", "k8s", "httpscaledobject.yaml");
const hasScaler = fs.existsSync(SCALER);
const scaler = hasScaler ? fs.readFileSync(SCALER, "utf8") : "";
const WORKFLOW = path.join(
  __dirname,
  "..",
  ".github",
  "workflows",
  "deploy.yml",
);
const workflow = fs.existsSync(WORKFLOW)
  ? fs.readFileSync(WORKFLOW, "utf8")
  : "";

describe.skipIf(!hasScaler)("warm game server", () => {
  test("the scaler keeps at least one game pod running", () => {
    expect(scaler).toMatch(/replicas:\s*\n\s*min:\s*1\b/);
    expect(scaler).toMatch(/kind:\s*HTTPScaledObject/);
  });

  test("every deploy re-applies the scaler manifest", () => {
    expect(workflow).toContain("k8s/httpscaledobject.yaml");
  });
});
