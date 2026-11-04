import type { PluginServerContext } from "@getpaseo/plugin/server";
import { layoutSettings } from "./shared/layout";

// The host only stores the layout; everything else runs in the client.
export default function contribute(server: PluginServerContext) {
  server.registerSettings(layoutSettings);
  return () => {};
}
