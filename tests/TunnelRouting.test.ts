import fs from "fs";
import path from "path";

// The game scales to zero when idle; only the KEDA HTTP interceptor wakes it. On
// 2026-10-21 a deploy re-applied a tunnel config aimed at primalfront-svc and the
// site returned 502 until it was pointed back at the interceptor.
const config = fs.readFileSync(
  path.join(__dirname, "..", "k8s", "cloudflared-configmap.yaml"),
  "utf8",
);

describe("tunnel routing", () => {
  test("every public hostname goes through the KEDA interceptor", () => {
    const services = [...config.matchAll(/service:\s*(\S+)/g)].map((m) => m[1]);
    const origins = services.filter((s) => s.startsWith("http://"));
    expect(origins.length).toBeGreaterThan(0);
    for (const origin of origins) {
      expect(origin).toBe("http://10.43.189.36:8080");
    }
  });
});
