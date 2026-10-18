import { withV2Log } from "@/lib/api/v2/route";
import { GET as GET_ } from "@paid/billing/routes/api/web/[user]/apple/account-token/route";
export const GET = withV2Log(GET_, { route: "/api/web/[user]/apple/account-token" });
