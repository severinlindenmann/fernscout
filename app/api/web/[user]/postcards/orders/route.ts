import { withV2Log } from "@/lib/api/v2/route";
import { POST as POST_ } from "@paid/postcard/routes/api/web/[user]/postcards/orders/route";
export const POST = withV2Log(POST_, { route: "/api/web/[user]/postcards/orders" });
export const dynamic = "force-dynamic";
