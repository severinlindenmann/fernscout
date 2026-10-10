import { withV2Log } from "@/lib/api/v2/route";
import { GET as GET_, PUT as PUT_ } from "@paid/postcard/routes/api/v2/[user]/postcards/orders/[id]/route";
export const GET = withV2Log(GET_, { route: "/api/v2/[user]/postcards/orders/[id]" });
export const PUT = withV2Log(PUT_, { route: "/api/v2/[user]/postcards/orders/[id]" });
export const dynamic = "force-dynamic";
