import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { ServerEnv } from "./ServerEnv";

export function getOtelResource() {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "primalfront",
    [ATTR_SERVICE_VERSION]: "1.0.0",
    ...getPromLabels(),
  });
}

export function getPromLabels() {
  const workerId = ServerEnv.workerId();
  return {
    "service.instance.id": ServerEnv.hostname(),
    "primalfront.environment": ServerEnv.env(),
    "primalfront.host": ServerEnv.host(),
    "primalfront.domain": ServerEnv.domain(),
    "primalfront.subdomain": ServerEnv.subdomain(),
    "primalfront.component":
      workerId !== undefined ? "Worker " + workerId : "Master",
  };
}
