import { withV2Log } from "@/lib/api/v2/route";
import { GET as GET_ } from "@paid/postcard/routes/api/v2/[user]/postcards/texts/route";
export const GET = withV2Log(GET_, { route: "/api/v2/[user]/postcards/texts" });
export const dynamic = "force-dynamic";
