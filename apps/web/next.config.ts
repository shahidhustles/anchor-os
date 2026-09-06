import { withAui } from "@assistant-ui/next";
import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@anchor-os/agent",
    "@anchor-os/browser-control",
    "@assistant-ui/eve",
    "@assistant-ui/react",
  ],
};

export default withEve(withAui(nextConfig), {
  eveRoot: "../../packages/agent",
});
