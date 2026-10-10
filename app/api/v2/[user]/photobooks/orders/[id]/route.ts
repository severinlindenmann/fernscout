import { withV2Log } from "@/lib/api/v2/route";
import { GET as GET_ } from "@paid/photobook/routes/api/v2/[user]/photobooks/orders/[id]/route";
export const GET = withV2Log(GET_, { route: "/api/v2/[user]/photobooks/orders/[id]" });
export const dynamic = "force-dynamic";
