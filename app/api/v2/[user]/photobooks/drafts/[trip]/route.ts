import { withV2Log } from "@/lib/api/v2/route";
import { GET as GET_, PUT as PUT_ } from "@paid/photobook/routes/api/v2/[user]/photobooks/drafts/[trip]/route";
export const GET = withV2Log(GET_, { route: "/api/v2/[user]/photobooks/drafts/[trip]" });
export const PUT = withV2Log(PUT_, { route: "/api/v2/[user]/photobooks/drafts/[trip]" });
export const dynamic = "force-dynamic";
